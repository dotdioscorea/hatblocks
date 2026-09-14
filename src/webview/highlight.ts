import type { Block } from "../ir/types";
import { innerScripts, type Mark } from "./layout";

const HOVER = "hb-glow-hover";
const SELECT = "hb-glow-select";

function isShapePath(el: Element): el is SVGPathElement {
  if (el.localName !== "path") {
    return false;
  }
  const cls = el.getAttribute("class") || "";
  return !/sb3-input|sb3-label|sb3-comment/.test(cls);
}

/** Brick silhouette only — not input ovals, not nested mouth contents. */
export function ownShapePaths(blockG: Element): SVGPathElement[] {
  const mouths = new Set(innerScripts(blockG));
  const out: SVGPathElement[] = [];
  const walk = (el: Element): void => {
    if (mouths.has(el as SVGGElement)) {
      return;
    }
    if (isShapePath(el)) {
      out.push(el);
      return;
    }
    for (const child of el.children) {
      walk(child);
    }
  };
  walk(blockG);
  return out;
}

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

function stripClones(root: ParentNode, kind: "hover" | "select"): void {
  root.querySelectorAll(`path[data-hb-glow="${kind}"]`).forEach((el) => el.remove());
}

function addGlows(groups: SVGGElement[], kind: "hover" | "select"): void {
  for (const g of groups) {
    for (const path of ownShapePaths(g)) {
      const clone = path.cloneNode() as SVGPathElement;
      clone.setAttribute("data-hb-glow", kind);
      clone.setAttribute("class", kind === "hover" ? HOVER : SELECT);
      clone.setAttribute("fill", "none");
      clone.setAttribute("pointer-events", "none");
      path.parentNode?.appendChild(clone);
    }
  }
}

export function clearHoverGlows(root: ParentNode): void {
  stripClones(root, "hover");
  root.querySelectorAll(".hb-hl").forEach((el) => el.remove());
}

export function clearSelectGlows(root: ParentNode): void {
  stripClones(root, "select");
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
  addGlows(groups.length ? groups : [hit.el], "hover");
}

export function paintSelect(svg: SVGSVGElement | null, mark: Mark | undefined): void {
  const world = document.getElementById("world") ?? svg;
  if (!world) {
    return;
  }
  clearSelectGlows(world);
  if (!mark?.el) {
    return;
  }
  addGlows([mark.el], "select");
}
