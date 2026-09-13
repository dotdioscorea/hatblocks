import type { Node } from "web-tree-sitter";
import { makeBlock, litEmpty, litNumber, litString, isLiteral } from "../../ir/builders";
import { chain, countBlocks, createIdFactory, type IdFactory } from "../../ir/ids";
import type { Block, Diagnostic, Literal, Program, Script, SourceSpan } from "../../ir/types";
import { CATALOG, defaultToolbox, groupToolbox } from "../../library/catalog";
import { hatLine } from "../../library/hats";
import { headerName, IO_ASK, IO_SAY, stripCString, VOID_CALLEES } from "./builtins";

const BINARY_OPS: Record<string, string> = {
  "+": "ops.add",
  "-": "ops.sub",
  "*": "ops.mul",
  "/": "ops.div",
  "%": "ops.mod",
  "<": "ops.lt",
  ">": "ops.gt",
  "<=": "ops.le",
  ">=": "ops.ge",
  "==": "ops.eq",
  "!=": "ops.neq",
  "&&": "ops.and",
  "||": "ops.or",
  "&": "ops.bitand",
  "|": "ops.bitor",
  "^": "ops.bitxor",
  "<<": "ops.shl",
  ">>": "ops.shr",
};

export interface LowerResult {
  program: Program;
}

export function lowerCAst(root: Node, options: { fileName: string; maxBlocks: number }): Program {
  const lowerer = new CLowerer(options.fileName, options.maxBlocks);
  return lowerer.lowerUnit(root);
}

class CLowerer {
  readonly id: IdFactory;
  readonly diagnostics: Diagnostic[] = [];
  readonly variables = new Set<string>();
  readonly functionNames: { name: string; params: string[] }[] = [];
  truncated = false;
  private blockCount = 0;

  constructor(
    private readonly fileName: string,
    private readonly maxBlocks: number,
  ) {
    this.id = createIdFactory("c");
  }

  lowerUnit(root: Node): Program {
    const preamble: Block[] = [];
    const scripts: Script[] = [];
    const kids = named(root);

    for (const child of kids) {
      if (this.truncated) {
        break;
      }
      switch (child.type) {
        case "preproc_include":
          preamble.push(this.includeBlock(child));
          break;
        case "preproc_def":
        case "preproc_function_def":
          preamble.push(this.macroBlock(child));
          break;
        case "preproc_ifdef":
        case "preproc_if":
          preamble.push(this.preprocIf(child));
          break;
        case "declaration":
          preamble.push(...this.declarationBlocks(child));
          break;
        case "function_definition": {
          const script = this.functionScript(child);
          if (script) {
            scripts.push(script);
          }
          break;
        }
        case "type_definition":
        case "struct_specifier":
        case "enum_specifier":
        case "comment":
          break;
        case "ERROR":
          preamble.push(this.unknown(child, "stack"));
          this.diagnostics.push({
            message: "C parse error — showing the leftover as a grey block.",
            span: spanOf(child),
            severity: "warning",
          });
          break;
        default:
          if (child.type.startsWith("preproc")) {
            preamble.push(this.unknown(child, "stack"));
          }
          break;
      }
    }

    const placed: Script[] = [];
    const place = (rootBlock: Block): Script => {
      const script: Script = {
        id: this.id(),
        x: 12,
        y: 16 + placed.length * 28,
        root: rootBlock,
      };
      return script;
    };

    if (preamble.length) {
      const head = chain(preamble);
      if (head) {
        placed.push(place(head));
      }
    }
    for (const s of scripts) {
      if (s.root.comment === "__main__") {
        s.root.comment = undefined;
      }
      placed.push(place(s.root));
    }

    const spriteName = baseName(this.fileName);
    const toolbox = this.buildToolbox();
    let total = 0;
    for (const s of placed) {
      total += countBlocks(s.root);
    }

    if (root.hasError) {
      this.diagnostics.push({
        message: "Tree-sitter recovered from syntax errors in this file.",
        severity: "info",
      });
    }
    if (this.truncated) {
      this.diagnostics.push({
        message: `Stopped after ${this.maxBlocks} blocks so the stage stays usable.`,
        severity: "warning",
      });
    }

    return {
      language: "c",
      fileName: spriteName,
      sprites: [{ name: spriteName, scripts: placed }],
      toolbox,
      diagnostics: this.diagnostics,
      stats: { scripts: placed.length, blocks: total, truncated: this.truncated },
    };
  }

