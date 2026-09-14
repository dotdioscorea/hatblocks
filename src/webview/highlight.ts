import type { Block } from "../ir/types";
import type { Mark } from "./layout";

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
    [
      FILTER_SELECT,
      getComputedStyle(document.documentElement).getPropertyValue("--vscode-focusBorder").trim() || "#4daafc",
    ],
  ];
  for (const [id, color] of specs) {
    if (defs.querySelector(`#${id}`)) {
      continue;
    }
    const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
    filter.setAttribute("id", id);
    filter.setAttribute("x", "-0.4");
    filter.setAttribute("y", "-0.4");
    filter.setAttribute("width", "1.8");
    filter.setAttribute("height", "1.8");
    filter.innerHTML = `
      <feMorphology in="SourceAlpha" operator="dilate" radius="1.8" result="wide"/>
      <feGaussianBlur in="wide" stdDeviation="1" result="blur"/>
      <feFlood flood-color="${color}" flood-opacity="0.95" result="tint"/>
      <feComposite in="tint" in2="blur" operator="in" result="glow"/>
      <feMorphology in="SourceAlpha" operator="dilate" radius="0.5" result="core"/>
      <feComposite in="glow" in2="core" operator="out"/>
    `;
    defs.appendChild(filter);
  }
}

function scrubClone(el: Element): void {
  el.classList.remove("hb-glow-hover", "hb-glow-select", UNION);
  el.querySelectorAll(`g.${UNION}, [data-hb-glow]`).forEach((n) => n.remove());
  el.querySelectorAll(".hb-glow-hover, .hb-glow-select").forEach((n) => {
    n.classList.remove("hb-glow-hover", "hb-glow-select");
  });
}

export function clearAllGlows(root: ParentNode): void {
  root.querySelectorAll(`g.${UNION}`).forEach((el) => el.remove());
  root.querySelectorAll(".hb-hl").forEach((el) => el.remove());
  root.querySelectorAll(".hb-glow-hover, .hb-glow-select").forEach((el) => {
    el.classList.remove("hb-glow-hover", "hb-glow-select");
  });
}

export function clearHoverGlows(root: ParentNode): void {
  root.querySelectorAll(`g.${UNION}[data-hb-glow="hover"]`).forEach((el) => el.remove());
}

export function clearSelectGlows(root: ParentNode): void {
  root.querySelectorAll(`g.${UNION}[data-hb-glow="select"]`).forEach((el) => el.remove());
  root.querySelectorAll(".hb-glow-select").forEach((el) => el.classList.remove("hb-glow-select"));
}

function paintClump(groups: SVGGElement[], kind: "hover" | "select"): void {
  if (!groups.length) {
    return;
  }
  const parent = groups[0].parentNode;
  const svg = groups[0].ownerSVGElement;
  if (!parent || !svg) {
    return;
  }
  ensureHaloFilters(svg);
  const overlay = document.createElementNS("http://www.w3.org/2000/svg", "g");
  overlay.setAttribute("class", UNION);
  overlay.setAttribute("data-hb-glow", kind);
  overlay.setAttribute("pointer-events", "none");
  overlay.setAttribute("filter", `url(#${kind === "hover" ? FILTER_HOVER : FILTER_SELECT})`);
  for (const g of groups) {
    const clone = g.cloneNode(true) as SVGGElement;
    scrubClone(clone);
    overlay.appendChild(clone);
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
  paintClump(groups.length ? groups : [hit.el], "hover");
}

export function paintSelect(_svg: SVGSVGElement | null, mark: Mark | undefined): void {
  const world = document.getElementById("world");
  if (!world) {
    return;
  }
  clearSelectGlows(world);
  if (!mark?.el) {
    return;
  }
  paintClump([mark.el], "select");
}
