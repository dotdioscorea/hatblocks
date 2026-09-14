/** Rounded-top hats (Scratch flag/define *shape*) with language-native labels. */

export interface FnParam {
  type: string;
  name: string;
}

export const C_TYPES = [
  "void",
  "int",
  "char",
  "char*",
  "const char*",
  "int*",
  "float",
  "double",
  "size_t",
  "bool",
  "long",
  "unsigned",
];

export const CPP_TYPES = [...C_TYPES, "auto", "string", "vector", "unique_ptr", "T"];

export const PY_TYPES = ["", "None", "int", "str", "float", "bool", "list", "dict", "Any"];

export function hatLine(
  kind: "when" | "define",
  returnType: string,
  name: string,
  params: FnParam[] = [],
): string {
  const ret = `[${cleanType(returnType)} v]`;
  const args = params.map((p) => `[${cleanType(p.type)} v] ${cleanIdent(p.name)}`).join(" , ");
  const sig = args ? `${ret} ${cleanIdent(name)} ( ${args} )` : `${ret} ${cleanIdent(name)}`;
  // scratchblocks: `:: events hat` is the rounded-top flag shape, without "when/clicked".
  const shape = kind === "when" ? "events hat" : "custom hat";
  return `${sig} :: ${shape}`;
}

export function cleanType(type: string): string {
  return (type || "int").replace(/\s+\*/g, "*").replace(/\s+/g, " ").trim() || "int";
}

function cleanIdent(name: string): string {
  return name.replace(/[^\w]/g, "") || "fn";
}

export function rebuildHat(block: {
  opcode: string;
  fields: Record<string, string>;
  params?: FnParam[];
  line: string;
}): void {
  const name = block.fields.name || (block.opcode === "events.flag" ? "main" : "fn");
  const ret = block.fields.returnType || "int";
  const kind = block.opcode === "events.flag" ? "when" : "define";
  block.line = hatLine(kind, ret, name, block.params ?? []);
}

export function rebuildCall(block: { fields: Record<string, string>; line: string; extraArgs?: unknown[] }): void {
  const name = block.fields.name || "fn";
  block.line = `${name} :: custom`;
}
