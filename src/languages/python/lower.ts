import type { Node } from "web-tree-sitter";
import { makeBlock, litEmpty, litNumber, litString, isLiteral } from "../../ir/builders";
import { chain, countBlocks, createIdFactory, type IdFactory } from "../../ir/ids";
import type { Block, Diagnostic, Literal, Program, Script, SourceSpan } from "../../ir/types";
import { rebuildCompoundDef } from "../../library/hats";
import { pythonToolbox, pyPrototype } from "./catalog";

export function lowerPython(root: Node, options: { fileName: string; maxBlocks: number }): Program {
  return new PyLowerer(options.fileName, options.maxBlocks).lowerModule(root);
}

class PyLowerer {
  readonly id: IdFactory = createIdFactory("py");
  readonly diagnostics: Diagnostic[] = [];
  truncated = false;
  private n = 0;

  constructor(
    private readonly fileName: string,
    private readonly maxBlocks: number,
  ) {}

  lowerModule(root: Node): Program {
    const imports: Block[] = [];
    const toplevel: Block[] = [];
    const scripts: Script[] = [];
    for (const child of named(root)) {
      if (this.truncated) {
        break;
      }
      if (child.type === "import_statement" || child.type === "import_from_statement" || child.type === "future_import_statement") {
        const b = this.lowerStmt(child);
        if (b) {
          imports.push(b);
        }
        continue;
      }
      if (child.type === "function_definition" || child.type === "decorated_definition") {
        const s = this.asScript(this.lowerStmt(child));
        if (s) {
          scripts.push(s);
        }
        continue;
      }
      if (child.type === "class_definition") {
        const s = this.asScript(this.lowerClass(child));
        if (s) {
          scripts.push(s);
        }
        continue;
      }
      const b = this.lowerStmt(child);
      if (b) {
        toplevel.push(b);
      }
    }
    const placed: Script[] = [];
    let y = 16;
    const place = (rootBlock: Block): void => {
      placed.push({ id: this.id(), x: 12, y, root: rootBlock });
      y += 28;
    };
    if (imports.length) {
      const head = chain(imports);
      if (head) {
        place(head);
      }
    }
    for (const s of scripts) {
      place(s.root);
    }
    if (toplevel.length) {
      const head = chain(toplevel);
      if (head) {
        place(head);
      }
    }
    let blocks = 0;
    for (const s of placed) {
      blocks += countBlocks(s.root);
    }
    const name = this.fileName.split("/").pop() ?? this.fileName;
    return {
      language: "python",
      fileName: name,
      sprites: [{ name, scripts: placed }],
      toolbox: pythonToolbox(),
      diagnostics: this.diagnostics,
      stats: { scripts: placed.length, blocks, truncated: this.truncated },
    };
  }

  private asScript(block: Block | undefined): Script | undefined {
    if (!block) {
      return undefined;
    }
    return { id: this.id(), x: 0, y: 0, root: block };
  }

  private bump(): boolean {
    this.n += 1;
    if (this.n > this.maxBlocks) {
      this.truncated = true;
      return false;
    }
    return true;
  }

