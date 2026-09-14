import { isLiteral } from "../ir/builders";
import type { Block, Literal, Program } from "../ir/types";

const STDLIB = new Set([
  "stdio.h",
  "stdlib.h",
  "string.h",
  "math.h",
  "unistd.h",
  "stdbool.h",
  "stdint.h",
  "time.h",
  "stdarg.h",
  "assert.h",
  "limits.h",
  "float.h",
  "ctype.h",
  "errno.h",
  "signal.h",
  "setjmp.h",
  "locale.h",
  "wchar.h",
]);

export function emitC(program: Program): string {
  const includes: string[] = [];
  const macros: string[] = [];
  const globals: string[] = [];
  const functions: string[] = [];
  let mainFn: string | undefined;
  const needed = new Set<string>();

  for (const sprite of program.sprites) {
    for (const script of sprite.scripts) {
      harvestTopLevel(script.root, { includes, macros, globals, functions, needed, isMain: false });
    }
  }

  for (const sprite of program.sprites) {
    for (const script of sprite.scripts) {
      const hat = script.root;
      if (hat.opcode === "events.flag") {
        const ret = typeExpr(hat.values.ret, needed) || hat.fields.returnType || "int";
        const plist = paramListOf(hat, needed);
        mainFn = emitFunction(hat.fields.name || "main", hat.params?.map((p) => p.name) ?? [], hat.next, {
          needed,
          isMain: true,
          returnType: ret,
          paramList: plist || "void",
        });
      } else if (hat.opcode === "custom.define") {
        functions.push(emitDefined(hat, needed));
      } else if (hat.opcode === "control.label") {
        functions.push(emitFunction(sanitizeIdent(hat.fields.label || "label"), [], hat.next, { needed, isMain: false, returnType: "void" }));
      } else if (hat.opcode === "cpp.class") {
        functions.push(emitStatement(hat, needed, false, 0).join("\n"));
      }
    }
  }

  if (usesOpcode(program, "looks.say") || usesOpcode(program, "looks.printf") || usesOpcode(program, "looks.think") || usesOpcode(program, "looks.ask")) {
    needed.add("stdio.h");
  }
  if (usesOpcode(program, "sensing.malloc") || usesOpcode(program, "sensing.free") || usesOpcode(program, "control.stopAll")) {
    needed.add("stdlib.h");
  }
  if (usesOpcode(program, "control.wait")) {
    needed.add("unistd.h");
  }

  const includeLines = mergeIncludes(includes, needed);
  const parts = [
    includeLines.join("\n"),
    macros.join("\n"),
    globals.join("\n"),
    functions.filter(Boolean).join("\n\n"),
    mainFn ?? "",
  ].filter((p) => p.trim().length > 0);

  return `${parts.join("\n\n")}\n`;
}

function harvestTopLevel(
  root: Block,
  into: { includes: string[]; macros: string[]; globals: string[]; functions: string[]; needed: Set<string>; isMain: boolean },
): void {
  if (root.opcode === "events.flag" || root.opcode === "custom.define" || root.opcode === "control.label" || root.opcode === "cpp.class") {
    return;
  }
  let current: Block | undefined = root;
  while (current) {
    if (current.opcode === "c.include") {
      const header = current.fields.header || "stdio.h";
      into.includes.push(includeLine(header));
    } else if (current.opcode === "c.defineMacro") {
      into.macros.push(`#define ${sanitizeIdent(current.fields.name || "N")} ${expr(current.values.value, into.needed)}`);
    } else if (current.opcode === "data.declare" || current.opcode === "data.declareInit") {
      into.globals.push(emitDeclare(current, into.needed, ""));
    } else if (current.opcode === "data.set" || current.opcode === "data.assign") {
      const name = sanitizeIdent(current.fields.var || current.fields.name || "x");
      const type = typeExpr(current.values.type, into.needed) || cTypeFromComment(current.comment) || guessType(name);
      const value = current.values.value ?? current.values.rhs;
      if (value && !(isLiteral(value) && value.kind === "empty")) {
        into.globals.push(`${type} ${name} = ${expr(value, into.needed)};`);
      } else {
        into.globals.push(`${type} ${name};`);
      }
    }
    current = current.next;
  }
}

