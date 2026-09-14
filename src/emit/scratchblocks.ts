import { isLiteral } from "../ir/builders";
import type { Block, Literal, Program, Script } from "../ir/types";

export interface EmittedScript {
  id: string;
  x: number;
  y: number;
  code: string;
  source: Script["root"]["source"];
  rootId: string;
}

export function emitProgram(program: Program): EmittedScript[] {
  return program.sprites.flatMap((sprite) =>
    sprite.scripts.map((script) => ({
      id: script.id,
      x: script.x,
      y: script.y,
      code: emitScript(script.root),
      source: script.root.source,
      rootId: script.root.id,
    })),
  );
}

export function emitScript(root: Block): string {
  if (root.shape === "reporter" || root.shape === "boolean") {
    return emitValue(root).replace(/^\(|\)$/g, "").replace(/^<|>$/g, "");
  }
  return emitChain(root).join("\n");
}

export function emitToolboxBlock(block: Block): string {
  return emitScript(block);
}

function emitChain(head: Block | undefined): string[] {
  const lines: string[] = [];
  let current = head;
  while (current) {
    lines.push(...emitBlock(current));
    current = current.next;
  }
  return lines;
}

function emitBlock(block: Block): string[] {
  const comment = block.comment && !block.comment.startsWith("__") ? ` // ${block.comment}` : "";
  const line =
    block.opcode === "ops.chain" ? emitInfix(block, false) : substitute(block.line, block) + extraArgText(block);

  if (block.shape === "c" || block.shape === "c2") {
    const body = indent(emitChain(block.branches.body));
    if (block.shape === "c2") {
      const elseBody = indent(emitChain(block.branches.else));
      if (block.closer) {
        return [line, ...body, "} else {", ...elseBody, substitute(block.closer, block)];
      }
      return [line, ...body, "else", ...elseBody, "end"];
    }
    const closer = block.closer ? substitute(block.closer, block) : "end";
    return [line, ...body, closer];
  }
  return [comment ? `${line}${comment}` : line];
}

function extraArgText(block: Block): string {
  if (!block.extraArgs?.length) {
    return "";
  }
  const args = block.extraArgs.map((a) => emitValue(a)).join(" ");
  if (block.line.includes("::")) {
    return "";
  }
  return ` ${args}`;
}

function substitute(template: string, block: Block): string {
  let extra = "";
  if (block.extraArgs?.length && template.includes("::")) {
    extra = `${block.extraArgs.map((a) => emitValue(a)).join(" ")} `;
  }
  const replaced = template.replace(/\{(\w+)\}/g, (_, slot: string) => {
    if (Object.prototype.hasOwnProperty.call(block.fields, slot)) {
      return escapeScratch(block.fields[slot] ?? "");
    }
    const value = block.values[slot];
    if (!value) {
      return slot === "condition" ? "<>" : "()";
    }
    return emitValue(value);
  });
  if (block.opcode === "type.tmpl" && block.extraArgs?.length) {
    const more = block.extraArgs.map((a) => emitValue(a)).join(" , ");
    if (/\s*>/.test(replaced)) {
      return replaced.replace(/\s*>/, ` , ${more} >`);
    }
    return replaced.replace(/\s*\)(\s*::|\s*$)/, ` , ${more} )$1`);
  }
  if (extra) {
    return replaced.replace(/\s*::/, ` ${extra}::`);
  }
  return replaced;
}

function emitValue(value: Block | Literal): string {
  if (isLiteral(value)) {
    if (value.kind === "empty") {
      return "()";
    }
    if (value.kind === "number") {
      return `(${escapeScratch(value.value)})`;
    }
    return `[${escapeScratch(value.value)}]`;
  }
  if (value.opcode === "ops.chain") {
    return `(${emitInfix(value, true)})`;
  }
  if (value.shape === "boolean") {
    return `<${inline(value)}>`;
  }
  if (value.shape === "reporter") {
    return `(${inline(value)})`;
  }
  return `(${inline(value)})`;
}

function emitInfix(block: Block, nested: boolean): string {
  const parts = [block.values.a0, ...(block.extraArgs ?? [])];
  const body = parts
    .map((part, i) => {
      const piece = part ? emitValue(part) : "()";
      if (i === 0) {
        return piece;
      }
      const op = (block.fields[`op${i - 1}`] ?? block.fields.op ?? "+").replace(/::/g, ": :");
      return `${op} ${piece}`;
    })
    .join(" ");
  return nested ? body : `${body} :: operators`;
}

function inline(block: Block): string {
  let inner = substitute(block.line, block);
  if (block.category === "operators" || block.opcode.startsWith("ops.")) {
    inner = stripCategory(inner);
  }
  if (block.extraArgs?.length && !block.line.includes("::")) {
    return `${inner} ${block.extraArgs.map((a) => emitValue(a)).join(" ")}`.trim();
  }
  return inner;
}

function stripCategory(line: string): string {
  return line.replace(/\s*::\s*[a-zA-Z][\w-]*(?:\s+[a-zA-Z][\w-]*)*$/, "").trim();
}

function indent(lines: string[]): string[] {
  return lines.map((l) => (l.length ? `  ${l}` : l));
}

function escapeScratch(text: string): string {
  // scratchblocks treats `::` as a category/flag marker, so `std::cout`
  // must never appear raw in a label.
  return text.replace(/\\/g, "\\\\").replace(/[[\]()<>{}]/g, "\\$&").replace(/::/g, ": :");
}
