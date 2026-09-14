import { makeBlock, litEmpty, litNumber, litString, type BlockInit } from "../ir/builders";
import type { Block, BlockShape, CategoryId } from "../ir/types";
import { createIdFactory, type IdFactory } from "../ir/ids";
import { CATEGORIES } from "./categories";

export interface OpcodeDef {
  opcode: string;
  shape: BlockShape;
  category: CategoryId;
  line: string;
  closer?: string;
  fields?: Record<string, string>;
  valueSlots?: string[];
  branchSlots?: string[];
  comment?: string;
  /** Hide from the language toolbox (kept for lowering leftovers). */
  hidden?: boolean;
}

export const CATALOG: OpcodeDef[] = [
  // Preprocessor
  { opcode: "c.include", shape: "stack", category: "extension", line: "#include [{header} v] :: extension", fields: { header: "stdio.h" } },
  { opcode: "c.defineMacro", shape: "stack", category: "extension", line: "#define [{name} v] {value} :: extension", fields: { name: "N" }, valueSlots: ["value"] },
  {
    opcode: "c.ifdef",
    shape: "c",
    category: "extension",
    line: "#ifdef [{name} v] {",
    fields: { name: "FOO" },
    branchSlots: ["body"],
    closer: "} :: extension",
  },
  { opcode: "cpp.using", shape: "stack", category: "extension", line: "using {name} :: extension", fields: { name: "namespace std" } },
  {
    opcode: "cpp.namespace",
    shape: "c",
    category: "extension",
    line: "namespace {name} {",
    fields: { name: "std" },
    branchSlots: ["body"],
    closer: "} :: extension",
  },

  // Types — reporters you plug into any type hole
  { opcode: "type.named", shape: "reporter", category: "motion", line: "{name} :: motion", fields: { name: "int" } },
  { opcode: "type.custom", shape: "reporter", category: "motion", line: "{name} :: motion", fields: { name: "T" } },
  { opcode: "type.ptr", shape: "reporter", category: "motion", line: "{inner} * :: motion", valueSlots: ["inner"] },
  { opcode: "type.ref", shape: "reporter", category: "motion", line: "{inner} & :: motion", valueSlots: ["inner"] },
  { opcode: "type.tmpl", shape: "reporter", category: "motion", line: "{base} ( {arg} ) :: motion", valueSlots: ["base", "arg"] },
  { opcode: "type.scope", shape: "reporter", category: "motion", line: "{left} : : {right} :: motion", valueSlots: ["left", "right"] },

  // Functions
  {
    opcode: "events.flag",
    shape: "c",
    category: "custom",
    line: "{ret} main {",
    fields: { name: "main", returnType: "int" },
    valueSlots: ["ret"],
    branchSlots: ["body"],
    closer: "} :: events",
  },
  {
    opcode: "custom.define",
    shape: "c",
    category: "custom",
    line: "{ret} fn {",
    fields: { name: "fn", returnType: "void" },
    valueSlots: ["ret"],
    branchSlots: ["body"],
    closer: "} :: custom",
  },
  { opcode: "custom.call", shape: "stack", category: "custom", line: "{name} :: custom", fields: { name: "f" } },
  { opcode: "custom.reporter", shape: "reporter", category: "custom", line: "{name} :: custom", fields: { name: "f" } },
  { opcode: "custom.method", shape: "stack", category: "custom", line: "{obj} . {name} :: custom", fields: { name: "m" }, valueSlots: ["obj"] },
  { opcode: "custom.tmplCall", shape: "stack", category: "custom", line: "{name} < {targ} > :: custom", fields: { name: "f" }, valueSlots: ["targ"] },
  { opcode: "control.report", shape: "cap", category: "custom", line: "return {value};", valueSlots: ["value"] },
  { opcode: "control.stop", shape: "cap", category: "custom", line: "return;" },
  { opcode: "control.stopAll", shape: "cap", category: "custom", line: "exit {value};", valueSlots: ["value"] },
  {
    opcode: "cpp.class",
    shape: "c",
    category: "custom",
    line: "class {name} {",
    fields: { name: "T" },
    branchSlots: ["body"],
    closer: "} :: custom",
  },
  {
    opcode: "c.fn",
    shape: "c",
    category: "custom",
    line: "{ret} fn {",
    fields: { name: "fn", returnType: "void" },
    valueSlots: ["ret"],
    branchSlots: ["body"],
    closer: "} :: custom",
  },
  { opcode: "cpp.access", shape: "stack", category: "custom", line: "{name} : :: custom", fields: { name: "public" } },

  // Control
  {
    opcode: "control.if",
    shape: "c",
    category: "control",
    line: "if {condition} then",
    valueSlots: ["condition"],
    branchSlots: ["body"],
  },
  {
    opcode: "control.ifElse",
    shape: "c2",
    category: "control",
    line: "if {condition} then",
    valueSlots: ["condition"],
    branchSlots: ["body", "else"],
  },
  {
    opcode: "control.while",
    shape: "c",
    category: "control",
    line: "while {condition} {",
    valueSlots: ["condition"],
    branchSlots: ["body"],
    closer: "} :: control",
  },
  {
    opcode: "control.doWhile",
    shape: "c",
    category: "control",
    line: "do {",
    branchSlots: ["body"],
    closer: "} while {condition} :: control",
  },
  {
    opcode: "control.for",
    shape: "c",
    category: "control",
    line: "for {init} {condition} {update} {",
    valueSlots: ["init", "condition", "update"],
    branchSlots: ["body"],
    closer: "} :: control",
  },
  {
    opcode: "control.forRange",
    shape: "c",
    category: "control",
    line: "for {type} {var} : {range} {",
    fields: { var: "x" },
    valueSlots: ["type", "range"],
    branchSlots: ["body"],
    closer: "} :: control",
  },
  {
    opcode: "control.repeat",
    shape: "c",
    category: "control",
    line: "repeat {count}",
    valueSlots: ["count"],
    branchSlots: ["body"],
  },
  {
    opcode: "control.forever",
    shape: "c",
    category: "control",
    line: "forever",
    branchSlots: ["body"],
  },
  {
    opcode: "control.switch",
    shape: "c",
    category: "control",
    line: "switch {value} {",
    valueSlots: ["value"],
    branchSlots: ["body"],
    closer: "} :: control",
  },
  { opcode: "control.break", shape: "stack", category: "control", line: "break;" },
  { opcode: "control.continue", shape: "stack", category: "control", line: "continue;" },
  { opcode: "control.goto", shape: "stack", category: "control", line: "goto {label};", fields: { label: "label" } },
  { opcode: "control.wait", shape: "stack", category: "control", line: "sleep {secs};", valueSlots: ["secs"] },

  // Operators — C tokens
  { opcode: "ops.add", shape: "reporter", category: "operators", line: "{left} + {right}", valueSlots: ["left", "right"] },
  { opcode: "ops.sub", shape: "reporter", category: "operators", line: "{left} - {right}", valueSlots: ["left", "right"] },
  { opcode: "ops.mul", shape: "reporter", category: "operators", line: "{left} * {right}", valueSlots: ["left", "right"] },
  { opcode: "ops.div", shape: "reporter", category: "operators", line: "{left} / {right}", valueSlots: ["left", "right"] },
  { opcode: "ops.mod", shape: "reporter", category: "operators", line: "{left} % {right} :: operators", valueSlots: ["left", "right"] },
  { opcode: "ops.lt", shape: "boolean", category: "operators", line: "{left} < {right}", valueSlots: ["left", "right"] },
  { opcode: "ops.gt", shape: "boolean", category: "operators", line: "{left} > {right}", valueSlots: ["left", "right"] },
  { opcode: "ops.le", shape: "boolean", category: "operators", line: "{left} <= {right} :: operators", valueSlots: ["left", "right"] },
  { opcode: "ops.ge", shape: "boolean", category: "operators", line: "{left} >= {right} :: operators", valueSlots: ["left", "right"] },
  { opcode: "ops.eq", shape: "boolean", category: "operators", line: "{left} == {right} :: operators", valueSlots: ["left", "right"] },
  { opcode: "ops.neq", shape: "boolean", category: "operators", line: "! {inner} :: operators", valueSlots: ["inner"], hidden: true },
  { opcode: "ops.and", shape: "boolean", category: "operators", line: "{left} && {right} :: operators", valueSlots: ["left", "right"] },
  { opcode: "ops.or", shape: "boolean", category: "operators", line: "{left} || {right} :: operators", valueSlots: ["left", "right"] },
  { opcode: "ops.not", shape: "boolean", category: "operators", line: "! {inner} :: operators", valueSlots: ["inner"] },
  { opcode: "ops.bitand", shape: "reporter", category: "operators", line: "{left} & {right} :: operators", valueSlots: ["left", "right"] },
  { opcode: "ops.bitor", shape: "reporter", category: "operators", line: "{left} | {right} :: operators", valueSlots: ["left", "right"] },
  { opcode: "ops.bitxor", shape: "reporter", category: "operators", line: "{left} ^ {right} :: operators", valueSlots: ["left", "right"] },
  { opcode: "ops.shl", shape: "reporter", category: "operators", line: "{left} << {right} :: operators", valueSlots: ["left", "right"] },
  { opcode: "ops.shr", shape: "reporter", category: "operators", line: "{left} >> {right} :: operators", valueSlots: ["left", "right"] },
  { opcode: "ops.neg", shape: "reporter", category: "operators", line: "- {inner} :: operators", valueSlots: ["inner"] },
  { opcode: "ops.ternary", shape: "reporter", category: "operators", line: "{condition} ? {then} : {else} :: operators", valueSlots: ["condition", "then", "else"] },
  { opcode: "ops.cast", shape: "reporter", category: "operators", line: "({type}) {value} :: operators", valueSlots: ["type", "value"] },
  { opcode: "ops.scope", shape: "reporter", category: "operators", line: "{left} : : {right} :: operators", valueSlots: ["left", "right"] },
  {
    opcode: "ops.lambda",
    shape: "reporter",
    category: "operators",
    line: "[ ] ( {t0} p0 ) { {body} } :: operators",
    fields: { p0: "x" },
    valueSlots: ["t0", "body"],
  },
  {
    opcode: "ops.lambdaBlock",
    shape: "c",
    category: "operators",
    line: "[ ] ( {t0} p0 ) {",
    fields: { p0: "x" },
    valueSlots: ["t0"],
    branchSlots: ["body"],
    closer: "} :: operators",
  },

  // Variables — left of `=` is a slot; declarations take a type reporter
  { opcode: "data.assign", shape: "stack", category: "variables", line: "{lhs} = {rhs} :: variables stack", valueSlots: ["lhs", "rhs"] },
  { opcode: "data.set", shape: "stack", category: "variables", line: "{lhs} = {rhs} :: variables stack", valueSlots: ["lhs", "rhs"], hidden: true },
  { opcode: "data.change", shape: "stack", category: "variables", line: "{lhs} += {rhs} :: variables stack", valueSlots: ["lhs", "rhs"] },
  { opcode: "data.get", shape: "reporter", category: "variables", line: "{var}", fields: { var: "x" } },
  { opcode: "data.declare", shape: "stack", category: "variables", line: "{type} {name} :: variables stack", fields: { name: "x" }, valueSlots: ["type"] },
  { opcode: "data.declareInit", shape: "stack", category: "variables", line: "{type} {name} = {value} :: variables stack", fields: { name: "x" }, valueSlots: ["type", "value"] },

  // Arrays
  {
    opcode: "data.replaceItem",
    shape: "stack",
    category: "lists",
    line: "{array} [{index}] = {value} :: variables",
    valueSlots: ["index", "array", "value"],
  },
  { opcode: "sensing.subscript", shape: "reporter", category: "lists", line: "{array} [{index}] :: sensing", valueSlots: ["index", "array"] },

  // Pointers / members
  { opcode: "sensing.addressOf", shape: "reporter", category: "sensing", line: "& {value} :: sensing", valueSlots: ["value"] },
  { opcode: "sensing.deref", shape: "reporter", category: "sensing", line: "* {value} :: sensing", valueSlots: ["value"] },
  { opcode: "sensing.sizeof", shape: "reporter", category: "sensing", line: "sizeof {value} :: sensing", valueSlots: ["value"] },
  { opcode: "sensing.null", shape: "reporter", category: "sensing", line: "NULL :: sensing" },
  { opcode: "sensing.field", shape: "reporter", category: "sensing", line: "{value} . {field} :: sensing", valueSlots: ["value"], fields: { field: "x" } },
  { opcode: "sensing.arrow", shape: "reporter", category: "sensing", line: "{value} -> {field} :: sensing", valueSlots: ["value"], fields: { field: "x" } },
  { opcode: "cpp.new", shape: "reporter", category: "sensing", line: "new {type} :: sensing", valueSlots: ["type"] },
  { opcode: "cpp.delete", shape: "stack", category: "sensing", line: "delete {value} :: sensing", valueSlots: ["value"] },

  { opcode: "looks.say", shape: "stack", category: "looks", line: "{name} :: custom", fields: { name: "puts" }, hidden: true },
  { opcode: "looks.printf", shape: "stack", category: "looks", line: "{name} :: custom", fields: { name: "printf" }, hidden: true },
  { opcode: "looks.ask", shape: "stack", category: "looks", line: "{name} :: custom", fields: { name: "scanf" }, hidden: true },
  { opcode: "sensing.malloc", shape: "reporter", category: "sensing", line: "{name} :: custom", fields: { name: "malloc" }, hidden: true },
  { opcode: "sensing.free", shape: "stack", category: "sensing", line: "{name} :: custom", fields: { name: "free" }, hidden: true },

  // Hidden leftovers (not shown in the toolbox)
  { opcode: "events.receive", shape: "hat", category: "events", line: "when I receive [{msg} v]", fields: { msg: "message1" }, hidden: true },
  { opcode: "events.broadcast", shape: "stack", category: "events", line: "broadcast [{msg} v]", fields: { msg: "message1" }, hidden: true },
  { opcode: "events.broadcastWait", shape: "stack", category: "events", line: "broadcast [{msg} v] and wait", fields: { msg: "message1" }, hidden: true },
  { opcode: "events.loaded", shape: "hat", category: "events", line: "when I receive [{msg} v]", fields: { msg: "file" }, hidden: true },
  { opcode: "control.label", shape: "hat", category: "events", line: "{label} :", fields: { label: "label" }, hidden: true },
  { opcode: "control.repeatUntil", shape: "c", category: "control", line: "while ! {condition} {", valueSlots: ["condition"], branchSlots: ["body"], closer: "} :: control", hidden: true },
  { opcode: "control.waitUntil", shape: "stack", category: "control", line: "while ! {condition} ;", valueSlots: ["condition"], hidden: true },
  { opcode: "looks.think", shape: "stack", category: "looks", line: "puts {message} :: looks", valueSlots: ["message"], hidden: true },
  { opcode: "sensing.answer", shape: "reporter", category: "sensing", line: "getchar :: sensing", hidden: true },
  { opcode: "ops.join", shape: "reporter", category: "operators", line: "{left} {right} :: operators", valueSlots: ["left", "right"], hidden: true },
  { opcode: "c.eval", shape: "stack", category: "extension", line: "{value} ;", valueSlots: ["value"], hidden: true },
  { opcode: "c.unknown", shape: "stack", category: "extension", line: "{text} :: grey", fields: { text: "???" }, hidden: true },
  { opcode: "c.unknownReporter", shape: "reporter", category: "extension", line: "{text} :: grey", fields: { text: "???" }, hidden: true },
];