  private buildToolbox() {
    const id = createIdFactory("tb");
    const extras: Block[] = [];
    for (const fn of this.functionNames) {
      extras.push(
        this.block("custom.call", {
          fields: { name: fn.name },
          extraArgs: fn.params.map(() => litEmpty()),
        }),
      );
    }
    const fromCatalog = defaultToolbox(id);
    const extraGrouped = groupToolbox(extras);
    const byId = new Map(fromCatalog.map((c) => [c.id, { ...c, blocks: [...c.blocks] }]));
    for (const cat of extraGrouped) {
      const existing = byId.get(cat.id);
      if (existing) {
        existing.blocks.push(...cat.blocks);
      } else {
        byId.set(cat.id, cat);
      }
    }
    return [...byId.values()].filter((c) => c.blocks.length > 0);
  }

  private functionScript(node: Node): Script | undefined {
    const declarator = node.childForFieldName("declarator");
    const body = node.childForFieldName("body");
    const typeNode = node.childForFieldName("type");
    if (!declarator) {
      return undefined;
    }
    const info = functionInfo(declarator);
    this.functionNames.push({ name: info.name, params: info.params.map((p) => p.name) });
    const bodyHead = body ? this.lowerStatement(body) : undefined;
    const isMain = info.name === "main";
    const ret = collapse(typeNode?.text ?? "int");
    const hat = isMain
      ? this.block("events.flag", {
          source: spanOf(node),
          comment: "__main__",
        })
      : this.block("custom.define", {
          source: spanOf(node),
        });
    hat.fields.name = info.name;
    hat.fields.returnType = ret;
    hat.params = info.params;
    hat.line = hatLine(isMain ? "when" : "define", ret, info.name, info.params);
    if (isMain) {
      hat.comment = "__main__";
    }
    hat.next = bodyHead;
    return { id: this.id(), x: 0, y: 0, root: hat };
  }

  private includeBlock(node: Node): Block {
    const path = node.childForFieldName("path");
    const header = headerName(path?.text ?? node.text);
    return this.block("c.include", { fields: { header }, source: spanOf(node) });
  }

  private macroBlock(node: Node): Block {
    const name = node.childForFieldName("name")?.text ?? "MACRO";
    const valueNode = node.childForFieldName("value");
    const value = valueNode ? litString(collapse(valueNode.text)) : litEmpty();
    return this.block("c.defineMacro", { fields: { name }, values: { value }, source: spanOf(node) });
  }

  private preprocIf(node: Node): Block {
    const name = node.childForFieldName("name")?.text ?? node.childForFieldName("condition")?.text ?? "FOO";
    const inner = named(node).filter(
      (n) => !["preproc_else", "preproc_elif", "preproc_elifdef"].includes(n.type) && n !== node.childForFieldName("name") && n !== node.childForFieldName("condition"),
    );
    const bodyParts: Block[] = [];
    for (const child of inner) {
      if (child.type === "function_definition") {
        continue;
      }
      if (child.type === "declaration") {
        bodyParts.push(...this.declarationBlocks(child));
      } else if (child.type.startsWith("preproc_include")) {
        bodyParts.push(this.includeBlock(child));
      } else if (isStatement(child)) {
        const s = this.lowerStatement(child);
        if (s) {
          bodyParts.push(s);
        }
      }
    }
    return this.block("c.ifdef", {
      fields: { name: collapse(name) },
      branches: { body: chain(bodyParts) },
      source: spanOf(node),
    });
  }

  private declarationBlocks(node: Node): Block[] {
    const typeNode = node.childForFieldName("type");
    const typeText = typeNode ? collapse(typeNode.text) : "int";
    const declarators = node.childrenForFieldName("declarator").filter((n): n is Node => n != null);
    const blocks: Block[] = [];
    if (declarators.length === 0) {
      return [this.unknown(node, "stack")];
    }
    for (const decl of declarators) {
      const init = decl.type === "init_declarator" ? decl : null;
      const inner = init?.childForFieldName("declarator") ?? decl;
      const name = declaratorName(inner);
      if (!name) {
        blocks.push(this.unknown(decl, "stack"));
        continue;
      }
      this.variables.add(name);
      const valueNode = init?.childForFieldName("value");
      const value = valueNode ? this.lowerExpr(valueNode) : litEmpty();
      const stars = countPointerStars(inner);
      const fullType = `${typeText}${"*".repeat(stars)}`.replace(/\s+\*/g, "*");
      const set = this.block("data.set", {
        fields: { var: name, type: fullType },
        values: { value },
        source: spanOf(decl),
      });
      set.line = `[${fullType} v] ${name} = {value} :: variables`;
      blocks.push(set);
    }
    return blocks;
  }