function emitDefined(hat: Block, needed: Set<string>): string {
  const parsed = parseDefine(hat);
  const returnType = typeExpr(hat.values.ret, needed) || hat.fields.returnType || (chainHas(hat.next, "control.report") ? "int" : "void");
  const plist = paramListOf(hat, needed) || parsed.params.map((p) => `${guessType(p)} ${p}`).join(", ");
  const name = hat.fields.name || parsed.name;
  const qual = hat.fields.parentClass ? `${sanitizeIdent(hat.fields.parentClass)}::${sanitizeIdent(name)}` : name;
  return emitFunction(qual, hat.params?.map((p) => p.name) ?? parsed.params, hat.next, {
    needed,
    isMain: false,
    returnType,
    paramList: plist || "void",
  });
}

function paramListOf(hat: Block, needed: Set<string>): string {
  const params = hat.params ?? [];
  if (!params.length) {
    return "";
  }
  return params
    .map((p, i) => {
      const t = hat.values[`t${i}`];
      const ty = t ? typeExpr(t, needed) : p.type || "int";
      const name = hat.fields[`p${i}`] || p.name;
      return `${ty} ${name}`.trim();
    })
    .join(", ");
}

function parseDefine(hat: Block): { name: string; params: string[] } {
  const raw = hat.fields.signature || hat.fields.name || hat.line.replace(/^define\s+/, "");
  const tokens = raw.replace(/[()]/g, " ").split(/\s+/).filter(Boolean);
  const name = sanitizeIdent(tokens[0] || "fn");
  return { name, params: tokens.slice(1).map(sanitizeIdent) };
}

function emitFunction(
  name: string,
  _params: string[],
  body: Block | undefined,
  opts: { needed: Set<string>; isMain: boolean; returnType: string; paramList?: string },
): string {
  const decls = new Set<string>();
  collectDecls(body, decls, new Set(_params));
  const lines: string[] = [];
  for (const d of decls) {
    lines.push(`  ${d}`);
  }
  const bodyLines = emitChain(body, opts.needed, opts.isMain, 1);
  const params = opts.paramList && opts.paramList.length ? opts.paramList : "void";
  const signature = `${opts.returnType} ${name}(${params})`;
  const inner = [...lines, ...bodyLines].join("\n");
  return `${signature} {\n${inner || "  /* empty */"}\n}`;
}

function collectDecls(head: Block | undefined, _out: Set<string>, _params: Set<string>): void {
  void head;
  void _out;
  void _params;
}

function emitChain(head: Block | undefined, needed: Set<string>, isMain: boolean, indent: number): string[] {
  const lines: string[] = [];
  let current = head;
  while (current) {
    lines.push(...emitStatement(current, needed, isMain, indent));
    current = current.next;
  }
  return lines;
}

function emitRepeatAsFor(block: Block, needed: Set<string>, isMain: boolean, indent: number): string[] {
  const pad = "  ".repeat(indent);
  const count = expr(block.values.count, needed);
  const inner = emitChain(block.branches.body, needed, isMain, indent + 1);
  return [`${pad}for (int _i = 0; _i < ${count}; _i++) {`, ...inner, `${pad}}`];
}

