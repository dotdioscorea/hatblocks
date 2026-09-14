import type { Block } from "../ir/types";

export interface Mark {
  block: Block;
  y: number;
  h: number;
  /** Height of the header row only — line numbers sit here, not over the mouth. */
  headerH: number;
  /** Height of this block plus the `next` chain that would tear off with it. */
  chainH: number;
  line?: number;
  /** SVG group for this brick, when marks came from the painted script. */
  el?: SVGGElement;
}

/** Scratch 3 command first-line is 40 + padding 4+4. */
const STACK = 48;
const HAT = 72;
const C_HEAD = 48;
const C_ELSE = 40;
const C_FOOT = 48;
const EMPTY_MOUTH = 28;

export function layoutMarks(block: Block | undefined, y = 0, marks: Mark[] = []): { marks: Mark[]; height: number } {
  const startIndex = marks.length;
  let cursor = y;
  while (block) {
    const start = cursor;
    let headerH = STACK;
    if (block.shape === "c" || block.shape === "c2") {
      headerH = C_HEAD;
      cursor += C_HEAD;
      const body = layoutMarks(block.branches.body, cursor);
      marks.push(...body.marks);
      cursor = body.height === cursor ? cursor + EMPTY_MOUTH : body.height;
      if (block.shape === "c2") {
        cursor += C_ELSE;
        const alt = layoutMarks(block.branches.else, cursor);
        marks.push(...alt.marks);
        cursor = alt.height === cursor ? cursor + EMPTY_MOUTH : alt.height;
      }
      cursor += C_FOOT;
    } else {
      headerH = block.shape === "hat" ? HAT : STACK;
      cursor += headerH;
    }
    marks.push({
      block,
      y: start,
      h: cursor - start,
      headerH,
      chainH: 0,
      line: block.source ? block.source.start.line + 1 : undefined,
    });
    block = block.next;
  }
  for (let i = startIndex; i < marks.length; i++) {
    const mark = marks[i];
    if (mark.chainH === 0) {
      mark.chainH = cursor - mark.y;
    }
  }
  return { marks, height: cursor };
}

export function hitMark(marks: Mark[], relY: number): Mark | undefined {
  let hit: Mark | undefined;
  for (const mark of marks) {
    if (relY >= mark.y && relY < mark.y + mark.h) {
      if (!hit || mark.h < hit.h || (mark.h === hit.h && mark.y > hit.y)) {
        hit = mark;
      }
    }
  }
  return hit;
}

export function scaleMarks(marks: Mark[], layoutHeight: number, svgHeight: number): Mark[] {
  if (layoutHeight <= 0 || svgHeight <= 0) {
    return marks;
  }
  const s = svgHeight / layoutHeight;
  return marks.map((m) => ({
    ...m,
    y: m.y * s,
    h: m.h * s,
    headerH: m.headerH * s,
    chainH: m.chainH * s,
  }));
}

function translateXY(el: Element): { x: number; y: number } {
  const t = el.getAttribute("transform") || "";
  const m = /translate\(\s*([-0-9.eE]+)(?:[ ,]\s*([-0-9.eE]+))?/.exec(t);
  if (!m) {
    return { x: 0, y: 0 };
  }
  return { x: Number(m[1]), y: Number(m[2] ?? 0) };
}

export function groupChildren(el: Element): SVGGElement[] {
  return [...el.children].filter((c): c is SVGGElement => {
    if (c.tagName !== "g" && c.localName !== "g") {
      return false;
    }
    const cls = c.getAttribute("class") || "";
    return !cls.includes("hb-union-glow");
  });
}

function isCommentGroup(g: Element): boolean {
  return Boolean(g.querySelector(".sb3-comment"));
}

/** Scratch 3 mouths are translated to x=16 inside the parent block. */
export function innerScripts(blockG: Element): SVGGElement[] {
  return groupChildren(blockG).filter((g) => {
    if (isCommentGroup(g)) {
      return false;
    }
    const { x } = translateXY(g);
    const nested = groupChildren(g);
    return Math.abs(x - 16) < 1.5 && nested.length > 0;
  });
}

function walkSvgScript(
  head: Block | undefined,
  scriptG: Element,
  offsetY: number,
  scale: number,
  marks: Mark[],
): void {
  const groups = groupChildren(scriptG).filter((g) => !isCommentGroup(g));
  let i = 0;
  const chain: Array<{ block: Block; y: number; h: number; mark: Mark }> = [];
  let block = head;
  while (block && i < groups.length) {
    const g = groups[i++];
    const ty = translateXY(g).y;
    const y = (offsetY + ty) * scale;
    let nextTy: number | undefined;
    if (i < groups.length) {
      nextTy = translateXY(groups[i]).y;
    }
    let unscaledH: number;
    if (nextTy !== undefined) {
      unscaledH = nextTy - ty;
    } else {
      try {
        unscaledH = (g as SVGGElement).getBBox().height || 48;
      } catch {
        unscaledH = 48;
      }
    }
    const mouths = block.shape === "c" || block.shape === "c2" ? innerScripts(g) : [];
    const mouthY = mouths[0] ? translateXY(mouths[0]).y : 0;
    const headerH = Math.max(12, (mouthY > 8 ? mouthY : unscaledH) * scale);
    const h = Math.max(headerH, unscaledH * scale);
    const mark: Mark = {
      block,
      y,
      h,
      headerH,
      chainH: h,
      line: block.source ? block.source.start.line + 1 : undefined,
      el: g,
    };
    marks.push(mark);
    chain.push({ block, y, h, mark });
    if (block.branches.body && mouths[0]) {
      const innerY = translateXY(mouths[0]).y;
      walkSvgScript(block.branches.body, mouths[0], offsetY + ty + innerY, scale, marks);
    }
    if (block.shape === "c2" && block.branches.else && mouths[1]) {
      const innerY = translateXY(mouths[1]).y;
      walkSvgScript(block.branches.else, mouths[1], offsetY + ty + innerY, scale, marks);
    }
    block = block.next;
  }
  if (!chain.length) {
    return;
  }
  const end = chain[chain.length - 1].y + chain[chain.length - 1].h;
  for (const item of chain) {
    item.mark.chainH = end - item.y;
  }
}

/** Prefer real SVG positions so line numbers and hover line up with painted blocks. */
export function marksFromSvg(root: Block, svg: SVGElement | null, scale: number): Mark[] {
  const fallback = (): Mark[] => {
    const laid = layoutMarks(root, 0);
    if (!svg) {
      return laid.marks;
    }
    const svgH = Number(svg.getAttribute("height")) || svg.getBoundingClientRect().height;
    return scaleMarks(laid.marks, laid.height, svgH);
  };
  if (!svg) {
    return fallback();
  }
  const scaled = [...svg.children].find((c) => c.localName === "g");
  if (!scaled) {
    return fallback();
  }
  const scriptG = groupChildren(scaled)[0];
  if (!scriptG) {
    return fallback();
  }
  const marks: Mark[] = [];
  walkSvgScript(root, scriptG, 0, scale, marks);
  if (!marks.length) {
    return fallback();
  }
  return marks;
}
