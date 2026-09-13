import { defaultToolbox, prototypeFromDef, CATALOG, groupToolbox } from "../../library/catalog";
import { createIdFactory, type IdFactory } from "../../ir/ids";
import { makeBlock } from "../../ir/builders";
import type { Block } from "../../ir/types";

const CPP_EXTRA = [
  { opcode: "cpp.class", shape: "c" as const, category: "custom" as const, line: "class [{name} v] {", fields: { name: "T" }, branchSlots: ["body"], closer: "} :: custom" },
  { opcode: "cpp.namespace", shape: "c" as const, category: "extension" as const, line: "namespace [{name} v] {", fields: { name: "std" }, branchSlots: ["body"], closer: "} :: extension" },
  { opcode: "cpp.using", shape: "stack" as const, category: "extension" as const, line: "using [{name} v];", fields: { name: "namespace std" } },
  { opcode: "cpp.new", shape: "reporter" as const, category: "sensing" as const, line: "new {type} :: sensing", valueSlots: ["type"] },
  { opcode: "cpp.delete", shape: "stack" as const, category: "sensing" as const, line: "delete {value} :: sensing", valueSlots: ["value"] },
  { opcode: "cpp.forRange", shape: "c" as const, category: "control" as const, line: "for [{var} v] : {range} {", fields: { var: "x" }, valueSlots: ["range"], branchSlots: ["body"], closer: "} :: control" },
];

export function cppToolbox(id: IdFactory = createIdFactory("cpp")) {
  const base = defaultToolbox(id);
  const extras: Block[] = CPP_EXTRA.map((d) =>
    makeBlock(id, {
      opcode: d.opcode,
      shape: d.shape,
      category: d.category,
      line: d.line,
      closer: d.closer,
      fields: { ...(d.fields ?? {}) },
      values: {},
      branches: Object.fromEntries((d.branchSlots ?? []).map((s) => [s, undefined])),
    }),
  );
  return groupToolbox([...base.flatMap((c) => c.blocks), ...extras]);
}

void CATALOG;
void prototypeFromDef;
