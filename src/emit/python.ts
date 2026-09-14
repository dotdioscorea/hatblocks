import { isLiteral } from "../ir/builders";
import type { Block, Literal, Program } from "../ir/types";

export function emitPython(program: Program): string {
  const scripts = program.sprites.flatMap((s) => s.scripts);
  const parts: string[] = [];

  for (const script of scripts) {
    const src = emitChain(script.root, 0).join("\n");
    if (!src.trim()) {
      continue;
    }
    if (parts.length) {
      const gap = Math.max(1, script.gapBefore ?? 1);
      parts.push("\n".repeat(gap + 1) + src);
    } else {
      parts.push(src);
    }
  }
  return `${parts.join("")}\n`;
}

function emitChain(head: Block | undefined, indent: number): string[] {
  const lines: string[] = [];
  let current = head;
  while (current) {
    lines.push(...emitStmt(current, indent));
    current = current.next;
  }
  return lines;
}

function pad(indent: number): string {
  return "    ".repeat(indent);
}

function defLine(block: Block, indent: number): string[] {
  const p = pad(indent);
  const name = block.fields.name || "fn";
  const params = (block.params ?? []).map((x, i) => {
    const t = block.values[`t${i}`];
    const ty = t ? expr(t) : x.type;
    const n = block.fields[`p${i}`] || x.name;
    return ty && ty !== "Any" && ty !== "None" ? `${n}: ${ty}` : n;
  });
  const retRaw = expr(block.values.ret) || block.fields.returnType || "";
  const ret = retRaw && retRaw !== "None" ? ` -> ${retRaw}` : "";
  return [`${p}def ${name}(${params.join(", ")})${ret}:`, ...orPass(block.branches.body ?? block.next, indent + 1)];
}

function emitStmt(block: Block, indent: number): string[] {
  const p = pad(indent);
  switch (block.opcode) {
    case "py.import":
      return [`${p}import ${expr(block.values.module) || block.fields.module || "sys"}`];
    case "py.importFrom":
      return [`${p}from ${expr(block.values.module) || block.fields.module || "os"} import ${expr(block.values.name) || block.fields.name || "*"}`];
    case "looks.say":
      return [`${p}print(${expr(block.values.message)}${extra(block)})`];
    case "looks.ask":
      return [`${p}input(${expr(block.values.prompt)})`];
    case "data.set":
      return [`${p}${block.fields.var || "x"} = ${expr(block.values.value)}`];
    case "data.assign":
      return [`${p}${expr(block.values.lhs)} = ${expr(block.values.rhs)}`];
    case "data.declareInit":
      return [`${p}${block.fields.name || "x"}: ${expr(block.values.type)} = ${expr(block.values.value)}`];
    case "custom.method": {
      const args = (block.extraArgs ?? []).map((a) => expr(a)).join(", ");
      return [`${p}${expr(block.values.obj)}.${block.fields.name || "m"}(${args})`];
    }
    case "control.if":
      return [`${p}if ${expr(block.values.condition)}:`, ...orPass(block.branches.body, indent + 1)];
    case "control.ifElse":
      return [
        `${p}if ${expr(block.values.condition)}:`,
        ...orPass(block.branches.body, indent + 1),
        `${p}else:`,
        ...orPass(block.branches.else, indent + 1),
      ];
    case "control.while":
      return [`${p}while ${expr(block.values.condition)}:`, ...orPass(block.branches.body, indent + 1)];
    case "py.for":
      return [`${p}for ${block.fields.var || "x"} in ${expr(block.values.iter)}:`, ...orPass(block.branches.body, indent + 1)];
    case "py.with":
      return [`${p}with ${expr(block.values.ctx)}:`, ...orPass(block.branches.body, indent + 1)];
    case "py.try":
      return [`${p}try:`, ...orPass(block.branches.body, indent + 1), `${p}except Exception:`, ...orPass(block.branches.else, indent + 1)];
    case "py.class":
      return [`${p}class ${block.fields.name || "C"}:`, ...orPass(block.branches.body, indent + 1)];
    case "py.def":
    case "custom.define":
      return defLine(block, indent);
    case "control.report":
      return [`${p}return ${expr(block.values.value)}`];
    case "control.stop":
      return [`${p}return`];
    case "control.break":
      return [`${p}break`];
    case "control.continue":
      return [`${p}continue`];
    case "py.pass":
      return [`${p}pass`];
    case "py.raise":
      return [`${p}raise ${expr(block.values.value)}`];
    case "custom.call": {
      const name = block.fields.name || "fn";
      const args = (block.extraArgs ?? []).map((a) => expr(a)).join(", ");
      return [`${p}${name}(${args})`];
    }
    default:
      return [`${p}# ${block.opcode}`];
  }
}

