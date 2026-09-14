import { makeBlock, litEmpty, litNumber, litString, type BlockInit } from "../../ir/builders";
import type { Block, BlockShape, CategoryId } from "../../ir/types";
import { createIdFactory, type IdFactory } from "../../ir/ids";

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

/** Python-only palette. Not shared with C/C++. */
export const PY_CATALOG: OpcodeDef[] = [
  { opcode: "py.import", shape: "stack", category: "extension", line: "import {module} :: extension", valueSlots: ["module"] },
  { opcode: "py.importFrom", shape: "stack", category: "extension", line: "from {module} import {name} :: extension", valueSlots: ["module", "name"] },

  { opcode: "custom.define", shape: "c", category: "custom", line: "def {ret} fn {", fields: { name: "fn", returnType: "None" }, valueSlots: ["ret"], branchSlots: ["body"], closer: "} :: custom", hidden: true },
  {
    opcode: "py.class",
    shape: "c",
    category: "custom",
    line: "class {name} {",
    fields: { name: "C" },
    branchSlots: ["body"],
    closer: "} :: custom",
  },
  {
    opcode: "py.def",
    shape: "c",
    category: "custom",
    line: "def {ret} fn {",
    fields: { name: "fn", returnType: "None" },
    valueSlots: ["ret"],
    branchSlots: ["body"],
    closer: "} :: custom",
  },
  { opcode: "custom.call", shape: "stack", category: "custom", line: "{name} :: custom", fields: { name: "fn" } },
  { opcode: "custom.reporter", shape: "reporter", category: "custom", line: "{name} :: custom", fields: { name: "fn" } },
  { opcode: "custom.method", shape: "stack", category: "custom", line: "{obj} . {name} :: custom", fields: { name: "m" }, valueSlots: ["obj"] },
  { opcode: "control.report", shape: "cap", category: "custom", line: "return {value}", valueSlots: ["value"] },
  { opcode: "control.stop", shape: "cap", category: "custom", line: "return" },

  { opcode: "type.named", shape: "reporter", category: "motion", line: "{name} :: motion", fields: { name: "int" } },
  { opcode: "type.custom", shape: "reporter", category: "motion", line: "{name} :: motion", fields: { name: "T" } },
  { opcode: "type.tmpl", shape: "reporter", category: "motion", line: "{base} ( {arg} ) :: motion", valueSlots: ["base", "arg"] },

  { opcode: "control.if", shape: "c", category: "control", line: "if {condition} then", valueSlots: ["condition"], branchSlots: ["body"] },
  { opcode: "control.ifElse", shape: "c2", category: "control", line: "if {condition} then", valueSlots: ["condition"], branchSlots: ["body", "else"] },
  { opcode: "control.while", shape: "c", category: "control", line: "while {condition} {", valueSlots: ["condition"], branchSlots: ["body"], closer: "} :: control" },
  {
    opcode: "py.for",
    shape: "c",
    category: "control",
    line: "for [{var}] in {iter} {",
    fields: { var: "n" },
    valueSlots: ["iter"],
    branchSlots: ["body"],
    closer: "} :: control",
  },
  { opcode: "py.with", shape: "c", category: "control", line: "with {ctx} {", valueSlots: ["ctx"], branchSlots: ["body"], closer: "} :: control" },
  { opcode: "py.try", shape: "c2", category: "control", line: "try {", branchSlots: ["body", "else"], closer: "} :: control" },
  { opcode: "control.break", shape: "stack", category: "control", line: "break" },
  { opcode: "control.continue", shape: "stack", category: "control", line: "continue" },
  { opcode: "py.pass", shape: "stack", category: "control", line: "pass :: control" },
  { opcode: "py.raise", shape: "cap", category: "control", line: "raise {value} :: control", valueSlots: ["value"] },

  { opcode: "ops.add", shape: "reporter", category: "operators", line: "{left} + {right} :: operators", valueSlots: ["left", "right"] },
  { opcode: "ops.sub", shape: "reporter", category: "operators", line: "{left} - {right} :: operators", valueSlots: ["left", "right"] },
  { opcode: "ops.mul", shape: "reporter", category: "operators", line: "{left} * {right} :: operators", valueSlots: ["left", "right"] },
  { opcode: "ops.div", shape: "reporter", category: "operators", line: "{left} / {right} :: operators", valueSlots: ["left", "right"] },
  { opcode: "ops.mod", shape: "reporter", category: "operators", line: "{left} % {right} :: operators", valueSlots: ["left", "right"] },
  { opcode: "ops.lt", shape: "boolean", category: "operators", line: "{left} < {right}", valueSlots: ["left", "right"] },
  { opcode: "ops.gt", shape: "boolean", category: "operators", line: "{left} > {right}", valueSlots: ["left", "right"] },
  { opcode: "ops.eq", shape: "boolean", category: "operators", line: "{left} == {right} :: operators", valueSlots: ["left", "right"] },
  { opcode: "ops.and", shape: "boolean", category: "operators", line: "{left} and {right}", valueSlots: ["left", "right"] },
  { opcode: "ops.or", shape: "boolean", category: "operators", line: "{left} or {right}", valueSlots: ["left", "right"] },
  { opcode: "ops.not", shape: "boolean", category: "operators", line: "not {inner}", valueSlots: ["inner"] },
  { opcode: "ops.in", shape: "boolean", category: "operators", line: "{left} in {right} :: operators", valueSlots: ["left", "right"] },
  {
    opcode: "ops.lambda",
    shape: "reporter",
    category: "operators",
    line: "lambda {p0} : {body} :: operators",
    fields: { p0: "x" },
    valueSlots: ["body"],
  },

  { opcode: "data.assign", shape: "stack", category: "variables", line: "{lhs} = {rhs} :: variables stack", valueSlots: ["lhs", "rhs"] },
  { opcode: "data.set", shape: "stack", category: "variables", line: "{lhs} = {rhs} :: variables stack", valueSlots: ["lhs", "rhs"], hidden: true },
  { opcode: "data.declareInit", shape: "stack", category: "variables", line: "{type} {name} = {value} :: variables stack", fields: { name: "x" }, valueSlots: ["type", "value"] },
  { opcode: "data.get", shape: "reporter", category: "variables", line: "{var}", fields: { var: "x" } },

  { opcode: "py.list", shape: "reporter", category: "lists", line: "list :: list" },
  { opcode: "py.tuple", shape: "reporter", category: "lists", line: "tuple :: list" },
  { opcode: "sensing.subscript", shape: "reporter", category: "lists", line: "{array} at {index} :: list", valueSlots: ["array", "index"] },

  { opcode: "py.none", shape: "reporter", category: "sensing", line: "None :: sensing" },
  { opcode: "py.attr", shape: "reporter", category: "sensing", line: "{value} . {field} :: sensing", valueSlots: ["value"], fields: { field: "x" } },

  { opcode: "looks.say", shape: "stack", category: "looks", line: "print :: custom", fields: { name: "print" }, hidden: true },
  { opcode: "looks.ask", shape: "stack", category: "looks", line: "input :: custom", fields: { name: "input" }, hidden: true },
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
    init.values![slot] ??= slot === "condition" ? litEmpty() : litEmpty();
  }
  for (const slot of def.branchSlots ?? []) {
    init.branches![slot] ??= undefined;
  }
  return makeBlock(id, init);
}