function emitStatement(block: Block, needed: Set<string>, isMain: boolean, indent: number): string[] {
  const pad = "  ".repeat(indent);
  switch (block.opcode) {
    case "cpp.class":
      return [
        `${pad}${block.fields.kind === "struct" ? "struct" : "class"} ${block.fields.name || "T"} {`,
        `${pad}public:`,
        ...emitChain(block.branches.body, needed, isMain, indent + 1),
        `${pad}};`,
      ];
    case "c.include":
    case "c.defineMacro":
    case "events.flag":
    case "custom.define":
    case "events.loaded":
      return [];
    case "looks.say":
    case "looks.think":
      needed.add("stdio.h");
      return [`${pad}${emitSay(block.values.message, needed)}`];
    case "looks.printf": {
      needed.add("stdio.h");
      const fmt = expr(block.values.message, needed);
      const args = (block.extraArgs ?? []).map((a) => expr(a, needed));
      const all = [fmt, ...args].join(", ");
      return [`${pad}printf(${all});`];
    }
    case "looks.ask":
      needed.add("stdio.h");
      return [`${pad}printf("%s", ${expr(block.values.prompt, needed)});`, `${pad}fflush(stdout);`];
    case "data.set":
    case "data.assign":
      return [`${pad}${lhsOf(block, needed)} = ${expr(block.values.rhs ?? block.values.value, needed)};`];
    case "data.change":
      return [`${pad}${lhsOf(block, needed)} += ${expr(block.values.rhs ?? block.values.value, needed)};`];
    case "data.declare":
    case "data.declareInit":
      return [`${pad}${emitDeclare(block, needed, "")}`];
    case "data.replaceItem":
      return [`${pad}${expr(block.values.array, needed)}[${expr(block.values.index, needed)}] = ${expr(block.values.value, needed)};`];
    case "sensing.free":
      needed.add("stdlib.h");
      return [`${pad}free(${expr(block.values.value, needed)});`];
    case "control.if":
      return [
        `${pad}if (${expr(block.values.condition, needed)}) {`,
        ...emitChain(block.branches.body, needed, isMain, indent + 1),
        `${pad}}`,
      ];
    case "control.ifElse":
      return [
        `${pad}if (${expr(block.values.condition, needed)}) {`,
        ...emitChain(block.branches.body, needed, isMain, indent + 1),
        `${pad}} else {`,
        ...emitChain(block.branches.else, needed, isMain, indent + 1),
        `${pad}}`,
      ];
    case "control.while":
      return [
        `${pad}while (${expr(block.values.condition, needed)}) {`,
        ...emitChain(block.branches.body, needed, isMain, indent + 1),
        `${pad}}`,
      ];
    case "control.doWhile":
      return [
        `${pad}do {`,
        ...emitChain(block.branches.body, needed, isMain, indent + 1),
        `${pad}} while (${expr(block.values.condition, needed)});`,
      ];
    case "control.forever":
      return [`${pad}while (1) {`, ...emitChain(block.branches.body, needed, isMain, indent + 1), `${pad}}`];
    case "control.repeat":
      return emitRepeatAsFor(block, needed, isMain, indent);
    case "control.for":
      return [
        `${pad}for (${expr(block.values.init, needed)}; ${expr(block.values.condition, needed)}; ${expr(block.values.update, needed)}) {`,
        ...emitChain(block.branches.body, needed, isMain, indent + 1),
        `${pad}}`,
      ];
    case "control.forRange":
    case "cpp.forRange":
      return [
        `${pad}for (${typeExpr(block.values.type, needed) || "auto"} ${block.fields.var || "x"} : ${expr(block.values.range, needed)}) {`,
        ...emitChain(block.branches.body, needed, isMain, indent + 1),
        `${pad}}`,
      ];
    case "control.switch":
      return [
        `${pad}switch (${expr(block.values.value, needed)}) {`,
        ...emitChain(block.branches.body, needed, isMain, indent + 1),
        `${pad}}`,
      ];
    case "control.break":
      return [`${pad}break;`];
    case "control.continue":
      return [`${pad}continue;`];
    case "control.stop":
      return [`${pad}return;`];
    case "control.stopAll":
      needed.add("stdlib.h");
      return [`${pad}exit(${expr(block.values.value, needed)});`];
    case "control.report":
      return [`${pad}return ${expr(block.values.value, needed)};`];
    case "control.wait":
      needed.add("unistd.h");
      return [`${pad}sleep(${expr(block.values.secs, needed)});`];
    case "control.goto":
      return [`${pad}goto ${sanitizeIdent(block.fields.label || "label")};`];
    case "custom.call":
    case "custom.tmplCall": {
      const args = (block.extraArgs ?? []).map((a) => expr(a, needed)).join(", ");
      return [`${pad}${callName(block, needed)}(${args});`];
    }
    case "custom.method": {
      const args = (block.extraArgs ?? []).map((a) => expr(a, needed)).join(", ");
      return [`${pad}${expr(block.values.obj, needed)}.${block.fields.name || "m"}(${args});`];
    }
    case "cpp.delete":
      return [`${pad}delete ${expr(block.values.value, needed)};`];
    case "cpp.using":
      return [`${pad}using ${block.fields.name || "namespace std"};`];
    case "cpp.namespace":
      return [
        `${pad}namespace ${block.fields.name || "ns"} {`,
        ...emitChain(block.branches.body, needed, isMain, indent + 1),
        `${pad}}`,
      ];
    case "ops.lambdaBlock":
      return [
        `${pad}${lambdaHead(block, needed)} {`,
        ...emitChain(block.branches.body, needed, isMain, indent + 1),
        `${pad}}`,
      ];
    case "c.eval":
      return [`${pad}${expr(block.values.value, needed)};`];
    case "c.unknown":
      return [`${pad}${block.fields.text || "/* unknown */"};`];
    case "c.ifdef":
      return [
        `${pad}#ifdef ${sanitizeIdent(block.fields.name || "FOO")}`,
        ...emitChain(block.branches.body, needed, isMain, indent),
        `${pad}#endif`,
      ];
    case "motion.move":
    case "motion.turn":
    case "motion.goto":
    case "sound.play":
      return [`${pad}/* ${block.opcode} */`];
    default:
      if (block.shape === "stack" || block.shape === "cap" || block.shape === "c" || block.shape === "c2") {
        return [`${pad}/* ${block.opcode} */`];
      }
      return [];
  }
}