  private lowerStmt(node: Node): Block | undefined {
    if (!this.bump()) {
      return undefined;
    }
    switch (node.type) {
      case "function_definition":
        return this.lowerFunction(node);
      case "decorated_definition":
        return this.lowerStmt(node.childForFieldName("definition") ?? named(node)[named(node).length - 1]!);
      case "class_definition":
        return this.lowerClass(node);
      case "import_statement":
        return pyPrototype("py.import", this.id, {
          values: { module: this.nameBox(collapse(named(node)[0]?.text ?? "sys")) },
          source: spanOf(node),
        });
      case "import_from_statement": {
        const mod = node.childForFieldName("module_name")?.text ?? named(node)[0]?.text ?? "os";
        const nm = node.childForFieldName("name")?.text ?? named(node)[1]?.text ?? "*";
        return pyPrototype("py.importFrom", this.id, {
          values: {
            module: this.nameBox(collapse(mod)),
            name: this.nameBox(collapse(nm)),
          },
          source: spanOf(node),
        });
      }
      case "if_statement":
        return this.lowerIf(node);
      case "while_statement": {
        const cond = node.childForFieldName("condition");
        const body = node.childForFieldName("body");
        return pyPrototype("control.while", this.id, {
          values: { condition: cond ? this.lowerExpr(cond, true) : litEmpty() },
          branches: { body: this.lowerBlock(body) },
          source: spanOf(node),
        });
      }
      case "for_statement": {
        const left = node.childForFieldName("left");
        const right = node.childForFieldName("right");
        const body = node.childForFieldName("body");
        return pyPrototype("py.for", this.id, {
          fields: { var: collapse(left?.text ?? "x") },
          values: { iter: right ? this.lowerExpr(right) : litEmpty() },
          branches: { body: this.lowerBlock(body) },
          source: spanOf(node),
        });
      }
      case "with_statement": {
        const body = node.childForFieldName("body");
        const item = named(node).find((n) => n.type === "with_clause" || n.type === "with_item");
        return pyPrototype("py.with", this.id, {
          values: { ctx: item ? litString(collapse(item.text)) : litEmpty() },
          branches: { body: this.lowerBlock(body) },
          source: spanOf(node),
        });
      }
      case "try_statement": {
        const body = node.childForFieldName("body");
        const except = named(node).find((n) => n.type === "except_clause");
        const exceptBlock = except
          ? named(except).find((n) => n.type === "block") ?? except.childForFieldName("body")
          : undefined;
        const exceptBody = exceptBlock ? this.lowerBlock(exceptBlock) : undefined;
        return pyPrototype("py.try", this.id, {
          branches: { body: this.lowerBlock(body), else: exceptBody },
          source: spanOf(node),
        });
      }
      case "return_statement": {
        const inner = named(node)[0];
        if (!inner) {
          return pyPrototype("control.stop", this.id, { source: spanOf(node) });
        }
        return pyPrototype("control.report", this.id, {
          values: { value: this.lowerExpr(inner) },
          source: spanOf(node),
        });
      }
      case "break_statement":
        return pyPrototype("control.break", this.id, { source: spanOf(node) });
      case "continue_statement":
        return pyPrototype("control.continue", this.id, { source: spanOf(node) });
      case "pass_statement":
        return pyPrototype("py.pass", this.id, { source: spanOf(node) });
      case "raise_statement":
        return pyPrototype("py.raise", this.id, {
          values: { value: named(node)[0] ? this.lowerExpr(named(node)[0]) : litEmpty() },
          source: spanOf(node),
        });
      case "expression_statement": {
        const inner = named(node)[0];
        return inner ? this.lowerExprStmt(inner) : undefined;
      }
      case "block":
        return this.lowerBlock(node);
      default:
        if (node.type.endsWith("_statement")) {
          return this.unknown(node);
        }
        return this.lowerExprStmt(node);
    }
  }

  private lowerFunction(node: Node): Block {
    const name = node.childForFieldName("name")?.text ?? "fn";
    const ret = node.childForFieldName("return_type")?.text ?? "";
    const paramsNode = node.childForFieldName("parameters");
    const params = paramsNode
      ? named(paramsNode)
          .map((p) => paramOf(p))
          .filter((p): p is { type: string; name: string } => Boolean(p))
      : [];
    const body = this.lowerBlock(node.childForFieldName("body"));
    const block = pyPrototype("py.def", this.id, {
      source: spanOf(node),
      fields: { name, returnType: ret || "None" },
      branches: { body },
    });
    block.params = params;
    block.values.ret = pyPrototype("type.named", this.id, { fields: { name: ret || "None" } });
    params.forEach((p, i) => {
      block.values[`t${i}`] = pyPrototype("type.named", this.id, { fields: { name: p.type || "Any" } });
      block.fields[`p${i}`] = p.name;
    });
    rebuildCompoundDef(block);
    return block;
  }

  private lowerClass(node: Node): Block {
    const name = node.childForFieldName("name")?.text ?? "C";
    const body = this.lowerBlock(node.childForFieldName("body"));
    return pyPrototype("py.class", this.id, {
      fields: { name },
      branches: { body },
      source: spanOf(node),
    });
  }

  private lowerIf(node: Node): Block {
    const cond = node.childForFieldName("condition");
    const cons = node.childForFieldName("consequence");
    const alt = node.childForFieldName("alternative");
    const condition = cond ? this.lowerExpr(cond, true) : litEmpty();
    const body = this.lowerBlock(cons);
    if (!alt) {
      return pyPrototype("control.if", this.id, {
        values: { condition },
        branches: { body },
        source: spanOf(node),
      });
    }
    return pyPrototype("control.ifElse", this.id, {
      values: { condition },
      branches: { body, else: this.lowerStmt(alt) ?? this.lowerBlock(alt) },
      source: spanOf(node),
    });
  }

  private lowerBlock(node: Node | null): Block | undefined {
    if (!node) {
      return undefined;
    }
    if (node.type !== "block") {
      return this.lowerStmt(node);
    }
    const parts: Block[] = [];
    for (const child of named(node)) {
      const s = this.lowerStmt(child);
      if (s) {
        parts.push(s);
      }
    }
    return chain(parts);
  }

