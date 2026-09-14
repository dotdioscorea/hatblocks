export type IdFactory = () => string;

export function createIdFactory(prefix = "b"): IdFactory {
  let n = 0;
  return () => `${prefix}${++n}`;
}

export function countBlocks(root: BlockLike | undefined): number {
  if (!root) {
    return 0;
  }
  let n = 0;
  const stack: BlockLike[] = [root];
  while (stack.length) {
    const block = stack.pop()!;
    n += 1;
    if (block.next) {
      stack.push(block.next);
    }
    for (const value of Object.values(block.values ?? {})) {
      if (value && "opcode" in value) {
        stack.push(value);
      }
    }
    for (const extra of block.extraArgs ?? []) {
      if (extra && "opcode" in extra) {
        stack.push(extra);
      }
    }
    for (const branch of Object.values(block.branches ?? {})) {
      if (branch) {
        stack.push(branch);
      }
    }
  }
  return n;
}

interface BlockLike {
  next?: BlockLike;
  values?: Record<string, BlockLike | { kind: string }>;
  extraArgs?: Array<BlockLike | { kind: string }>;
  branches?: Record<string, BlockLike | undefined>;
}

export function tailOf(block: { next?: unknown } & object): typeof block {
  let current = block as { next?: typeof block };
  while (current.next) {
    current = current.next;
  }
  return current;
}

export function recomputeStats(program: { sprites: Array<{ scripts: Array<{ root: BlockLike }> }>; stats: { scripts: number; blocks: number; truncated: boolean } }): void {
  let blocks = 0;
  let scripts = 0;
  for (const sprite of program.sprites) {
    scripts += sprite.scripts.length;
    for (const script of sprite.scripts) {
      blocks += countBlocks(script.root);
    }
  }
  program.stats.scripts = scripts;
  program.stats.blocks = blocks;
}

export function chain<T extends { next?: T }>(blocks: T[]): T | undefined {
  if (blocks.length === 0) {
    return undefined;
  }
  for (let i = 0; i < blocks.length - 1; i++) {
    tailOf(blocks[i]).next = blocks[i + 1];
  }
  return blocks[0];
}
