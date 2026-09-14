import { createIdFactory } from "./ids";
import type { Block, Literal, Script } from "./types";
import { isLiteral } from "./builders";

export function cloneBlock(block: Block, id = createIdFactory("n")): Block {
  const copy: Block = {
    ...block,
    id: id(),
    fields: { ...block.fields },
    values: {},
    branches: {},
    extraArgs: block.extraArgs?.map((a) => cloneValue(a, id)),
    params: block.params?.map((p) => ({ ...p })),
    next: block.next ? cloneBlock(block.next, id) : undefined,
  };
  for (const [k, v] of Object.entries(block.values)) {
    copy.values[k] = cloneValue(v, id);
  }
  for (const [k, v] of Object.entries(block.branches)) {
    copy.branches[k] = v ? cloneBlock(v, id) : undefined;
  }
  return copy;
}

export function cloneValue(value: Block | Literal, id = createIdFactory("n")): Block | Literal {
  if (isLiteral(value)) {
    return { ...value };
  }
  return cloneBlock(value, id);
}

export function cloneScript(script: Script, id = createIdFactory("n")): Script {
  return {
    id: id(),
    x: script.x,
    y: script.y,
    root: cloneBlock(script.root, id),
  };
}

export function lastBlock(block: Block): Block {
  let current = block;
  while (current.next) {
    current = current.next;
  }
  return current;
}