  private lowerStatement(node: Node): Block | undefined {
    if (!this.canAdd()) {
      return undefined;
    }
    switch (node.type) {
      case "compound_statement":
        return this.lowerBlock(node);
      case "if_statement":
        return this.lowerIf(node);
      case "while_statement":
        return this.lowerWhile(node);
      case "do_statement":
        return this.lowerDo(node);
      case "for_statement":
        return this.lowerFor(node);
      case "switch_statement":
        return this.lowerSwitch(node);
      case "return_statement":
        return this.lowerReturn(node);
      case "break_statement":
        return this.block("control.break", { source: spanOf(node) });
      case "continue_statement":
        return this.block("control.continue", { source: spanOf(node) });
      case "goto_statement": {
        const label = node.childForFieldName("label")?.text ?? "label";
        return this.block("control.goto", { fields: { label }, source: spanOf(node) });
      }
      case "labeled_statement": {
        const label = node.childForFieldName("label")?.text ?? "label";
        const hat = this.block("control.label", { fields: { label }, source: spanOf(node) });
        const rest = named(node).find((n) => n.type !== "statement_identifier");
        hat.next = rest ? this.lowerStatement(rest) : undefined;
        return hat;
      }
      case "declaration":
        return chain(this.declarationBlocks(node));
      case "expression_statement": {
        const expr = named(node)[0];
        return expr ? this.lowerExprAsStatement(expr) : undefined;
      }
      case "case_statement":
        return this.lowerCase(node);
      case "ERROR":
        return this.unknown(node, "stack");
      default:
        if (node.type === "comment") {
          return undefined;
        }
        return this.unknown(node, "stack");
    }
  }

  private lowerBlock(node: Node): Block | undefined {
    const parts: Block[] = [];
    for (const child of named(node)) {
      if (this.truncated) {
        break;
      }
      if (child.type === "declaration") {
        parts.push(...this.declarationBlocks(child));
        continue;
      }
      const stmt = this.lowerStatement(child);
      if (stmt) {
        parts.push(stmt);
      }
    }
    return chain(parts);
  }

  private lowerIf(node: Node): Block {
    const condNode = unwrapParen(node.childForFieldName("condition"));
    const consequence = node.childForFieldName("consequence");
    const alternative = node.childForFieldName("alternative");
    const condition = condNode ? this.lowerExpr(condNode, true) : litEmpty();
    const body = consequence ? this.lowerStatement(consequence) : undefined;
    if (!alternative) {
      return this.block("control.if", {
        values: { condition },
        branches: { body },
        source: spanOf(node),
      });
    }
    const elseStmt = named(alternative)[0] ?? alternative;
    return this.block("control.ifElse", {
      values: { condition },
      branches: {
        body,
        else: elseStmt ? this.lowerStatement(elseStmt) : undefined,
      },
      source: spanOf(node),
    });
  }

  private lowerWhile(node: Node): Block {
    const condNode = unwrapParen(node.childForFieldName("condition"));
    const bodyNode = node.childForFieldName("body");
    const body = bodyNode ? this.lowerStatement(bodyNode) : undefined;
    if (isForeverCondition(condNode)) {
      return this.block("control.forever", { branches: { body }, source: spanOf(node) });
    }
    const condition = condNode ? this.lowerExpr(condNode, true) : litEmpty();
    return this.block("control.while", {
      values: { condition },
      branches: { body },
      source: spanOf(node),
    });
  }

  private lowerDo(node: Node): Block {
    const condNode = unwrapParen(node.childForFieldName("condition"));
    const bodyNode = node.childForFieldName("body");
    const body = bodyNode ? this.lowerStatement(bodyNode) : undefined;
    const condition = condNode ? this.lowerExpr(condNode, true) : litEmpty();
    return this.block("control.doWhile", {
      values: { condition },
      branches: { body },
      source: spanOf(node),
    });
  }

  private lowerFor(node: Node): Block {
    const init = node.childForFieldName("initializer");
    const cond = node.childForFieldName("condition");
    const update = node.childForFieldName("update");
    const bodyNode = node.childForFieldName("body");
    const body = bodyNode ? this.lowerStatement(bodyNode) : undefined;

    if (!init && !cond && !update) {
      return this.block("control.forever", { branches: { body }, source: spanOf(node) });
    }
    if (isForeverCondition(cond)) {
      const prefix = init ? this.lowerForInit(init) : undefined;
      const forever = this.block("control.forever", { branches: { body }, source: spanOf(node) });
      if (prefix) {
        tail(prefix).next = forever;
        return prefix;
      }
      return forever;
    }

    const counted = matchCountedFor(init, cond, update);
    if (counted) {
      if (counted.varName) {
        this.variables.add(counted.varName);
      }
      const increment = counted.varName
        ? this.block("data.change", {
            fields: { var: counted.varName },
            values: { value: litNumber(1) },
            source: spanOf(update ?? node),
          })
        : undefined;
      let repeatBody = body;
      if (increment) {
        if (repeatBody) {
          tail(repeatBody).next = increment;
        } else {
          repeatBody = increment;
        }
      }
      const repeat = this.block("control.repeat", {
        values: { count: counted.count },
        branches: { body: repeatBody },
        source: spanOf(node),
        comment: undefined,
      });
      const initBlock = init ? this.lowerForInit(init) : counted.initBlock;
      if (initBlock) {
        tail(initBlock).next = repeat;
        return initBlock;
      }
      return repeat;
    }

    return this.block("control.for", {
      values: {
        init: init ? this.lowerForInitExpr(init) : litEmpty(),
        condition: cond ? this.lowerExpr(cond, true) : litEmpty(),
        update: update ? this.lowerExpr(update) : litEmpty(),
      },
      branches: { body },
      source: spanOf(node),
    });
  }

