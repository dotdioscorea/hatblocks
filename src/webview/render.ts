import scratchblocks from "scratchblocks";
import { emitToolboxBlock } from "../emit/scratchblocks";
import type { Block } from "../ir/types";

let styles = false;

export function ensureScratchStyles(): void {
  if (!styles) {
    scratchblocks.appendStyles();
    styles = true;
  }
}

export function renderBlockSvg(block: Block, scale: number): SVGElement {
  return renderCodeSvg(emitToolboxBlock(block), scale);
}

export function renderCodeSvg(code: string, scale: number): SVGElement {
  ensureScratchStyles();
  const doc = scratchblocks.parse(code, { languages: ["en"] });
  return scratchblocks.render(doc, { style: "scratch3", scale });
}