export const CATALOG_BY_OPCODE: Map<string, OpcodeDef> = new Map(CATALOG.map((d) => [d.opcode, d]));

export function prototypeFromDef(def: OpcodeDef, id: IdFactory = createIdFactory("p")): Block {
  const init: BlockInit = {
    opcode: def.opcode,
    shape: def.shape,
    category: def.category,
    line: def.line,
    closer: def.closer,
    fields: { ...(def.fields ?? {}) },
    values: {},
    branches: {},
    comment: def.comment,
  };
  for (const slot of def.valueSlots ?? []) {
    if (slot === "condition" || def.shape === "boolean") {
      init.values![slot] = litEmpty();
    } else if (slot === "count" || slot === "secs" || slot === "index" || slot === "size") {
      const defaults: Record<string, number> = { secs: 1, index: 0, size: 10, count: 10 };
      init.values![slot] = litNumber(defaults[slot] ?? 10);
    } else if (slot === "message" || slot === "prompt") {
      init.values![slot] = litString("Hello!");
    } else {
      init.values![slot] = litEmpty();
    }
  }
  for (const slot of def.branchSlots ?? []) {
    init.branches![slot] = undefined;
  }
  return makeBlock(id, init);
}

const STD_TYPES = ["int", "void", "char", "float", "double", "bool", "auto", "size_t", "string"];

export function defaultToolbox(id: IdFactory = createIdFactory("lib")): ReturnType<typeof grouped> {
  const blocks = CATALOG.filter((d) => !d.hidden && !d.opcode.startsWith("c.unknown")).map((d) => prototypeFromDef(d, id));
  for (const name of STD_TYPES) {
    const t = prototypeFromDef(CATALOG_BY_OPCODE.get("type.named")!, id);
    t.fields.name = name;
    t.line = "{name} :: motion";
    blocks.push(t);
  }
  return grouped(blocks);
}

function grouped(blocks: Block[]) {
  return CATEGORIES.map((cat) => ({
    id: cat.id,
    label: cat.label,
    color: cat.color,
    blocks: blocks.filter((b) => b.category === cat.id),
  })).filter((c) => c.blocks.length > 0);
}

export { grouped as groupToolbox };