  private lowerExprStmt(node: Node): Block | undefined {
    if (node.type === "assignment" || node.type === "augmented_assignment" || node.type === "annotated_assignment") {
      const left = node.childForFieldName("left") ?? named(node)[0];
      const right = node.childForFieldName("right") ?? named(node)[1];
      const typeN = node.childForFieldName("type");
      if (typeN && left) {
        return pyPrototype("data.declareInit", this.id, {
          fields: { name: collapse(left.text) },
          values: {
            type: this.lowerPyType(typeN),
            value: right ? this.lowerExpr(right) : litEmpty(),
          },
          source: spanOf(node),
        });
      }
      return pyPrototype("data.assign", this.id, {
        values: {
          lhs: left ? this.lowerExpr(left) : litEmpty(),
          rhs: right ? this.lowerExpr(right) : litEmpty(),
        },
        source: spanOf(node),
      });
    }
    if (node.type === "call") {
      return this.lowerCall(node, true);
    }
    return pyPrototype("custom.call", this.id, {
      fields: { name: "expr" },
      extraArgs: [this.lowerExpr(node)],
      source: spanOf(node),
    });
  }

  private lowerCall(node: Node, asStmt: boolean): Block {
    const fn = node.childForFieldName("function");
    const argsNode = node.childForFieldName("arguments");
    const args = argsNode ? named(argsNode).map((a) => this.lowerExpr(a)) : [];
    if (fn?.type === "attribute") {
      const obj = fn.childForFieldName("object");
      const meth = fn.childForFieldName("attribute")?.text ?? "m";
      const block = pyPrototype("custom.method", this.id, {
        fields: { name: meth },
        values: { obj: obj ? this.lowerExpr(obj) : litEmpty() },
        extraArgs: args,
        source: spanOf(node),
      });
      block.shape = asStmt ? "stack" : "reporter";
      block.line = `{obj} . ${meth} :: custom`;
      return block;
    }
    const name = collapse(fn?.text ?? "fn");
    const block = pyPrototype(asStmt ? "custom.call" : "custom.reporter", this.id, {
      fields: { name },
      extraArgs: args,
      source: spanOf(node),
    });
    block.line = `${name} :: custom`;
    return block;
  }

  private lowerExpr(node: Node, asBoolean = false): Block | Literal {
    void asBoolean;
    switch (node.type) {
      case "integer":
      case "float":
        return litNumber(node.text);
      case "string":
        return litString(unquote(node.text));
      case "true":
        return pyPrototype("ops.eq", this.id, { values: { left: litNumber(1), right: litNumber(1) } });
      case "false":
        return pyPrototype("ops.eq", this.id, { values: { left: litNumber(0), right: litNumber(1) } });
      case "none":
        return pyPrototype("py.none", this.id, { source: spanOf(node) });
      case "identifier":
        return pyPrototype("data.get", this.id, { fields: { var: node.text }, source: spanOf(node) });
      case "parenthesized_expression":
        return named(node)[0] ? this.lowerExpr(named(node)[0]) : litEmpty();
      case "binary_operator":
      case "boolean_operator":
      case "comparison_operator":
        return this.lowerBin(node);
      case "not_operator": {
        const inner = named(node)[0];
        return pyPrototype("ops.not", this.id, {
          values: { inner: inner ? this.lowerExpr(inner, true) : litEmpty() },
          source: spanOf(node),
        });
      }
      case "list":
      case "tuple":
      case "set": {
        const items = named(node).map((n) => this.lowerExpr(n));
        const opcode = node.type === "tuple" ? "py.tuple" : "py.list";
        return pyPrototype(opcode, this.id, {
          extraArgs: items,
          source: spanOf(node),
        });
      }
      case "call":
        return this.lowerCall(node, false);
      case "lambda": {
        const paramsN = node.childForFieldName("parameters");
        const body = node.childForFieldName("body");
        const p0 = paramsN ? named(paramsN)[0]?.text ?? "x" : "x";
        return pyPrototype("ops.lambda", this.id, {
          fields: { p0 },
          values: { body: body ? this.lowerExpr(body) : litEmpty() },
          source: spanOf(node),
        });
      }
      case "attribute": {
        const obj = node.childForFieldName("object");
        const attr = node.childForFieldName("attribute")?.text ?? "x";
        return pyPrototype("py.attr", this.id, {
          fields: { field: attr },
          values: { value: obj ? this.lowerExpr(obj) : litEmpty() },
          source: spanOf(node),
        });
      }
      case "subscript": {
        const value = node.childForFieldName("value");
        const index = node.childForFieldName("subscript") ?? named(node)[1];
        return pyPrototype("sensing.subscript", this.id, {
          values: {
            array: value ? this.lowerExpr(value) : litEmpty(),
            index: index ? this.lowerExpr(index) : litEmpty(),
          },
          source: spanOf(node),
        });
      }
      default:
        return litString(collapse(node.text).slice(0, 80));
    }
  }

