import type { Block } from "../ir/types";
import { groupChildren, innerScripts, type Mark } from "./layout";

const FILTER_HOVER = "hb-hl-hover";
const FILTER_CLUMP = "hb-hl-clump";
const FILTER_SELECT = "hb-hl-select";

function isShapePath(el: Element): el is SVGPathElement {
  if (el.localName !== "path") {
    return false;
  }
  const cls = el.getAttribute("class") || "";
  if (/sb3-input|sb3-label|sb3-comment/.test(cls)) {
    return false;
  }
  return true;
}

/** The brick silhouette (not input ovals, not nested mouth contents). */
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

/** Brick silhouettes for this block and everything nested in its mouths. */
export function nestedShapePaths(blockG: Element): SVGPathElement[] {
  const own = ownShapePaths(blockG);
  const nested = innerScripts(blockG).flatMap((script) =>
    groupChildren(script).flatMap((child) => nestedShapePaths(child)),
  );
  return [...own, ...nested];
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

function clumpIsMoreThanSelf(hit: Mark): boolean {
  if (hit.block.next) {
    return true;
  }
  return Boolean(hit.block.branches.body || hit.block.branches.else);
}

function ensureFilters(svg: SVGSVGElement): void {
  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    svg.insertBefore(defs, svg.firstChild);
  }
  const focus =
    getComputedStyle(document.documentElement).getPropertyValue("--vscode-focusBorder").trim() || "#4daafc";
  const specs: Array<[string, string, string]> = [
    [FILTER_HOVER, "#ffffff", "0.95"],
    [FILTER_CLUMP, "#ffe566", "0.92"],
    [FILTER_SELECT, focus, "1"],
  ];
  for (const [id, color, opacity] of specs) {
    if (defs.querySelector(`#${id}`)) {
      continue;
    }
    const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
    filter.setAttribute("id", id);
    filter.setAttribute("x", "-0.25");
    filter.setAttribute("y", "-0.25");
    filter.setAttribute("width", "1.5");
    filter.setAttribute("height", "1.5");
    filter.innerHTML = `
      <feMorphology in="SourceAlpha" operator="dilate" radius="2.8" result="dilate"/>
      <feComposite in="dilate" in2="SourceAlpha" operator="out" result="ring"/>
      <feFlood flood-color="${color}" flood-opacity="${opacity}" result="color"/>
      <feComposite in="color" in2="ring" operator="in"/>
    `;
    defs.appendChild(filter);
  }
}

function overlayRoot(svg: SVGSVGElement): SVGGElement {
  ensureFilters(svg);
  const scaled = [...svg.children].find((c) => c.localName === "g") as SVGGElement | undefined;
  const parent = scaled ?? svg;
  let layer = parent.querySelector(":scope > .hb-hl") as SVGGElement | null;
  if (!layer) {
    layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    layer.setAttribute("class", "hb-hl");
    layer.setAttribute("pointer-events", "none");
    parent.appendChild(layer);
  }
  return layer;
}

function matrixAttr(from: SVGGraphicsElement, dest: SVGGraphicsElement): string {
  const a = from.getCTM();
  const b = dest.getCTM();
  if (!a || !b) {
    return "";
  }
  const m = b.inverse().multiply(a);
  return `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`;
}

function cloneFilled(path: SVGPathElement, dest: SVGGElement): void {
  const clone = document.createElementNS("http://www.w3.org/2000/svg", "path");
  clone.setAttribute("d", path.getAttribute("d") || "");
  const t = matrixAttr(path, dest);
  if (t) {
    clone.setAttribute("transform", t);
  }
  clone.setAttribute("fill", "#fff");
  clone.setAttribute("stroke", "none");
  dest.appendChild(clone);
}

function cloneStroked(path: SVGPathElement, dest: SVGGElement, stroke: string): void {
  const clone = document.createElementNS("http://www.w3.org/2000/svg", "path");
  clone.setAttribute("d", path.getAttribute("d") || "");
  const t = matrixAttr(path, dest);
  if (t) {
    clone.setAttribute("transform", t);
  }
  clone.setAttribute("fill", "none");
  clone.setAttribute("stroke", stroke);
  clone.setAttribute("stroke-width", "3");
  clone.setAttribute("stroke-linejoin", "round");
  clone.setAttribute("stroke-linecap", "round");
  dest.appendChild(clone);
}

function addGroup(layer: SVGGElement, cls: string, filter: string): SVGGElement {
  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("class", cls);
  g.setAttribute("filter", `url(#${filter})`);
  layer.appendChild(g);
  return g;
}

export function clearHighlights(svg: SVGSVGElement | null): void {
  svg?.querySelector(".hb-hl")?.replaceChildren();
}

export function paintHover(svg: SVGSVGElement | null, hit: Mark | undefined, marks: Mark[]): void {
  if (!svg) {
    return;
  }
  const layer = overlayRoot(svg);
  layer.querySelectorAll(".hb-hover, .hb-clump").forEach((n) => n.remove());
  if (!hit?.el) {
    return;
  }
  if (clumpIsMoreThanSelf(hit)) {
    const clump = addGroup(layer, "hb-clump", FILTER_CLUMP);
    const groups = clumpGroups(hit, marks);
    const seen = new Set<SVGPathElement>();
    for (const g of groups) {
      for (const path of nestedShapePaths(g)) {
        if (seen.has(path)) {
          continue;
        }
        seen.add(path);
        cloneFilled(path, clump);
      }
    }
  }
  const hover = addGroup(layer, "hb-hover", FILTER_HOVER);
  for (const path of ownShapePaths(hit.el)) {
    cloneFilled(path, hover);
  }
}

export function paintSelect(svg: SVGSVGElement | null, mark: Mark | undefined): void {
  if (!svg) {
    return;
  }
  const layer = overlayRoot(svg);
  layer.querySelectorAll(".hb-select").forEach((n) => n.remove());
  if (!mark?.el) {
    return;
  }
  const select = addGroup(layer, "hb-select", FILTER_SELECT);
  for (const path of ownShapePaths(mark.el)) {
    cloneFilled(path, select);
  }
}

void cloneStroked;