  private lowerForInit(init: Node): Block | undefined {
    if (init.type === "declaration") {
      return chain(this.declarationBlocks(init));
    }
    return this.lowerExprAsStatement(init);
  }

  private lowerForInitExpr(init: Node): Block | Literal {
    if (init.type === "declaration") {
      return litString(collapse(init.text).replace(/;$/, ""));
    }
    return this.lowerExpr(init);
  }

  private lowerSwitch(node: Node): Block {
    const valueNode = unwrapParen(node.childForFieldName("condition") ?? node.childForFieldName("value"));
    const bodyNode = node.childForFieldName("body");
    const value = valueNode ? this.lowerExpr(valueNode) : litEmpty();
    const cases = bodyNode ? named(bodyNode).filter((n) => n.type === "case_statement") : [];
    const parts: Block[] = [];
    for (const c of cases) {
      const lowered = this.lowerCase(c, value);
      if (lowered) {
        parts.push(lowered);
      }
    }
    return this.block("control.switch", {
      values: { value },
      branches: { body: chain(parts) },
      source: spanOf(node),
    });
  }

  private lowerCase(node: Node, switchValue?: Block | Literal): Block {
    const value = node.childForFieldName("value");
    const stmts = named(node).filter((n) => n !== value);
    const body = chain(stmts.map((s) => this.lowerStatement(s)).filter((b): b is Block => Boolean(b)));
    if (!value) {
      return this.block("control.if", {
        values: { condition: litString("default") },
        branches: { body },
        source: spanOf(node),
        comment: "default",
      });
    }
    const eq = this.block("ops.eq", {
      values: {
        left: switchValue ? cloneValue(switchValue, this.id) : this.block("data.get", { fields: { var: "x" } }),
        right: this.lowerExpr(value),
      },
    });
    return this.block("control.if", {
      values: { condition: eq },
      branches: { body },
      source: spanOf(node),
    });
  }

  private lowerReturn(node: Node): Block {
    const exprNode = named(node)[0];
    if (!exprNode) {
      return this.block("control.stop", { source: spanOf(node) });
    }
    return this.block("control.report", {
      values: { value: this.lowerExpr(exprNode) },
      source: spanOf(node),
    });
  }

  private lowerExprAsStatement(node: Node): Block | undefined {
    if (node.type === "assignment_expression") {
      return this.lowerAssignment(node);
    }
    if (node.type === "update_expression") {
      return this.lowerUpdate(node, true);
    }
    if (node.type === "call_expression") {
      return this.lowerCall(node, true);
    }
    if (node.type === "comma_expression") {
      const left = node.childForFieldName("left");
      const right = node.childForFieldName("right");
      const parts: Block[] = [];
      if (left) {
        const l = this.lowerExprAsStatement(left);
        if (l) {
          parts.push(l);
        }
      }
      if (right) {
        const r = this.lowerExprAsStatement(right);
        if (r) {
          parts.push(r);
        }
      }
      return chain(parts);
    }
    const value = this.lowerExpr(node);
    return this.block("c.eval", { values: { value }, source: spanOf(node) });
  }

