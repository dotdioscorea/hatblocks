import type { Block } from "../ir/types";
import type { Mark } from "./layout";

const HOVER = "hb-glow-hover";
const SELECT = "hb-glow-select";

export function clumpGroups(hit: Mark, marks: Mark[]): SVGGElement[] {
  const out: SVGGElement[] = [];
  let block: Block | undefined = hit.block;
  while (block) {
    const mark = marks.find((m) => m.block.id === block!.id);
    if (mark?.el) {
      out.push(mark.el);
    }
    block = block.next;
  }
  return out;
}

function strip(el: Element, cls: string): void {
  el.classList.remove(cls);
}

export function clearHoverGlows(root: ParentNode): void {
  root.querySelectorAll(`.${HOVER}`).forEach((el) => strip(el, HOVER));
  root.querySelectorAll(".hb-hl").forEach((el) => el.remove());
}

export function clearSelectGlows(root: ParentNode): void {
  root.querySelectorAll(`.${SELECT}`).forEach((el) => strip(el, SELECT));
}

export function paintHover(_svg: SVGSVGElement | null, hit: Mark | undefined, marks: Mark[]): void {
  const world = document.getElementById("world");
  if (!world) {
    return;
  }
  clearHoverGlows(world);
  if (!hit?.el) {
    return;
  }
  const groups = clumpGroups(hit, marks);
  const targets = groups.length ? groups : [hit.el];
  for (const g of targets) {
    g.classList.add(HOVER);
  }
}

export function paintSelect(svg: SVGSVGElement | null, mark: Mark | undefined): void {
  if (!svg) {
    return;
  }
  const world = document.getElementById("world");
  if (world) {
    clearSelectGlows(world);
  } else {
    clearSelectGlows(svg);
  }
  if (!mark?.el) {
    return;
  }
  mark.el.classList.add(SELECT);
}
