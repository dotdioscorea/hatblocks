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

  // Functions
  { opcode: "events.flag", shape: "hat", category: "custom", line: "when [int v] main clicked" },
  {
    opcode: "custom.define",
    shape: "hat",
    category: "custom",
    line: "define [void v] fn",
    fields: { name: "fn", returnType: "void" },
  },
  { opcode: "custom.call", shape: "stack", category: "custom", line: "{name} :: custom", fields: { name: "fn" } },
  { opcode: "custom.reporter", shape: "reporter", category: "custom", line: "{name} :: custom", fields: { name: "fn" } },
  { opcode: "control.report", shape: "cap", category: "custom", line: "return {value};", valueSlots: ["value"] },
  { opcode: "control.stop", shape: "cap", category: "custom", line: "return;" },
  { opcode: "control.stopAll", shape: "cap", category: "custom", line: "exit {value};", valueSlots: ["value"] },

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
  { opcode: "control.goto", shape: "stack", category: "control", line: "goto [{label} v];", fields: { label: "label" } },
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
  { opcode: "ops.neq", shape: "boolean", category: "operators", line: "! {inner} :: operators", valueSlots: ["inner"] },
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
  { opcode: "ops.cast", shape: "reporter", category: "operators", line: "({type}) {value} :: operators", valueSlots: ["value"], fields: { type: "int" } },

  // Variables
  { opcode: "data.set", shape: "stack", category: "variables", line: "{var} = {value} :: variables", fields: { var: "x" }, valueSlots: ["value"] },
  { opcode: "data.change", shape: "stack", category: "variables", line: "{var} += {value} :: variables", fields: { var: "x" }, valueSlots: ["value"] },
  { opcode: "data.get", shape: "reporter", category: "variables", line: "{var}", fields: { var: "x" } },
  { opcode: "data.declare", shape: "stack", category: "variables", line: "int {var} :: variables", fields: { var: "x" } },

  // Arrays
  {
    opcode: "data.replaceItem",
    shape: "stack",
    category: "lists",
    line: "{array} [{index}] = {value} :: variables",
    valueSlots: ["index", "array", "value"],
  },
  { opcode: "sensing.subscript", shape: "reporter", category: "lists", line: "{array} [{index}] :: sensing", valueSlots: ["index", "array"] },

  // Pointers
  { opcode: "sensing.addressOf", shape: "reporter", category: "sensing", line: "& {value} :: sensing", valueSlots: ["value"] },
  { opcode: "sensing.deref", shape: "reporter", category: "sensing", line: "* {value} :: sensing", valueSlots: ["value"] },
  { opcode: "sensing.sizeof", shape: "reporter", category: "sensing", line: "sizeof {value} :: sensing", valueSlots: ["value"] },
  { opcode: "sensing.malloc", shape: "reporter", category: "sensing", line: "malloc {size} :: sensing", valueSlots: ["size"] },
  { opcode: "sensing.free", shape: "stack", category: "sensing", line: "free {value} :: sensing", valueSlots: ["value"] },
  { opcode: "sensing.null", shape: "reporter", category: "sensing", line: "NULL :: sensing" },
  { opcode: "sensing.field", shape: "reporter", category: "sensing", line: "{value} . {field} :: sensing", valueSlots: ["value"], fields: { field: "x" } },

  // I/O
  { opcode: "looks.say", shape: "stack", category: "looks", line: "puts {message} :: looks", valueSlots: ["message"] },
  { opcode: "looks.printf", shape: "stack", category: "looks", line: "printf {message} :: looks", valueSlots: ["message"] },
  { opcode: "looks.ask", shape: "stack", category: "looks", line: "scanf {prompt} :: looks", valueSlots: ["prompt"] },

  // Hidden leftovers (not shown in the C toolbox)
  { opcode: "events.receive", shape: "hat", category: "events", line: "when I receive [{msg} v]", fields: { msg: "message1" }, hidden: true },
  { opcode: "events.broadcast", shape: "stack", category: "events", line: "broadcast [{msg} v]", fields: { msg: "message1" }, hidden: true },
  { opcode: "events.broadcastWait", shape: "stack", category: "events", line: "broadcast [{msg} v] and wait", fields: { msg: "message1" }, hidden: true },
  { opcode: "events.loaded", shape: "hat", category: "events", line: "when I receive [{msg} v]", fields: { msg: "file" }, hidden: true },
  { opcode: "control.label", shape: "hat", category: "events", line: "[{label} v] :", fields: { label: "label" }, hidden: true },
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

export function defaultToolbox(id: IdFactory = createIdFactory("lib")): ReturnType<typeof grouped> {
  return grouped(
    CATALOG.filter((d) => !d.hidden && !d.opcode.startsWith("c.unknown")).map((d) => prototypeFromDef(d, id)),
  );
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