function orPass(body: Block | undefined, indent: number): string[] {
  const lines = emitChain(body, indent);
  return lines.length ? lines : [`${pad(indent)}pass`];
}

function extra(block: Block): string {
  if (!block.extraArgs?.length) {
    return "";
  }
  return `, ${block.extraArgs.map((a) => expr(a)).join(", ")}`;
}

function expr(value: Block | Literal | undefined): string {
  if (!value) {
    return "None";
  }
  if (isLiteral(value)) {
    if (value.kind === "empty") {
      return "None";
    }
    if (value.kind === "number") {
      return value.value;
    }
    return JSON.stringify(value.value);
  }
  switch (value.opcode) {
    case "data.get":
      return value.fields.var || "x";
    case "ops.add":
      return `(${expr(value.values.left)} + ${expr(value.values.right)})`;
    case "ops.sub":
      return `(${expr(value.values.left)} - ${expr(value.values.right)})`;
    case "ops.mul":
      return `(${expr(value.values.left)} * ${expr(value.values.right)})`;
    case "ops.div":
      return `(${expr(value.values.left)} / ${expr(value.values.right)})`;
    case "ops.mod":
      return `(${expr(value.values.left)} % ${expr(value.values.right)})`;
    case "ops.lt":
      return `(${expr(value.values.left)} < ${expr(value.values.right)})`;
    case "ops.gt":
      return `(${expr(value.values.left)} > ${expr(value.values.right)})`;
    case "ops.eq":
      return `(${expr(value.values.left)} == ${expr(value.values.right)})`;
    case "ops.and":
      return `(${expr(value.values.left)} and ${expr(value.values.right)})`;
    case "ops.or":
      return `(${expr(value.values.left)} or ${expr(value.values.right)})`;
    case "ops.not":
      return `(not ${expr(value.values.inner)})`;
    case "ops.in":
      return `(${expr(value.values.left)} in ${expr(value.values.right)})`;
    case "py.none":
      return "None";
    case "py.attr":
    case "sensing.field":
      return `${expr(value.values.value)}.${value.fields.field || "x"}`;
    case "custom.method": {
      const args = (value.extraArgs ?? []).map((a) => expr(a)).join(", ");
      return `${expr(value.values.obj)}.${value.fields.name || "m"}(${args})`;
    }
    case "ops.lambda":
      return `lambda ${value.fields.p0 || "x"}: ${expr(value.values.body)}`;
    case "type.named":
    case "type.custom":
      return value.fields.name || "Any";
    case "type.tmpl":
      return `${expr(value.values.base)}[${expr(value.values.arg)}]`;
    case "data.assign":
      return `${expr(value.values.lhs)} = ${expr(value.values.rhs)}`;
    case "sensing.subscript":
      return `${expr(value.values.array)}[${expr(value.values.index)}]`;
    case "custom.reporter": {
      const args = (value.extraArgs ?? []).map((a) => expr(a)).join(", ");
      return `${value.fields.name || "fn"}(${args})`;
    }
    case "py.list":
      return `[${(value.extraArgs ?? []).map((a) => expr(a)).join(", ")}]`;
    case "py.tuple":
      return `(${(value.extraArgs ?? []).map((a) => expr(a)).join(", ")})`;
    default:
      return "None";
  }
}