function emitSay(value: Block | Literal | undefined, needed: Set<string>): string {
  if (!value) {
    return 'puts("");';
  }
  if (isLiteral(value) && value.kind === "string") {
    return `puts(${cString(value.value)});`;
  }
  return `printf("%d\\n", ${expr(value, needed)});`;
}

function expr(value: Block | Literal | undefined, needed: Set<string>): string {
  if (!value) {
    return "0";
  }
  if (isLiteral(value)) {
    if (value.kind === "empty") {
      return "0";
    }
    if (value.kind === "number") {
      return value.value;
    }
    return cString(value.value);
  }
  switch (value.opcode) {
    case "data.get":
      return sanitizeIdent(value.fields.var || "x");
    case "ops.add":
      return `(${expr(value.values.left, needed)} + ${expr(value.values.right, needed)})`;
    case "ops.sub":
      return `(${expr(value.values.left, needed)} - ${expr(value.values.right, needed)})`;
    case "ops.mul":
      return `(${expr(value.values.left, needed)} * ${expr(value.values.right, needed)})`;
    case "ops.div":
      return `(${expr(value.values.left, needed)} / ${expr(value.values.right, needed)})`;
    case "ops.mod":
      return `(${expr(value.values.left, needed)} % ${expr(value.values.right, needed)})`;
    case "ops.lt":
      return `(${expr(value.values.left, needed)} < ${expr(value.values.right, needed)})`;
    case "ops.gt":
      return `(${expr(value.values.left, needed)} > ${expr(value.values.right, needed)})`;
    case "ops.le":
      return `(${expr(value.values.left, needed)} <= ${expr(value.values.right, needed)})`;
    case "ops.ge":
      return `(${expr(value.values.left, needed)} >= ${expr(value.values.right, needed)})`;
    case "ops.eq":
      return `(${expr(value.values.left, needed)} == ${expr(value.values.right, needed)})`;
    case "ops.neq":
      if (value.values.inner && !isLiteral(value.values.inner) && value.values.inner.opcode === "ops.eq") {
        const inner = value.values.inner;
        return `(${expr(inner.values.left, needed)} != ${expr(inner.values.right, needed)})`;
      }
      return `!(${expr(value.values.inner, needed)})`;
    case "ops.and":
      return `(${expr(value.values.left, needed)} && ${expr(value.values.right, needed)})`;
    case "ops.or":
      return `(${expr(value.values.left, needed)} || ${expr(value.values.right, needed)})`;
    case "ops.not":
      return `!(${expr(value.values.inner, needed)})`;
    case "ops.neg":
      return `(-${expr(value.values.inner, needed)})`;
    case "ops.bitand":
      return `(${expr(value.values.left, needed)} & ${expr(value.values.right, needed)})`;
    case "ops.bitor":
      return `(${expr(value.values.left, needed)} | ${expr(value.values.right, needed)})`;
    case "ops.bitxor":
      return `(${expr(value.values.left, needed)} ^ ${expr(value.values.right, needed)})`;
    case "ops.shl":
      return `(${expr(value.values.left, needed)} << ${expr(value.values.right, needed)})`;
    case "ops.shr":
      return `(${expr(value.values.left, needed)} >> ${expr(value.values.right, needed)})`;
    case "ops.ternary":
      return `(${expr(value.values.condition, needed)} ? ${expr(value.values.then, needed)} : ${expr(value.values.else, needed)})`;
    case "ops.cast":
      return `((${typeExpr(value.values.type, needed) || value.fields.type || "int"}) ${expr(value.values.value, needed)})`;
    case "ops.scope":
    case "type.scope":
      return `${typeExpr(value.values.left, needed) || expr(value.values.left, needed)}::${typeExpr(value.values.right, needed) || expr(value.values.right, needed)}`;
    case "type.named":
    case "type.custom":
      return value.fields.name || "int";
    case "type.ptr":
      return `${typeExpr(value.values.inner, needed)}*`;
    case "type.ref":
      return `${typeExpr(value.values.inner, needed)}&`;
    case "type.tmpl":
      return typeExpr(value, needed);
    case "ops.lambda":
      return `${lambdaHead(value, needed)} { return ${expr(value.values.body, needed)}; }`;
    case "cpp.new": {
      const args = (value.extraArgs ?? []).map((a) => expr(a, needed)).join(", ");
      const t = typeExpr(value.values.type, needed) || "T";
      return args ? `new ${t}(${args})` : `new ${t}`;
    }
    case "custom.method": {
      const args = (value.extraArgs ?? []).map((a) => expr(a, needed)).join(", ");
      return `${expr(value.values.obj, needed)}.${value.fields.name || "m"}(${args})`;
    }
    case "custom.tmplCall": {
      const args = (value.extraArgs ?? []).map((a) => expr(a, needed)).join(", ");
      return `${callName(value, needed)}(${args})`;
    }
    case "ops.join":
      needed.add("stdio.h");
      return expr(value.values.left, needed);
    case "sensing.null":
      return "NULL";
    case "sensing.addressOf":
      return `(&${expr(value.values.value, needed)})`;
    case "sensing.deref":
      return `(*${expr(value.values.value, needed)})`;
    case "sensing.sizeof":
      return `sizeof(${expr(value.values.value, needed)})`;
    case "sensing.malloc":
      needed.add("stdlib.h");
      return `malloc(${expr(value.values.size, needed)})`;
    case "sensing.subscript":
      return `${expr(value.values.array, needed)}[${expr(value.values.index, needed)}]`;
    case "sensing.field":
      return `${expr(value.values.value, needed)}.${sanitizeIdent(value.fields.field || "x")}`;
    case "sensing.answer":
      return "0";
    case "custom.reporter": {
      const args = (value.extraArgs ?? []).map((a) => expr(a, needed)).join(", ");
      const name = value.fields.name || "fn";
      if (!name) {
        return `{${args}}`;
      }
      return `${name}(${args})`;
    }
    case "c.unknownReporter":
      return value.fields.text || "0";
    default:
      return "0";
  }
}

