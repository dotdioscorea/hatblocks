import type { Block } from "../ir/types";
import type { Mark } from "./layout";

const HOVER = "hb-glow-hover";
const SELECT = "hb-glow-select";
const UNION = "hb-union-glow";
const FILTER_HOVER = "hb-halo-hover";
const FILTER_SELECT = "hb-halo-select";

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

function ensureHaloFilters(svg: SVGSVGElement): void {
  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    svg.insertBefore(defs, svg.firstChild);
  }
  const specs: Array<[string, string]> = [
    [FILTER_HOVER, "#ffe566"],
    [FILTER_SELECT, getComputedStyle(document.documentElement).getPropertyValue("--vscode-focusBorder").trim() || "#4daafc"],
  ];
  for (const [id, color] of specs) {
    if (defs.querySelector(`#${id}`)) {
      continue;
    }
    const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
    filter.setAttribute("id", id);
    filter.setAttribute("x", "-0.35");
    filter.setAttribute("y", "-0.35");
    filter.setAttribute("width", "1.7");
    filter.setAttribute("height", "1.7");
    filter.innerHTML = `
      <feMorphology in="SourceAlpha" operator="dilate" radius="2" result="wide"/>
      <feGaussianBlur in="wide" stdDeviation="1.1" result="blur"/>
      <feFlood flood-color="${color}" flood-opacity="0.95" result="tint"/>
      <feComposite in="tint" in2="blur" operator="in" result="glow"/>
      <feMorphology in="SourceAlpha" operator="dilate" radius="0.6" result="core"/>
      <feComposite in="glow" in2="core" operator="out"/>
    `;
    defs.appendChild(filter);
  }
}

function clearKind(root: ParentNode, kind: "hover" | "select"): void {
  const cls = kind === "hover" ? HOVER : SELECT;
  root.querySelectorAll(`.${cls}`).forEach((el) => el.classList.remove(cls));
  root.querySelectorAll(`g.${UNION}[data-hb-glow="${kind}"]`).forEach((el) => el.remove());
}

export function clearHoverGlows(root: ParentNode): void {
  clearKind(root, "hover");
  root.querySelectorAll(".hb-hl").forEach((el) => el.remove());
}

export function clearSelectGlows(root: ParentNode): void {
  clearKind(root, "select");
}

function paintUnion(groups: SVGGElement[], kind: "hover" | "select"): void {
  const parent = groups[0]?.parentNode;
  if (!parent) {
    return;
  }
  const svg = groups[0].ownerSVGElement;
  if (svg) {
    ensureHaloFilters(svg);
  }
  if (groups.length === 1) {
    groups[0].classList.add(kind === "hover" ? HOVER : SELECT);
    return;
  }
  const overlay = document.createElementNS("http://www.w3.org/2000/svg", "g");
  overlay.setAttribute("class", UNION);
  overlay.setAttribute("data-hb-glow", kind);
  overlay.setAttribute("pointer-events", "none");
  overlay.setAttribute("filter", `url(#${kind === "hover" ? FILTER_HOVER : FILTER_SELECT})`);
  for (const g of groups) {
    overlay.appendChild(g.cloneNode(true));
  }
  parent.appendChild(overlay);
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
  paintUnion(groups.length ? groups : [hit.el], "hover");
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
  paintUnion([mark.el], "select");
}
