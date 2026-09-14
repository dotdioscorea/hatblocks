import { defaultToolbox, prototypeFromDef, CATALOG_BY_OPCODE, groupToolbox } from "../../library/catalog";
import { createIdFactory, type IdFactory } from "../../ir/ids";
import type { Block } from "../../ir/types";

const CPP_TYPES = ["std::string", "std::vector", "string", "auto"];

export function cppToolbox(id: IdFactory = createIdFactory("cpp")) {
  const base = defaultToolbox(id);
  const extras: Block[] = [];
  for (const name of CPP_TYPES) {
    const t = prototypeFromDef(CATALOG_BY_OPCODE.get("type.custom")!, id);
    t.fields.name = name;
    extras.push(t);
  }
  return groupToolbox([...base.flatMap((c) => c.blocks), ...extras]);
}