function lhsOf(block: Block, needed: Set<string>): string {
  if (block.values.lhs) {
    return expr(block.values.lhs, needed);
  }
  return sanitizeIdent(block.fields.var || block.fields.name || "x");
}

function emitDeclare(block: Block, needed: Set<string>, pad: string): string {
  const ty = typeExpr(block.values.type, needed) || "int";
  const name = block.fields.name || block.fields.var || "x";
  const value = block.values.value;
  if (block.opcode === "data.declareInit" && value && !(isLiteral(value) && value.kind === "empty")) {
    return `${pad}${ty} ${name} = ${expr(value, needed)};`;
  }
  return `${pad}${ty} ${name};`;
}

function callName(block: Block, needed: Set<string>): string {
  const name = block.fields.name || "fn";
  if (block.opcode === "custom.tmplCall") {
    return `${name}<${typeExpr(block.values.targ, needed) || "T"}>`;
  }
  return name;
}

function lambdaHead(block: Block, needed: Set<string>): string {
  const params = block.params?.length
    ? block.params
        .map((p, i) => {
          const t = block.values[`t${i}`];
          const ty = t ? typeExpr(t, needed) : p.type || "auto";
          return `${ty} ${block.fields[`p${i}`] || p.name}`;
        })
        .join(", ")
    : `${typeExpr(block.values.t0, needed) || "auto"} ${block.fields.p0 || "x"}`;
  return `[=](${params})`;
}

