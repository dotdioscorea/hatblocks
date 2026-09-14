import type { Block } from "../ir/types";

export interface Mark {
  block: Block;
  y: number;
  h: number;
  line?: number;
}

const HAT = 44;
const STACK = 38;
const C_HEAD = 40;
const C_ELSE = 24;
const C_FOOT = 20;

export function layoutMarks(block: Block | undefined, y = 0, marks: Mark[] = []): { marks: Mark[]; height: number } {
  let cursor = y;
  while (block) {
    const start = cursor;
    if (block.shape === "c" || block.shape === "c2") {
      cursor += C_HEAD;
      const body = layoutMarks(block.branches.body, cursor);
      marks.push(...body.marks);
      cursor = body.height;
      if (block.shape === "c2") {
        cursor += C_ELSE;
        const alt = layoutMarks(block.branches.else, cursor);
        marks.push(...alt.marks);
        cursor = alt.height;
      }
      cursor += C_FOOT;
    } else {
      cursor += block.shape === "hat" ? HAT : STACK;
    }
    marks.push({
      block,
      y: start,
      h: cursor - start,
      line: block.source ? block.source.start.line + 1 : undefined,
    });
    block = block.next;
  }
  return { marks, height: cursor };
}

export function hitMark(marks: Mark[], relY: number): Mark | undefined {
  let hit: Mark | undefined;
  for (const mark of marks) {
    if (mark.y <= relY && (!hit || mark.y >= hit.y)) {
      hit = mark;
    }
  }
  return hit;
}

export function scaleMarks(marks: Mark[], layoutHeight: number, svgHeight: number): Mark[] {
  if (layoutHeight <= 0 || svgHeight <= 0) {
    return marks;
  }
  const s = svgHeight / layoutHeight;
  return marks.map((m) => ({ ...m, y: m.y * s, h: m.h * s }));
}
