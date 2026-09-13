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
  /** Default field values for toolbox prototypes. */
  fields?: Record<string, string>;
  /** Names of reporter/boolean slots shown in the prototype. */
  valueSlots?: string[];
  /** Names of statement mouths. */
  branchSlots?: string[];
  comment?: string;
}

export const CATALOG: OpcodeDef[] = [
  // Motion — playground library, same as the original editor
  { opcode: "motion.move", shape: "stack", category: "motion", line: "move {steps} steps", valueSlots: ["steps"] },
  { opcode: "motion.turn", shape: "stack", category: "motion", line: "turn cw {deg} degrees", valueSlots: ["deg"] },
  { opcode: "motion.goto", shape: "stack", category: "motion", line: "go to x: {x} y: {y}", valueSlots: ["x", "y"] },

  // Sound
  { opcode: "sound.play", shape: "stack", category: "sound", line: "play sound [{name} v] until done", fields: { name: "meow" } },

  // Events
  { opcode: "events.flag", shape: "hat", category: "events", line: "when @greenFlag clicked" },
  {
    opcode: "events.receive",
    shape: "hat",
    category: "events",
    line: "when I receive [{msg} v]",
    fields: { msg: "message1" },
  },
  {
    opcode: "events.broadcast",
    shape: "stack",
    category: "events",
    line: "broadcast [{msg} v]",
    fields: { msg: "message1" },
  },
  {
    opcode: "events.broadcastWait",
    shape: "stack",
    category: "events",
    line: "broadcast [{msg} v] and wait",
    fields: { msg: "message1" },
  },
  {
    opcode: "events.loaded",
    shape: "hat",
    category: "events",
    line: "when I receive [{msg} v]",
    fields: { msg: "file" },
  },

  // Control
  { opcode: "control.wait", shape: "stack", category: "control", line: "wait {secs} seconds", valueSlots: ["secs"] },
  { opcode: "control.repeat", shape: "c", category: "control", line: "repeat {count}", valueSlots: ["count"], branchSlots: ["body"] },
  { opcode: "control.forever", shape: "c", category: "control", line: "forever", branchSlots: ["body"] },
  { opcode: "control.if", shape: "c", category: "control", line: "if {condition} then", valueSlots: ["condition"], branchSlots: ["body"] },
  {
    opcode: "control.ifElse",
    shape: "c2",
    category: "control",
    line: "if {condition} then",
    valueSlots: ["condition"],
    branchSlots: ["body", "else"],
  },
  {
    opcode: "control.repeatUntil",
    shape: "c",
    category: "control",
    line: "repeat until {condition}",
    valueSlots: ["condition"],
    branchSlots: ["body"],
  },
  {
    opcode: "control.waitUntil",
    shape: "stack",
    category: "control",
    line: "wait until {condition}",
    valueSlots: ["condition"],
  },
  { opcode: "control.stop", shape: "cap", category: "control", line: "stop [{what} v]", fields: { what: "this script" } },
  { opcode: "control.stopAll", shape: "cap", category: "control", line: "stop [{what} v]", fields: { what: "all" } },
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
    opcode: "control.switch",
    shape: "c",
    category: "control",
    line: "switch {value} {",
    valueSlots: ["value"],
    branchSlots: ["body"],
    closer: "} :: control",
  },
  { opcode: "control.break", shape: "stack", category: "control", line: "break :: control" },
  { opcode: "control.continue", shape: "stack", category: "control", line: "continue :: control" },
  { opcode: "control.goto", shape: "stack", category: "control", line: "broadcast [{label} v] and wait", fields: { label: "label" } },
  { opcode: "control.label", shape: "hat", category: "events", line: "when I receive [{label} v]", fields: { label: "label" } },
  { opcode: "control.report", shape: "cap", category: "control", line: "report {value} :: control", valueSlots: ["value"] },

  // Looks / IO
  { opcode: "looks.say", shape: "stack", category: "looks", line: "say {message}", valueSlots: ["message"] },
  { opcode: "looks.think", shape: "stack", category: "looks", line: "think {message}", valueSlots: ["message"] },
  { opcode: "looks.printf", shape: "stack", category: "looks", line: "printf {message} :: looks", valueSlots: ["message"] },
  { opcode: "looks.ask", shape: "stack", category: "sensing", line: "ask {prompt} and wait", valueSlots: ["prompt"] },
  { opcode: "sensing.answer", shape: "reporter", category: "sensing", line: "answer" },

  // Sensing / memory
  { opcode: "sensing.addressOf", shape: "reporter", category: "sensing", line: "location of {value} :: sensing", valueSlots: ["value"] },
  { opcode: "sensing.deref", shape: "reporter", category: "sensing", line: "thing at {value} :: sensing", valueSlots: ["value"] },
  { opcode: "sensing.sizeof", shape: "reporter", category: "sensing", line: "size of {value} :: sensing", valueSlots: ["value"] },
  { opcode: "sensing.malloc", shape: "reporter", category: "sensing", line: "create clone of {size} bytes :: sensing", valueSlots: ["size"] },
  { opcode: "sensing.free", shape: "stack", category: "sensing", line: "delete clone {value} :: sensing", valueSlots: ["value"] },
  { opcode: "sensing.null", shape: "reporter", category: "sensing", line: "empty :: sensing" },
  { opcode: "sensing.subscript", shape: "reporter", category: "sensing", line: "item {index} of {array} :: lists", valueSlots: ["index", "array"] },
  { opcode: "sensing.field", shape: "reporter", category: "sensing", line: "{value} 's {field} :: sensing", valueSlots: ["value"], fields: { field: "x" } },

  // Operators
  { opcode: "ops.add", shape: "reporter", category: "operators", line: "{left} + {right}", valueSlots: ["left", "right"] },
  { opcode: "ops.sub", shape: "reporter", category: "operators", line: "{left} - {right}", valueSlots: ["left", "right"] },
  { opcode: "ops.mul", shape: "reporter", category: "operators", line: "{left} * {right}", valueSlots: ["left", "right"] },
  { opcode: "ops.div", shape: "reporter", category: "operators", line: "{left} / {right}", valueSlots: ["left", "right"] },
  { opcode: "ops.mod", shape: "reporter", category: "operators", line: "{left} mod {right}", valueSlots: ["left", "right"] },
  { opcode: "ops.lt", shape: "boolean", category: "operators", line: "{left} < {right}", valueSlots: ["left", "right"] },
  { opcode: "ops.gt", shape: "boolean", category: "operators", line: "{left} > {right}", valueSlots: ["left", "right"] },
  { opcode: "ops.le", shape: "boolean", category: "operators", line: "{left} <= {right} :: operators", valueSlots: ["left", "right"] },
  { opcode: "ops.ge", shape: "boolean", category: "operators", line: "{left} >= {right} :: operators", valueSlots: ["left", "right"] },
  { opcode: "ops.eq", shape: "boolean", category: "operators", line: "{left} = {right}", valueSlots: ["left", "right"] },
  { opcode: "ops.neq", shape: "boolean", category: "operators", line: "not {inner}", valueSlots: ["inner"] },
  { opcode: "ops.and", shape: "boolean", category: "operators", line: "{left} and {right}", valueSlots: ["left", "right"] },
  { opcode: "ops.or", shape: "boolean", category: "operators", line: "{left} or {right}", valueSlots: ["left", "right"] },
  { opcode: "ops.not", shape: "boolean", category: "operators", line: "not {inner}", valueSlots: ["inner"] },
  { opcode: "ops.join", shape: "reporter", category: "operators", line: "join {left} {right}", valueSlots: ["left", "right"] },
  { opcode: "ops.bitand", shape: "reporter", category: "operators", line: "{left} bitwise and {right} :: operators", valueSlots: ["left", "right"] },
  { opcode: "ops.bitor", shape: "reporter", category: "operators", line: "{left} bitwise or {right} :: operators", valueSlots: ["left", "right"] },
  { opcode: "ops.bitxor", shape: "reporter", category: "operators", line: "{left} bitwise xor {right} :: operators", valueSlots: ["left", "right"] },
  { opcode: "ops.shl", shape: "reporter", category: "operators", line: "{left} << {right} :: operators", valueSlots: ["left", "right"] },
  { opcode: "ops.shr", shape: "reporter", category: "operators", line: "{left} >> {right} :: operators", valueSlots: ["left", "right"] },
  { opcode: "ops.neg", shape: "reporter", category: "operators", line: "- {inner} :: operators", valueSlots: ["inner"] },
  { opcode: "ops.ternary", shape: "reporter", category: "operators", line: "if {condition} then {then} else {else} :: operators", valueSlots: ["condition", "then", "else"] },
  { opcode: "ops.cast", shape: "reporter", category: "operators", line: "({type}) {value} :: operators", valueSlots: ["value"], fields: { type: "int" } },

  // Variables
  { opcode: "data.set", shape: "stack", category: "variables", line: "set [{var} v] to {value}", fields: { var: "x" }, valueSlots: ["value"] },
  { opcode: "data.change", shape: "stack", category: "variables", line: "change [{var} v] by {value}", fields: { var: "x" }, valueSlots: ["value"] },
  { opcode: "data.get", shape: "reporter", category: "variables", line: "{var}", fields: { var: "x" } },
  { opcode: "data.declare", shape: "stack", category: "variables", line: "make variable [{var} v] :: variables", fields: { var: "int x" } },
  {
    opcode: "data.replaceItem",
    shape: "stack",
    category: "lists",
    line: "replace item {index} of {array} with {value}",
    valueSlots: ["index", "array", "value"],
  },

  // Custom
  { opcode: "custom.define", shape: "hat", category: "custom", line: "define {name}" },
  { opcode: "custom.call", shape: "stack", category: "custom", line: "{name} :: custom" },
  { opcode: "custom.reporter", shape: "reporter", category: "custom", line: "{name} :: custom" },

  // C / extension
  { opcode: "c.include", shape: "stack", category: "extension", line: "use library [{header} v] :: extension", fields: { header: "stdio.h" } },
  { opcode: "c.defineMacro", shape: "stack", category: "extension", line: "#define [{name} v] {value} :: extension", fields: { name: "N" }, valueSlots: ["value"] },
  { opcode: "c.eval", shape: "stack", category: "extension", line: "eval {value} :: grey", valueSlots: ["value"] },
  { opcode: "c.unknown", shape: "stack", category: "extension", line: "{text} :: grey", fields: { text: "???" } },
  { opcode: "c.unknownReporter", shape: "reporter", category: "extension", line: "{text} :: grey", fields: { text: "???" } },
  {
    opcode: "c.ifdef",
    shape: "c",
    category: "extension",
    line: "ifdef [{name} v] {",
    fields: { name: "FOO" },
    branchSlots: ["body"],
    closer: "} :: extension",
  },
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
    } else if (slot === "count" || slot === "secs" || slot === "index" || slot === "size" || slot === "steps" || slot === "deg" || slot === "x" || slot === "y") {
      const defaults: Record<string, number> = { secs: 1, steps: 10, deg: 15, x: 0, y: 0, index: 1, size: 10, count: 10 };
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

const C_HEADERS = [
  "stdio.h",
  "stdlib.h",
  "string.h",
  "math.h",
  "unistd.h",
  "stdbool.h",
  "stdint.h",
  "time.h",
  "assert.h",
  "ctype.h",
  "errno.h",
  "limits.h",
];

export function defaultToolbox(id: IdFactory = createIdFactory("lib")): ReturnType<typeof grouped> {
  const blocks = CATALOG.filter((d) => !d.opcode.startsWith("c.unknown") && d.opcode !== "c.include").map((d) =>
    prototypeFromDef(d, id),
  );
  for (const header of C_HEADERS) {
    const include = prototypeFromDef(CATALOG_BY_OPCODE.get("c.include")!, id);
    include.fields.header = header;
    blocks.push(include);
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