function typeExpr(value: Block | Literal | undefined, needed: Set<string>): string {
  if (!value) {
    return "";
  }
  if (isLiteral(value)) {
    if (value.kind === "empty") {
      return "";
    }
    return value.value;
  }
  switch (value.opcode) {
    case "type.named":
    case "type.custom":
      return value.fields.name || "int";
    case "type.ptr":
      return `${typeExpr(value.values.inner, needed) || "void"}*`;
    case "type.ref":
      return `${typeExpr(value.values.inner, needed) || "int"}&`;
    case "type.tmpl": {
      const extras = (value.extraArgs ?? []).map((a) => typeExpr(a as Block, needed) || expr(a, needed));
      const args = [typeExpr(value.values.arg, needed) || expr(value.values.arg, needed), ...extras].filter(Boolean).join(", ");
      return `${typeExpr(value.values.base, needed) || expr(value.values.base, needed)}<${args}>`;
    }
    case "type.scope":
    case "ops.scope":
      return `${typeExpr(value.values.left, needed) || expr(value.values.left, needed)}::${typeExpr(value.values.right, needed) || expr(value.values.right, needed)}`;
    case "data.get":
      return value.fields.var || "T";
    default:
      return expr(value, needed);
  }
}

function includeLine(header: string): string {
  const h = header.replace(/[<>"]/g, "").trim();
  if (STDLIB.has(h) || !h.includes("/")) {
    return `#include <${h}>`;
  }
  return `#include "${h}"`;
}

function mergeIncludes(found: string[], needed: Set<string>): string[] {
  const set = new Set<string>(found);
  for (const h of needed) {
    set.add(includeLine(h));
  }
  return [...set];
}

function usesOpcode(program: Program, opcode: string): boolean {
  for (const sprite of program.sprites) {
    for (const script of sprite.scripts) {
      if (blockUses(script.root, opcode)) {
        return true;
      }
    }
  }
  return false;
}

function blockUses(block: Block | undefined, opcode: string): boolean {
  let current = block;
  while (current) {
    if (current.opcode === opcode) {
      return true;
    }
    for (const v of Object.values(current.values)) {
      if (v && !isLiteral(v) && blockUses(v, opcode)) {
        return true;
      }
    }
    for (const extra of current.extraArgs ?? []) {
      if (!isLiteral(extra) && blockUses(extra, opcode)) {
        return true;
      }
    }
    for (const b of Object.values(current.branches)) {
      if (blockUses(b, opcode)) {
        return true;
      }
    }
    current = current.next;
  }
  return false;
}

function chainHas(head: Block | undefined, opcode: string): boolean {
  let current = head;
  while (current) {
    if (current.opcode === opcode) {
      return true;
    }
    for (const b of Object.values(current.branches)) {
      if (chainHas(b, opcode)) {
        return true;
      }
    }
    current = current.next;
  }
  return false;
}

function cString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

function sanitizeIdent(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, "_");
  if (!cleaned) {
    return "x";
  }
  if (/^[0-9]/.test(cleaned)) {
    return `v_${cleaned}`;
  }
  return cleaned;
}

function guessType(name: string): string {
  if (/^(p|ptr|buf|dest|src|data)$/i.test(name)) {
    return "void *";
  }
  if (/^(name|str|s|msg|text|fmt)$/i.test(name)) {
    return "char *";
  }
  return "int";
}

function cTypeFromComment(comment: string | undefined): string | undefined {
  if (!comment) {
    return undefined;
  }
  const t = comment.replace(/\s+/g, " ").trim();
  if (/^(int|char|long|short|float|double|void \*|char \*|size_t|unsigned.*)$/.test(t)) {
    return t;
  }
  return undefined;
}