  private lowerAssignment(node: Node): Block {
    const left = node.childForFieldName("left");
    const right = node.childForFieldName("right");
    const op = node.childForFieldName("operator")?.text ?? "=";
    const value = right ? this.lowerExpr(right) : litEmpty();
    if (left?.type === "subscript_expression" && op === "=") {
      const arrayNode = left.childForFieldName("argument");
      const indexNode = left.childForFieldName("index");
      return this.block("data.replaceItem", {
        values: {
          index: indexNode ? this.lowerExpr(indexNode) : litNumber(0),
          array: arrayNode ? this.lowerExpr(arrayNode) : litEmpty(),
          value,
        },
        source: spanOf(node),
      });
    }
    const name = left && left.type === "identifier" ? left.text : undefined;
    if (name && op === "=") {
      this.variables.add(name);
      return this.block("data.set", { fields: { var: name }, values: { value }, source: spanOf(node) });
    }
    if (name && op === "+=") {
      this.variables.add(name);
      return this.block("data.change", { fields: { var: name }, values: { value }, source: spanOf(node) });
    }
    if (name && op === "-=") {
      this.variables.add(name);
      const neg = this.block("ops.neg", { values: { inner: value } });
      return this.block("data.change", { fields: { var: name }, values: { value: neg }, source: spanOf(node) });
    }
    const lhs = left ? this.lowerExpr(left) : litEmpty();
    const set = this.block("data.set", {
      fields: { var: collapse(left?.text ?? "lhs") },
      values: { value },
      source: spanOf(node),
    });
    if (lhs && !name) {
      set.comment = collapse(left?.text ?? "");
    }
    return set;
  }

  private lowerUpdate(node: Node, asStatement: boolean): Block {
    const arg = node.childForFieldName("argument") ?? named(node)[0];
    const text = node.text;
    const dir = text.includes("--") ? -1 : 1;
    const name = arg?.type === "identifier" ? arg.text : collapse(arg?.text ?? "x");
    this.variables.add(name);
    const block = this.block("data.change", {
      fields: { var: name },
      values: { value: litNumber(dir) },
      source: spanOf(node),
    });
    if (asStatement) {
      return block;
    }
    return this.block("data.get", { fields: { var: name }, source: spanOf(node) });
  }

  private lowerCall(node: Node, asStatement: boolean): Block {
    const fnNode = node.childForFieldName("function");
    const argsNode = node.childForFieldName("arguments");
    const fnName = fnNode?.type === "identifier" ? fnNode.text : collapse(fnNode?.text ?? "call");
    const args = argsNode ? named(argsNode).map((a) => this.lowerExpr(a)) : [];

    if (fnName === "malloc" || fnName === "calloc" || fnName === "realloc") {
      const size = fnName === "calloc" && args.length >= 2
        ? this.block("ops.mul", { values: { left: args[0], right: args[1] } })
        : (args[0] ?? litEmpty());
      const reporter = this.block("sensing.malloc", { values: { size }, source: spanOf(node) });
      if (asStatement) {
        return this.block("c.eval", { values: { value: reporter }, source: spanOf(node) });
      }
      return reporter;
    }
    if (fnName === "free") {
      return this.block("sensing.free", { values: { value: args[0] ?? litEmpty() }, source: spanOf(node) });
    }
    if (fnName === "exit" || fnName === "abort") {
      return this.block("control.stopAll", { source: spanOf(node) });
    }
    if (fnName === "sleep") {
      return this.block("control.wait", { values: { secs: args[0] ?? litNumber(1) }, source: spanOf(node) });
    }
    if (IO_SAY.has(fnName)) {
      return this.lowerPrintf(node, args, asStatement);
    }
    if (IO_ASK.has(fnName)) {
      const prompt = args[0] ?? litString("?");
      return this.block("looks.ask", { values: { prompt }, source: spanOf(node) });
    }
    if (fnName === "sizeof") {
      const reporter = this.block("sensing.sizeof", { values: { value: args[0] ?? litEmpty() }, source: spanOf(node) });
      return asStatement ? this.block("c.eval", { values: { value: reporter } }) : reporter;
    }

    const voidish = asStatement || VOID_CALLEES.has(fnName);
    const call = this.block(voidish ? "custom.call" : "custom.reporter", {
      fields: { name: fnName },
      extraArgs: args,
      source: spanOf(node),
    });
    call.line = voidish ? `${fnName} :: custom` : `${fnName} :: custom`;
    return call;
  }

  private lowerPrintf(node: Node, args: (Block | Literal)[], asStatement: boolean): Block {
    if (args.length === 1 && isLiteral(args[0]) && args[0].kind === "string") {
      return this.block("looks.say", { values: { message: args[0] }, source: spanOf(node) });
    }
    if (args.length === 0) {
      return this.block("looks.say", { values: { message: litString("") }, source: spanOf(node) });
    }
    const message = args[0];
    const block = this.block("looks.printf", {
      values: { message },
      extraArgs: args.slice(1),
      source: spanOf(node),
    });
    if (!asStatement) {
      block.shape = "reporter";
      block.opcode = "custom.reporter";
    }
    return block;
  }

