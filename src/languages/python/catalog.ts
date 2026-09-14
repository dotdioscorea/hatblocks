import { makeBlock, litEmpty, litNumber, litString, type BlockInit } from "../../ir/builders";
import type { Block, BlockShape, CategoryId } from "../../ir/types";
import { createIdFactory, type IdFactory } from "../../ir/ids";
import { CATEGORIES } from "../../library/categories";

export interface OpcodeDef {
  opcode: string;
  shape: BlockShape;
  category: CategoryId;
  line: string;
  closer?: string;
  fields?: Record<string, string>;
  valueSlots?: string[];
  branchSlots?: string[];
  hidden?: boolean;
}

export const PY_CATALOG: OpcodeDef[] = [
  { opcode: "py.import", shape: "stack", category: "extension", line: "import [{module} v]", fields: { module: "sys" } },
  { opcode: "py.importFrom", shape: "stack", category: "extension", line: "from [{module} v] import [{name} v]", fields: { module: "os", name: "path" } },
  { opcode: "custom.define", shape: "hat", category: "custom", line: "[None v] fn :: custom hat", fields: { name: "fn", returnType: "None" } },
  { opcode: "py.class", shape: "hat", category: "custom", line: "class [{name} v] : :: custom hat", fields: { name: "C" } },
  { opcode: "control.if", shape: "c", category: "control", line: "if {condition} then", valueSlots: ["condition"], branchSlots: ["body"] },
  { opcode: "control.ifElse", shape: "c2", category: "control", line: "if {condition} then", valueSlots: ["condition"], branchSlots: ["body", "else"] },
  { opcode: "control.while", shape: "c", category: "control", line: "while {condition} {", valueSlots: ["condition"], branchSlots: ["body"], closer: "} :: control" },
  { opcode: "py.for", shape: "c", category: "control", line: "for [{var} v] in {iter} {", fields: { var: "x" }, valueSlots: ["iter"], branchSlots: ["body"], closer: "} :: control" },
  { opcode: "py.with", shape: "c", category: "control", line: "with {ctx} {", valueSlots: ["ctx"], branchSlots: ["body"], closer: "} :: control" },
  { opcode: "py.try", shape: "c2", category: "control", line: "try {", branchSlots: ["body", "else"], closer: "} :: control" },
  { opcode: "control.break", shape: "stack", category: "control", line: "break" },
  { opcode: "control.continue", shape: "stack", category: "control", line: "continue" },
  { opcode: "control.report", shape: "cap", category: "custom", line: "return {value}", valueSlots: ["value"] },
  { opcode: "control.stop", shape: "cap", category: "custom", line: "return" },
  { opcode: "py.pass", shape: "stack", category: "control", line: "pass :: control" },
  { opcode: "py.raise", shape: "cap", category: "control", line: "raise {value} :: control", valueSlots: ["value"] },
  { opcode: "ops.add", shape: "reporter", category: "operators", line: "{left} + {right}", valueSlots: ["left", "right"] },
  { opcode: "ops.sub", shape: "reporter", category: "operators", line: "{left} - {right}", valueSlots: ["left", "right"] },
  { opcode: "ops.mul", shape: "reporter", category: "operators", line: "{left} * {right}", valueSlots: ["left", "right"] },
  { opcode: "ops.div", shape: "reporter", category: "operators", line: "{left} / {right}", valueSlots: ["left", "right"] },
  { opcode: "ops.mod", shape: "reporter", category: "operators", line: "{left} % {right} :: operators", valueSlots: ["left", "right"] },
  { opcode: "ops.lt", shape: "boolean", category: "operators", line: "{left} < {right}", valueSlots: ["left", "right"] },
  { opcode: "ops.gt", shape: "boolean", category: "operators", line: "{left} > {right}", valueSlots: ["left", "right"] },
  { opcode: "ops.eq", shape: "boolean", category: "operators", line: "{left} == {right} :: operators", valueSlots: ["left", "right"] },
  { opcode: "ops.and", shape: "boolean", category: "operators", line: "{left} and {right}", valueSlots: ["left", "right"] },
  { opcode: "ops.or", shape: "boolean", category: "operators", line: "{left} or {right}", valueSlots: ["left", "right"] },
  { opcode: "ops.not", shape: "boolean", category: "operators", line: "not {inner}", valueSlots: ["inner"] },
  { opcode: "ops.in", shape: "boolean", category: "operators", line: "{left} in {right} :: operators", valueSlots: ["left", "right"] },
  { opcode: "data.set", shape: "stack", category: "variables", line: "{var} = {value} :: variables", fields: { var: "x" }, valueSlots: ["value"] },
  { opcode: "data.get", shape: "reporter", category: "variables", line: "{var}", fields: { var: "x" } },
  { opcode: "custom.call", shape: "stack", category: "custom", line: "{name} :: custom", fields: { name: "fn" } },
  { opcode: "custom.reporter", shape: "reporter", category: "custom", line: "{name} :: custom", fields: { name: "fn" } },
  { opcode: "looks.say", shape: "stack", category: "looks", line: "print {message} :: looks", valueSlots: ["message"] },
  { opcode: "looks.ask", shape: "stack", category: "looks", line: "input {prompt} :: looks", valueSlots: ["prompt"] },
  { opcode: "py.none", shape: "reporter", category: "sensing", line: "None :: sensing" },
  { opcode: "py.attr", shape: "reporter", category: "sensing", line: "{value} . {field} :: sensing", valueSlots: ["value"], fields: { field: "x" } },
  { opcode: "sensing.subscript", shape: "reporter", category: "lists", line: "{array} [{index}] :: sensing", valueSlots: ["array", "index"] },
];

const BY = new Map(PY_CATALOG.map((d) => [d.opcode, d]));

export function pyPrototype(opcode: string, id: IdFactory, extra?: Partial<BlockInit>): Block {
  const def = BY.get(opcode);
  if (!def) {
    throw new Error(opcode);
  }
  const init: BlockInit = {
    opcode,
    shape: def.shape,
    category: def.category,
    line: def.line,
    closer: def.closer,
    fields: { ...(def.fields ?? {}) },
    values: {},
    branches: {},
    ...extra,
  };
  for (const slot of def.valueSlots ?? []) {
    init.values![slot] ??= slot === "condition" ? litEmpty() : slot === "message" ? litString("hi") : litEmpty();
  }
  for (const slot of def.branchSlots ?? []) {
    init.branches![slot] ??= undefined;
  }
  return makeBlock(id, init);
}

export function pythonToolbox(id: IdFactory = createIdFactory("py")): ReturnType<typeof grouped> {
  return grouped(PY_CATALOG.filter((d) => !d.hidden).map((d) => pyPrototype(d.opcode, id)));
}

function grouped(blocks: Block[]) {
  return CATEGORIES.map((cat) => ({
    id: cat.id,
    label: cat.label === "Preproc" ? "Imports" : cat.label,
    color: cat.color,
    blocks: blocks.filter((b) => b.category === cat.id),
  })).filter((c) => c.blocks.length > 0);
}

void litNumber;
