/** Scratch-like hat labels that still carry real types and arguments. */

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
  const args = params
    .map((p) => `( [${cleanType(p.type)} v] ${cleanIdent(p.name)} )`)
    .join(" ");
  if (kind === "when") {
    return args
      ? `when @greenFlag ${ret} ${cleanIdent(name)} ${args}`
      : `when @greenFlag ${ret} ${cleanIdent(name)}`;
  }
  return args ? `define ${ret} ${cleanIdent(name)} ${args}` : `define ${ret} ${cleanIdent(name)}`;
}

export function cleanType(type: string): string {
  return (type || "int").replace(/\s+\*/g, "*").replace(/\s+/g, " ").trim() || "int";
}

function cleanIdent(name: string): string {
  return name.replace(/[^\w*]/g, "") || "fn";
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
