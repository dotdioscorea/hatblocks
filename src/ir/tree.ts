import { isLiteral } from "./builders";
import { lastBlock } from "./clone";
import type { Block, Literal, Program } from "./types";

export function forEachBlock(root: Block | undefined, fn: (b: Block) => void): void {
  if (!root) {
    return;
  }
  const stack: Block[] = [root];
  const seen = new Set<string>();
  while (stack.length) {
    const current = stack.pop()!;
    if (seen.has(current.id)) {
      continue;
    }
    seen.add(current.id);
    fn(current);
    if (current.next) {
      stack.push(current.next);
    }
    for (const value of Object.values(current.values)) {
      if (value && !isLiteral(value)) {
        stack.push(value);
      }
    }
    for (const extra of current.extraArgs ?? []) {
      if (extra && !isLiteral(extra)) {
        stack.push(extra);
      }
    }
    for (const branch of Object.values(current.branches)) {
      if (branch) {
        stack.push(branch);
      }
    }
  }
}

export function findBlock(root: Block | undefined, id: string): Block | undefined {
  let found: Block | undefined;
  forEachBlock(root, (b) => {
    if (b.id === id) {
      found = b;
    }
  });
  return found;
}

export function findInProgram(program: Program | undefined, id: string): Block | undefined {
  if (!program) {
    return undefined;
  }
  for (const sprite of program.sprites) {
    for (const script of sprite.scripts) {
      const found = findBlock(script.root, id);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

export function prependBranch(host: Block, slot: string, incoming: Block): void {
  const old = host.branches[slot];
  lastBlock(incoming).next = old;
  host.branches[slot] = incoming;
}

export function insertAfter(after: Block, incoming: Block): void {
  lastBlock(incoming).next = after.next;
  after.next = incoming;
}

/** Unlink `target` from its parent. `target.next` (the tail) stays on target. */
export function unlink(root: Block, target: Block): boolean {
  if (root === target) {
    return false;
  }
  let current: Block | undefined = root;
  while (current) {
    if (current.next === target) {
      current.next = undefined;
      return true;
    }
    for (const key of Object.keys(current.branches)) {
      const head = current.branches[key];
      if (head === target) {
        current.branches[key] = undefined;
        return true;
      }
      if (head && unlink(head, target)) {
        return true;
      }
    }
    current = current.next;
  }
  return false;
}

export function isTypeBlock(block: Block): boolean {
  return block.opcode.startsWith("type.");
}

export function slotEntries(block: Block): Array<[string, Block | Literal]> {
  return Object.entries(block.values);
}

export function typeSlotNames(block: Block): string[] {
  const names = Object.keys(block.values).filter((k) => {
    const v = block.values[k];
    if (!v) {
      return k === "type" || k === "ret" || k === "inner" || k === "base" || k === "arg" || k === "targ" || /^t\d+$/.test(k);
    }
    if (isLiteral(v)) {
      return k === "type" || k === "ret" || k === "inner" || k === "base" || k === "arg" || k === "targ" || /^t\d+$/.test(k);
    }
    return isTypeBlock(v) || k === "type" || k === "ret" || /^t\d+$/.test(k);
  });
  return names;
}