const PY_CATEGORY_ORDER: Array<{ id: CategoryId; label: string; color: string }> = [
  { id: "extension", label: "Import", color: "#0FBD8C" },
  { id: "custom", label: "Def", color: "#FF6680" },
  { id: "control", label: "Ctrl", color: "#FFAB19" },
  { id: "operators", label: "Ops", color: "#59C059" },
  { id: "variables", label: "Vars", color: "#FF8C1A" },
  { id: "lists", label: "List", color: "#FF661A" },
  { id: "motion", label: "Type", color: "#4C97FF" },
  { id: "sensing", label: "Attr", color: "#5CB1D6" },
];

export const PY_STD_MODULES = ["sys", "os", "typing", "json", "re", "math", "pathlib", "collections", "itertools", "functools"];
export const PY_STD_IMPORTS = ["List", "Dict", "Optional", "Tuple", "Any", "Callable", "Path", "os", "sys", "*"];
export const PY_STD_TYPES = ["int", "str", "float", "bool", "None", "Any", "list", "dict", "tuple", "List", "Dict", "Optional"];

export function pythonToolbox(id: IdFactory = createIdFactory("py")): ReturnType<typeof grouped> {
  const blocks = PY_CATALOG.filter((d) => !d.hidden && d.opcode !== "py.list").map((d) => pyPrototype(d.opcode, id));
  const list = pyPrototype("py.list", id);
  list.extraArgs = [litNumber(1), litNumber(2), litNumber(3)];
  blocks.push(list);

  for (const name of PY_STD_TYPES) {
    blocks.push(pyPrototype("type.named", id, { fields: { name } }));
  }
  const generic = pyPrototype("type.tmpl", id);
  generic.values.base = pyPrototype("type.named", id, { fields: { name: "List" } });
  generic.values.arg = pyPrototype("type.named", id, { fields: { name: "int" } });
  blocks.push(generic);

  const fromTyping = pyPrototype("py.importFrom", id);
  fromTyping.values.module = pyPrototype("type.named", id, { fields: { name: "typing" } });
  fromTyping.values.name = pyPrototype("type.named", id, { fields: { name: "List" } });
  blocks.push(fromTyping);

  const importSys = pyPrototype("py.import", id);
  importSys.values.module = pyPrototype("type.named", id, { fields: { name: "sys" } });
  blocks.push(importSys);

  return grouped(blocks);
}

function grouped(blocks: Block[]) {
  return PY_CATEGORY_ORDER.map((cat) => ({
    id: cat.id,
    label: cat.label,
    color: cat.color,
    blocks: blocks.filter((b) => b.category === cat.id),
  })).filter((c) => c.blocks.length > 0);
}

void litString;