  private lowerExpr(node: Node, asBoolean = false): Block | Literal {
    if (!this.canAdd()) {
      return litEmpty();
    }
    switch (node.type) {
      case "number_literal":
        return litNumber(node.text);
      case "string_literal":
      case "concatenated_string":
        return litString(stripCString(node.text));
      case "char_literal":
        return litString(stripCString(node.text));
      case "true":
        return this.block("ops.eq", { values: { left: litNumber(1), right: litNumber(1) } });
      case "false":
        return this.block("ops.eq", { values: { left: litNumber(0), right: litNumber(1) } });
      case "null":
        return this.block("sensing.null", { source: spanOf(node) });
      case "identifier":
        if (node.text === "NULL") {
          return this.block("sensing.null", { source: spanOf(node) });
        }
        this.variables.add(node.text);
        return this.block("data.get", { fields: { var: node.text }, source: spanOf(node) });
      case "parenthesized_expression": {
        const inner = named(node)[0];
        return inner ? this.lowerExpr(inner, asBoolean) : litEmpty();
      }
      case "binary_expression":
        return this.lowerBinary(node, asBoolean);
      case "unary_expression":
        return this.lowerUnary(node, asBoolean);
      case "update_expression":
        return this.lowerUpdate(node, false);
      case "assignment_expression":
        return this.lowerAssignment(node);
      case "call_expression":
        return this.lowerCall(node, false);
      case "pointer_expression":
        return this.lowerPointer(node);
      case "sizeof_expression":
        return this.lowerSizeof(node);
      case "cast_expression":
        return this.lowerCast(node);
      case "field_expression":
        return this.lowerField(node);
      case "subscript_expression":
        return this.lowerSubscript(node);
      case "conditional_expression":
        return this.lowerTernary(node);
      case "comma_expression": {
        const right = node.childForFieldName("right");
        return right ? this.lowerExpr(right, asBoolean) : litEmpty();
      }
      default:
        return this.unknown(node, asBoolean ? "boolean" : "reporter");
    }
  }

  private lowerBinary(node: Node, asBoolean: boolean): Block {
    const op = node.childForFieldName("operator")?.text ?? named(node).find((n) => BINARY_OPS[n.text])?.text ?? "+";
    const leftNode = node.childForFieldName("left");
    const rightNode = node.childForFieldName("right");
    const boolish = ["<", ">", "<=", ">=", "==", "!=", "&&", "||"].includes(op);
    const left = leftNode ? this.lowerExpr(leftNode, boolish && (op === "&&" || op === "||")) : litEmpty();
    const right = rightNode ? this.lowerExpr(rightNode, boolish && (op === "&&" || op === "||")) : litEmpty();
    if (op === "!=") {
      const eq = this.block("ops.eq", { values: { left, right }, source: spanOf(node) });
      return this.block("ops.not", { values: { inner: eq }, source: spanOf(node) });
    }
    const opcode = BINARY_OPS[op] ?? "ops.add";
    const def = CATALOG.find((d) => d.opcode === opcode);
    const shape = def?.shape ?? (boolish ? "boolean" : "reporter");
    return this.block(opcode, {
      values: { left, right },
      source: spanOf(node),
      shape,
    });
  }

  private lowerUnary(node: Node, asBoolean: boolean): Block | Literal {
    const op = node.childForFieldName("operator")?.text ?? node.child(0)?.text ?? "";
    const arg = node.childForFieldName("argument") ?? named(node)[0];
    const inner = arg ? this.lowerExpr(arg, op === "!") : litEmpty();
    if (op === "!") {
      return this.block("ops.not", { values: { inner }, source: spanOf(node) });
    }
    if (op === "-") {
      return this.block("ops.neg", { values: { inner }, source: spanOf(node) });
    }
    if (op === "+") {
      return inner;
    }
    if (op === "~") {
      return this.block("c.unknownReporter", { fields: { text: collapse(node.text) }, source: spanOf(node) });
    }
    return inner;
  }

  private lowerPointer(node: Node): Block {
    const op = node.childForFieldName("operator")?.text ?? "";
    const arg = node.childForFieldName("argument");
    const value = arg ? this.lowerExpr(arg) : litEmpty();
    if (op === "&") {
      return this.block("sensing.addressOf", { values: { value }, source: spanOf(node) });
    }
    return this.block("sensing.deref", { values: { value }, source: spanOf(node) });
  }

  private lowerSizeof(node: Node): Block {
    const inner = node.childForFieldName("value") ?? node.childForFieldName("type") ?? named(node)[0];
    const value = inner
      ? inner.type === "type_descriptor" || inner.type === "primitive_type" || inner.type === "type_identifier"
        ? litString(collapse(inner.text))
        : this.lowerExpr(inner)
      : litEmpty();
    return this.block("sensing.sizeof", { values: { value }, source: spanOf(node) });
  }