  private lowerBin(node: Node): Block {
    const op = node.childForFieldName("operators")?.text ?? named(node).find((n) => "+-*/%<>=!andor".includes(n.text[0] ?? ""))?.text ?? "+";
    const left = named(node)[0];
    const right = named(node)[named(node).length - 1];
    const opcode =
      op === "+"
        ? "ops.add"
        : op === "-"
          ? "ops.sub"
          : op === "*"
            ? "ops.mul"
            : op === "/"
              ? "ops.div"
              : op === "%"
                ? "ops.mod"
                : op === "<"
                  ? "ops.lt"
                  : op === ">"
                    ? "ops.gt"
                    : op === "=="
                      ? "ops.eq"
                      : op === "and"
                        ? "ops.and"
                        : op === "or"
                          ? "ops.or"
                          : op === "in" || op === "not in"
                            ? "ops.in"
                            : "ops.add";
    return pyPrototype(opcode, this.id, {
      values: {
        left: left ? this.lowerExpr(left) : litEmpty(),
        right: right ? this.lowerExpr(right) : litEmpty(),
      },
      source: spanOf(node),
    });
  }

  private nameBox(name: string): Block {
    return pyPrototype("type.named", this.id, { fields: { name: name || "x" } });
  }

  private lowerPyType(node: Node): Block {
    if (node.type === "type") {
      const inner = named(node)[0];
      return inner ? this.lowerPyType(inner) : pyPrototype("type.named", this.id, { fields: { name: collapse(node.text) || "Any" } });
    }
    if (node.type === "generic_type") {
      const base = named(node).find((n) => n.type === "identifier") ?? named(node)[0];
      const params = named(node).find((n) => n.type === "type_parameter");
      const arg = params ? named(params)[0] : named(node)[1];
      return pyPrototype("type.tmpl", this.id, {
        values: {
          base: base ? this.lowerPyType(base) : pyPrototype("type.named", this.id, { fields: { name: "list" } }),
          arg: arg ? this.lowerPyType(arg) : pyPrototype("type.named", this.id, { fields: { name: "Any" } }),
        },
        source: spanOf(node),
      });
    }
    if (node.type === "subscript") {
      const value = node.childForFieldName("value");
      const index = node.childForFieldName("subscript") ?? named(node)[1];
      return pyPrototype("type.tmpl", this.id, {
        values: {
          base: value ? this.lowerPyType(value) : pyPrototype("type.named", this.id, { fields: { name: "list" } }),
          arg: index ? this.lowerPyType(index) : pyPrototype("type.named", this.id, { fields: { name: "Any" } }),
        },
        source: spanOf(node),
      });
    }
    if (node.type === "attribute") {
      const obj = node.childForFieldName("object");
      const attr = node.childForFieldName("attribute")?.text ?? "x";
      return pyPrototype("type.tmpl", this.id, {
        values: {
          base: obj ? this.lowerPyType(obj) : pyPrototype("type.named", this.id, { fields: { name: "mod" } }),
          arg: pyPrototype("type.named", this.id, { fields: { name: attr } }),
        },
        source: spanOf(node),
      });
    }
    return pyPrototype("type.named", this.id, { fields: { name: collapse(node.text) || "Any" }, source: spanOf(node) });
  }

  private unknown(node: Node): Block {
    return pyPrototype("py.pass", this.id, {
      source: spanOf(node),
      comment: collapse(node.text).slice(0, 60),
    });
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

function unquote(text: string): string {
  let s = text.trim();
  s = s.replace(/^[fFrRbBuU]+/, "");
  if ((s.startsWith('"""') && s.endsWith('"""')) || (s.startsWith("'''") && s.endsWith("'''"))) {
    return s.slice(3, -3);
  }
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function paramOf(node: Node): { type: string; name: string } | undefined {
  if (node.type === "identifier") {
    return { type: "", name: node.text };
  }
  const name = node.childForFieldName("name")?.text ?? named(node)[0]?.text;
  if (!name) {
    return undefined;
  }
  const type = node.childForFieldName("type")?.text ?? "";
  return { type, name };
}

void isLiteral;
void makeBlock;
void litNumber;
