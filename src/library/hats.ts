/** Rounded-top hats (Scratch flag *shape*) with language-native labels. */

export interface FnParam {
  type: string;
  name: string;
}

export const C_TYPES = [
  "void",
  "int",
  "char",
  "char*",
  "float",
  "double",
  "bool",
  "size_t",
  "auto",
  "long",
];

export const PY_TYPES = ["None", "int", "str", "float", "bool", "list", "dict", "Any"];

export function hatLine(
  kind: "when" | "define",
  _returnType: string,
  name: string,
  params: FnParam[] = [],
  parentClass?: string,
): string {
  const ident = parentClass
    ? `${cleanIdent(parentClass)} : : ${cleanIdent(name)}`
    : cleanIdent(name);
  const args = params.map((_, i) => `{t${i}} {p${i}}`).join(" , ");
  const sig = args ? `{ret} ${ident} ( ${args} )` : `{ret} ${ident}`;
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
  block.line = hatLine(kind, ret, name, block.params ?? [], block.fields.parentClass);
  block.fields.returnType = ret;
  block.fields.name = name;
  (block.params ?? []).forEach((p, i) => {
    block.fields[`p${i}`] = p.name;
  });
}

export function rebuildCall(block: {
  opcode: string;
  fields: Record<string, string>;
  line: string;
}): void {
  const name = (block.fields.name || "f").trim() || "f";
  block.fields.name = name;
  if (block.opcode === "custom.method") {
    block.line = `{obj} . ${name} :: custom`;
  } else {
    block.line = `${name} :: custom`;
  }
}

export function rebuildForRange(block: {
  fields: Record<string, string>;
  line: string;
}): void {
  const name = (block.fields.var || "x").trim() || "x";
  block.fields.var = name;
  block.line = "for {type} {var} : {range} {";
}

export function rebuildLambda(block: {
  opcode: string;
  fields: Record<string, string>;
  params?: FnParam[];
  line: string;
  closer?: string;
}): void {
  const params = block.params ?? [];
  const args = params.length
    ? params.map((_, i) => `{t${i}} {p${i}}`).join(" , ")
    : "{t0} {p0}";
  params.forEach((p, i) => {
    block.fields[`p${i}`] = p.name;
  });
  if (block.opcode === "ops.lambdaBlock") {
    block.line = `[ ] ( ${args} ) {`;
    block.closer = "} :: operators";
  } else {
    block.line = `[ ] ( ${args} ) { {body} } :: operators`;
  }
}