  private lowerCast(node: Node): Block {
    const typeNode = node.childForFieldName("type");
    const valueNode = node.childForFieldName("value");
    return this.block("ops.cast", {
      fields: { type: collapse(typeNode?.text ?? "int") },
      values: { value: valueNode ? this.lowerExpr(valueNode) : litEmpty() },
      source: spanOf(node),
    });
  }

  private lowerField(node: Node): Block {
    const arg = node.childForFieldName("argument");
    const field = node.childForFieldName("field")?.text ?? "field";
    const op = node.childForFieldName("operator")?.text ?? ".";
    const value = arg ? this.lowerExpr(arg) : litEmpty();
    const inner = op === "->" ? this.block("sensing.deref", { values: { value } }) : value;
    return this.block("sensing.field", {
      fields: { field },
      values: { value: inner },
      source: spanOf(node),
    });
  }

  private lowerSubscript(node: Node): Block {
    const argument = node.childForFieldName("argument");
    const index = node.childForFieldName("index");
    return this.block("sensing.subscript", {
      values: {
        array: argument ? this.lowerExpr(argument) : litEmpty(),
        index: index ? this.lowerExpr(index) : litEmpty(),
      },
      source: spanOf(node),
    });
  }

  private lowerTernary(node: Node): Block {
    const condition = node.childForFieldName("condition");
    const thenN = node.childForFieldName("consequence");
    const elseN = node.childForFieldName("alternative");
    return this.block("ops.ternary", {
      values: {
        condition: condition ? this.lowerExpr(condition, true) : litEmpty(),
        then: thenN ? this.lowerExpr(thenN) : litEmpty(),
        else: elseN ? this.lowerExpr(elseN) : litEmpty(),
      },
      source: spanOf(node),
    });
  }

  private unknown(node: Node, shape: "stack" | "reporter" | "boolean"): Block {
    const opcode = shape === "stack" ? "c.unknown" : "c.unknownReporter";
    return this.block(opcode, {
      fields: { text: collapse(node.text).slice(0, 96) },
      source: spanOf(node),
      shape,
    });
  }

  private block(
    opcode: string,
    init: {
      fields?: Record<string, string>;
      values?: Record<string, Block | Literal>;
      branches?: Record<string, Block | undefined>;
      extraArgs?: (Block | Literal)[];
      source?: SourceSpan;
      comment?: string;
      shape?: Block["shape"];
    } = {},
  ): Block {
    this.canAdd();
    const def = CATALOG.find((d) => d.opcode === opcode);
    if (!def) {
      throw new Error(`unknown opcode ${opcode}`);
    }
    const block = makeBlock(this.id, {
      opcode,
      shape: init.shape ?? def.shape,
      category: def.category,
      line: def.line,
      closer: def.closer,
      fields: { ...(def.fields ?? {}), ...(init.fields ?? {}) },
      values: init.values ?? {},
      branches: init.branches ?? {},
      extraArgs: init.extraArgs,
      source: init.source,
      comment: init.comment,
    });
    return block;
  }

  private canAdd(): boolean {
    this.blockCount += 1;
    if (this.blockCount > this.maxBlocks) {
      this.truncated = true;
      return false;
    }
    return true;
  }
}

function named(node: Node): Node[] {
  return (node.namedChildren ?? []).filter((n): n is Node => n != null && n.isNamed);
}

