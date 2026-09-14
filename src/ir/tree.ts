import type { Block } from "./types";

export function forEachBlock(root: Block | undefined, fn: (b: Block) => void): void {
  let current = root;
  while (current) {
    fn(current);
    for (const child of Object.values(current.branches)) {
      forEachBlock(child, fn);
    }
    current = current.next;
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
