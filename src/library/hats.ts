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
  _parentClass?: string,
): string {
  const ident = cleanIdent(name);
  const args = params.map((_, i) => `{t${i}} {p${i}}`).join(" , ");
  const sig = args ? `{ret} ${ident} ( ${args} ) {` : `{ret} ${ident} {`;
  return sig;
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
  closer?: string;
}): void {
  rebuildCompoundDef(block);
}

/** Function / method: a mouth so the body is inside the brick. */
export function rebuildCompoundDef(block: {
  opcode: string;
  fields: Record<string, string>;
  params?: FnParam[];
  line: string;
  closer?: string;
}): void {
  const name = cleanIdent(block.fields.name || "fn");
  block.fields.name = name;
  const params = block.params ?? [];
  params.forEach((p, i) => {
    block.fields[`p${i}`] = p.name;
  });
  const args = params.map((_, i) => `{t${i}} {p${i}}`).join(" , ");
  if (block.opcode === "py.def") {
    block.line = args ? `def {ret} ${name} ( ${args} ) {` : `def {ret} ${name} {`;
    block.closer = "} :: custom";
  } else if (block.opcode === "events.flag") {
    block.line = args ? `{ret} ${name} ( ${args} ) {` : `{ret} ${name} {`;
    block.closer = "} :: events";
  } else {
    block.line = args ? `{ret} ${name} ( ${args} ) {` : `{ret} ${name} {`;
    block.closer = "} :: custom";
  }
}

export function rebuildChain(block: {
  opcode: string;
  fields: Record<string, string>;
  extraArgs?: unknown[];
  line: string;
}): void {
  const n = Math.max(2, 1 + (block.extraArgs?.length ?? 1));
  const defOp = (block.fields.op || "+").trim() || "+";
  block.fields.op = defOp;
  for (let i = 0; i < n - 1; i++) {
    block.fields[`op${i}`] = (block.fields[`op${i}`] || defOp).trim() || defOp;
  }
  block.line = "{a0} :: operators";
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