function spanOf(node: Node): SourceSpan {
  return {
    start: { line: node.startPosition.row, column: node.startPosition.column, offset: node.startIndex },
    end: { line: node.endPosition.row, column: node.endPosition.column, offset: node.endIndex },
  };
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function baseName(file: string): string {
  const parts = file.replaceAll("\\", "/").split("/");
  return parts[parts.length - 1] || file;
}

function unwrapParen(node: Node | null): Node | null {
  if (!node) {
    return null;
  }
  if (node.type === "parenthesized_expression") {
    return named(node)[0] ?? node;
  }
  return node;
}

function isStatement(node: Node): boolean {
  return node.type.endsWith("_statement") || node.type === "declaration";
}

function isForeverCondition(node: Node | null): boolean {
  if (!node) {
    return true;
  }
  const t = collapse(node.text);
  return t === "1" || t === "true" || t === "(1)" || t === "(true)";
}

function declaratorName(node: Node | null): string | undefined {
  if (!node) {
    return undefined;
  }
  if (node.type === "identifier") {
    return node.text;
  }
  const inner = node.childForFieldName("declarator") ?? named(node).find((n) => n.type !== "parameter_list");
  return inner ? declaratorName(inner) : undefined;
}

function functionInfo(declarator: Node): { name: string; params: { type: string; name: string }[] } {
  let d: Node | null = declarator;
  while (d && d.type !== "function_declarator") {
    d = d.childForFieldName("declarator") ?? named(d)[0] ?? null;
  }
  if (!d) {
    return { name: declaratorName(declarator) ?? "fn", params: [] };
  }
  const name = declaratorName(d.childForFieldName("declarator")) ?? "fn";
  const paramsNode = d.childForFieldName("parameters");
  const params: { type: string; name: string }[] = [];
  if (paramsNode) {
    for (const p of named(paramsNode)) {
      if (p.type === "parameter_declaration") {
        const n = declaratorName(p.childForFieldName("declarator"));
        if (n && n !== "void") {
          const typeText = collapse(p.childForFieldName("type")?.text ?? "int");
          const stars = countPointerStars(p.childForFieldName("declarator"));
          params.push({ type: `${typeText}${"*".repeat(stars)}`.replace(/\s+\*/g, "*"), name: n });
        }
      }
    }
  }
  return { name, params };
}

function countPointerStars(node: Node | null): number {
  let n = 0;
  let d = node;
  while (d && (d.type === "pointer_declarator" || d.type === "abstract_pointer_declarator")) {
    n += 1;
    d = d.childForFieldName("declarator") ?? named(d)[0] ?? null;
  }
  return n;
}

function tail(block: Block): Block {
  let current = block;
  while (current.next) {
    current = current.next;
  }
  return current;
}

function cloneValue(value: Block | Literal, id: IdFactory): Block | Literal {
  if (isLiteral(value)) {
    return { ...value };
  }
  return makeBlock(id, {
    opcode: value.opcode,
    shape: value.shape,
    category: value.category,
    line: value.line,
    closer: value.closer,
    fields: { ...value.fields },
    values: Object.fromEntries(Object.entries(value.values).map(([k, v]) => [k, cloneValue(v, id)])),
    branches: {},
    extraArgs: value.extraArgs?.map((a) => cloneValue(a, id)),
    source: value.source,
    comment: value.comment,
  });
}

interface CountedFor {
  count: Block | Literal;
  varName?: string;
  initBlock?: Block;
}

function matchCountedFor(init: Node | null, cond: Node | null, update: Node | null): CountedFor | undefined {
  if (!cond || !update) {
    return undefined;
  }
  const updateText = collapse(update.text);
  const condNode = cond.type === "binary_expression" ? cond : null;
  if (!condNode) {
    return undefined;
  }
  const op = condNode.childForFieldName("operator")?.text;
  if (op !== "<" && op !== "<=") {
    return undefined;
  }
  const left = condNode.childForFieldName("left");
  const right = condNode.childForFieldName("right");
  if (!left || left.type !== "identifier" || !right) {
    return undefined;
  }
  const name = left.text;
  const inc = new RegExp(`^(\\+\\+${name}|${name}\\+\\+|${name} \\+= 1)$`);
  if (!inc.test(updateText.replace(/\s+/g, " "))) {
    return undefined;
  }

  let start = 0;
  let initBlock: Block | undefined;
  let varName = name;
  if (init) {
    if (init.type === "declaration") {
      const decl = init.childrenForFieldName("declarator").find((n): n is Node => n != null);
      const inner = decl?.type === "init_declarator" ? decl : null;
      const value = inner?.childForFieldName("value");
      const declName = declaratorName(inner?.childForFieldName("declarator") ?? decl ?? null);
      if (declName) {
        varName = declName;
      }
      if (value?.type === "number_literal") {
        start = Number(value.text);
      } else if (value) {
        return undefined;
      }
    } else if (init.type === "assignment_expression") {
      const l = init.childForFieldName("left");
      const r = init.childForFieldName("right");
      if (l?.type === "identifier") {
        varName = l.text;
      }
      if (r?.type === "number_literal") {
        start = Number(r.text);
      } else {
        return undefined;
      }
    } else {
      return undefined;
    }
  }

  if (varName !== name) {
    return undefined;
  }

  if (right.type === "number_literal") {
    const bound = Number(right.text);
    const count = op === "<" ? bound - start : bound - start + 1;
    if (!Number.isFinite(count) || count < 0) {
      return undefined;
    }
    return { count: litNumber(count), varName, initBlock };
  }
  if (right.type === "identifier" && start === 0 && op === "<") {
    return {
      count: {
        id: `n-${name}`,
        opcode: "data.get",
        shape: "reporter",
        category: "variables",
        line: "{var}",
        fields: { var: right.text },
        values: {},
        branches: {},
      },
      varName,
      initBlock,
    };
  }
  return undefined;
}
