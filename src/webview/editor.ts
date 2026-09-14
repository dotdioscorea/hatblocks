import css from "./editor.css";
import { emitProgram } from "../emit/scratchblocks";
import { cloneBlock, lastBlock } from "../ir/clone";
import { createIdFactory, recomputeStats } from "../ir/ids";
import { isLiteral, litEmpty } from "../ir/builders";
import { rebuildHat, rebuildCall, rebuildChain, rebuildForRange, rebuildLambda } from "../library/hats";
import { CATALOG_BY_OPCODE, prototypeFromDef } from "../library/catalog";
import { findBlock, findInProgram, unlink } from "../ir/tree";
import type { Block, Literal, Program, Script } from "../ir/types";
import type { EditorToHost, HostToEditor, InspectorMutation } from "../protocol";
import { renderCodeSvg, renderBlockSvg, ensureScratchStyles } from "./render";
import { hitMark, marksFromSvg, type Mark } from "./layout";
import { clearAllGlows, clearHoverGlows, paintHover, paintSelect } from "./highlight";

const vscode = acquireVsCodeApi();
const SCALE = 0.72;
const COLUMN_X = 12;
const LINE_H = 22;
const SNAP = 36;

let program: Program | undefined;
let selectedId: string | undefined;
let selectedBlockId: string | undefined;
let zoom = 1;
let libraryProto: Block | undefined;
let dragging = false;
let hoverKey = "";
const marksCache = new WeakMap<SVGElement, Mark[]>();
const SLOT_PX = 54;
let arityDrag:
  | {
      blockId: string;
      startX: number;
      startCount: number;
      kind: "args" | "params";
    }
  | undefined;

const app = document.createElement("div");
app.id = "app";
app.innerHTML = `
  <div class="stage-wrap" id="stageWrap">
    <div class="gutter" id="gutter"></div>
    <div class="canvas" id="canvas">
      <div class="world-wrap" id="worldWrap">
        <div class="world" id="world"></div>
        <svg class="snap-notch" id="snapNotch" width="200" height="20"></svg>
      </div>
      <div class="snap-guide" id="guide"></div>
    </div>
    <div class="hud">
      <button class="flag" id="run" title="Green flag — compile and run">
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <rect x="2" y="3" width="2.2" height="13" rx="0.6" fill="#fff"/>
          <path d="M4.2 3.2h9.2l-2.4 3.2 2.4 3.2H4.2V3.2z" fill="#fff"/>
        </svg>
      </button>
      <div class="stats" id="stats"></div>
      <div class="mutator" id="mutator">
        <span class="label" id="mutatorLabel"></span>
        <button type="button" id="addArg">+ arg</button>
        <button type="button" id="delArg">− arg</button>
      </div>
    </div>
    <div class="hint">Hover outlines the stack that would tear off. Click to inspect. Drag from the Blocks sidebar; drop reporters into holes.</div>
  </div>
`;
document.body.appendChild(app);
const style = document.createElement("style");
style.textContent = css;
document.head.appendChild(style);
ensureScratchStyles();

const world = $("world");
const worldWrap = $("worldWrap");
const stageWrap = $("stageWrap");
const canvasEl = $("canvas");
const guide = $("guide");
const gutter = $("gutter");
let packOnce = false;

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

function post(message: EditorToHost): void {
  vscode.postMessage(message);
}

post({ type: "ready" });

window.addEventListener("message", (event: MessageEvent<HostToEditor>) => {
  const msg = event.data;
  if (msg.type === "setProgram") {
    const keep = selectedBlockId;
    program = msg.program;
    selectedId = undefined;
    selectedBlockId = keep && findInProgram(program, keep) ? keep : undefined;
    packOnce = true;
    renderAll();
    publishSelection();
  }
  if (msg.type === "insert") {
    insertBlock(msg.block);
  }
  if (msg.type === "libraryDrag") {
    libraryProto = msg.block;
  }
  if (msg.type === "requestExport") {
    void exportPng();
  }
  if (msg.type === "applyMutation") {
    applyMutation(msg.mutation);
  }
});

$("run").addEventListener("click", () => post({ type: "run" }));
$("addArg").addEventListener("click", () => mutateSelected(1));
$("delArg").addEventListener("click", () => mutateSelected(-1));

canvasEl.addEventListener("dragover", (event) => {
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
  const worldPt = clientToWorld(event.clientX, event.clientY);
  const dummy: Script = { id: "ghost", x: worldPt.x, y: worldPt.y, root: libraryProto ?? ({ shape: "stack" } as Block) };
  showSnap(dummy);
});
canvasEl.addEventListener("drop", (event) => {
  event.preventDefault();
  hideSnap();
  let proto = libraryProto;
  const raw = event.dataTransfer?.getData("application/json");
  if (raw) {
    try {
      proto = JSON.parse(raw) as Block;
    } catch {
      /* keep hub payload */
    }
  }
  if (!proto) {
    return;
  }
  const worldPt = clientToWorld(event.clientX, event.clientY);
  insertBlockAt(proto, worldPt.x, worldPt.y);
  libraryProto = undefined;
});

stageWrap.addEventListener("wheel", (event) => {
  if (event.metaKey || event.ctrlKey) {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 0.92 : 1.08;
    zoom = Math.min(2.4, Math.max(0.35, zoom * factor));
    applyView();
  }
}, { passive: false });
canvasEl.addEventListener("scroll", () => {
  renderGutter();
});
stageWrap.addEventListener("pointerdown", (event) => {
  if ((event.target as HTMLElement).closest(".script, .gap-ui")) {
    return;
  }
  clearHover();
});
stageWrap.addEventListener("pointermove", (event) => {
  if (!dragging && !(event.target as HTMLElement).closest(".script")) {
    clearHover();
  }
});
stageWrap.addEventListener("pointerleave", () => {
  if (!dragging) {
    clearHover();
  }
});

window.addEventListener("keydown", (event) => {
  const mod = event.metaKey || event.ctrlKey;
  if (mod && (event.key === "=" || event.key === "+" || event.code === "Equal")) {
    event.preventDefault();
    zoom = Math.min(2.4, zoom * 1.1);
    applyView();
    return;
  }
  if (mod && (event.key === "-" || event.code === "Minus")) {
    event.preventDefault();
    zoom = Math.max(0.35, zoom / 1.1);
    applyView();
    return;
  }
  if (mod && event.key === "0") {
    event.preventDefault();
    zoom = 1;
    applyView();
    return;
  }
  if (mod && event.key.toLowerCase() === "z") {
    event.preventDefault();
    post({ type: event.shiftKey ? "redo" : "undo" });
    return;
  }
  if (mod && event.key.toLowerCase() === "y") {
    event.preventDefault();
    post({ type: "redo" });
    return;
  }
  if ((event.key === "Backspace" || event.key === "Delete") && selectedBlockId && program) {
    const script = selectedId ? findScript(selectedId) : undefined;
    if (script && script.root.id === selectedBlockId) {
      program.sprites[0].scripts = program.sprites[0].scripts.filter((s) => s.id !== selectedId);
      selectedId = undefined;
      selectedBlockId = undefined;
      commit();
    }
  }
});

function applyView(): void {
  const bounds = contentBounds();
  world.style.width = `${bounds.w}px`;
  world.style.height = `${bounds.h}px`;
  world.style.transform = `scale(${zoom})`;
  world.style.transformOrigin = "0 0";
  worldWrap.style.width = `${bounds.w * zoom}px`;
  worldWrap.style.height = `${bounds.h * zoom}px`;
  renderGutter();
}

function contentBounds(): { w: number; h: number } {
  const minW = Math.max(1, canvasEl.clientWidth / zoom);
  const minH = Math.max(1, canvasEl.clientHeight / zoom);
  let w = minW;
  let h = minH;
  if (!program) {
    return { w, h };
  }
  for (const script of program.sprites[0].scripts) {
    const el = world.querySelector(`.script[data-id="${script.id}"]`) as HTMLElement | null;
    w = Math.max(w, script.x + (el?.offsetWidth ?? 200) + 48);
    h = Math.max(h, script.y + (el?.offsetHeight ?? 72) + 48);
  }
  return { w, h };
}

function renderAll(): void {
  if (!program) {
    return;
  }
  if (!program.sprites[0]) {
    program.sprites.push({ name: program.fileName, scripts: [] });
  }
  $("stats").textContent = `${program.stats.scripts} scripts · ${program.stats.blocks} blocks`;
  updateMutator();
  renderScripts();
  if (packOnce) {
    packOnce = false;
    packVertically();
    renderScripts();
  }
  applyView();
}

function scriptHeight(script: Script): number {
  const el = world.querySelector(`.script[data-id="${script.id}"]`) as HTMLElement | null;
  return el?.offsetHeight ?? 72;
}

function packVertically(): void {
  if (!program) {
    return;
  }
  let y = 12;
  const scripts = program.sprites[0].scripts;
  for (let i = 0; i < scripts.length; i++) {
    const script = scripts[i];
    script.x = COLUMN_X;
    const gap = i === 0 ? 0 : Math.max(1, script.gapBefore ?? 1);
    script.gapBefore = gap;
    if (i > 0) {
      y += gap * LINE_H;
    }
    script.y = y;
    y += scriptHeight(script);
  }
}

function enforceMinGaps(): void {
  if (!program) {
    return;
  }
  const scripts = [...program.sprites[0].scripts].sort((a, b) => a.y - b.y || a.x - b.x);
  program.sprites[0].scripts = scripts;
  for (let i = 0; i < scripts.length; i++) {
    if (i === 0) {
      scripts[i].gapBefore = 0;
      continue;
    }
    const prev = scripts[i - 1];
    const prevBottom = prev.y + scriptHeight(prev);
    const minY = prevBottom + LINE_H;
    if (scripts[i].y < minY) {
      scripts[i].y = minY;
    }
    scripts[i].gapBefore = Math.max(1, Math.round((scripts[i].y - prevBottom) / LINE_H));
  }
}

function renderScripts(): void {
  if (!program) {
    return;
  }
  world.innerHTML = "";
  const emitted = emitProgram(program);
  for (const script of emitted) {
    const el = document.createElement("div");
    el.className = "script";
    el.dataset.id = script.id;
    el.style.left = `${script.x}px`;
    el.style.top = `${script.y}px`;
    el.appendChild(renderCodeSvg(script.code, SCALE));
    el.addEventListener("pointerdown", (event) => startBlockDrag(event, script.id));
    el.addEventListener("pointermove", (event) => {
      if (dragging || arityDrag) {
        return;
      }
      hoverScript(script.id, event);
      updateArityHandleHot(script.id, event);
    });
    el.addEventListener("pointerleave", () => clearHover(script.id));
    el.addEventListener("dblclick", (event) => {
      event.preventDefault();
      editScript(script.id);
    });
    world.appendChild(el);
  }
  renderGaps();
  placeArityHandles();
  hoverKey = "";
  paintSelection();
  renderGutter();
}

function renderGaps(): void {
  if (!program) {
    return;
  }
  world.querySelectorAll(".gap-ui").forEach((el) => el.remove());
  const scripts = [...program.sprites[0].scripts].sort((a, b) => a.y - b.y);
  for (let i = 1; i < scripts.length; i++) {
    const prev = scripts[i - 1];
    const curr = scripts[i];
    const top = prev.y + scriptHeight(prev);
    const height = curr.y - top;
    if (height < 8) {
      continue;
    }
    const gap = Math.max(1, curr.gapBefore ?? Math.round(height / LINE_H) ?? 1);
    for (let k = 0; k < gap; k++) {
      const ui = document.createElement("div");
      ui.className = "gap-ui";
      ui.style.left = "0";
      ui.style.right = "0";
      ui.style.top = `${top + k * LINE_H}px`;
      ui.style.height = `${LINE_H}px`;
      ui.innerHTML = `<div class="gap-btns"><button type="button" class="gap-btn" data-act="add" title="Add a blank line">+</button><button type="button" class="gap-btn" data-act="remove" title="Remove a blank line" ${gap <= 1 ? "disabled" : ""}>−</button></div><div class="gap-rule"></div>`;
      ui.addEventListener("pointerdown", (event) => event.stopPropagation());
      ui.querySelector('[data-act="add"]')?.addEventListener("click", (event) => {
        event.stopPropagation();
        bumpGap(curr, 1);
      });
      ui.querySelector('[data-act="remove"]')?.addEventListener("click", (event) => {
        event.stopPropagation();
        bumpGap(curr, -1);
      });
      world.appendChild(ui);
    }
  }
}

function bumpGap(script: Script, delta: number): void {
  if (!program) {
    return;
  }
  const next = Math.max(1, (script.gapBefore ?? 1) + delta);
  if (next === (script.gapBefore ?? 1) && delta < 0) {
    return;
  }
  const dy = (next - (script.gapBefore ?? 1)) * LINE_H;
  script.gapBefore = next;
  for (const other of program.sprites[0].scripts) {
    if (other.y >= script.y) {
      other.y += dy;
    }
  }
  commit();
}

function marksForScript(script: Script): Mark[] {
  const el = world.querySelector(`.script[data-id="${script.id}"]`) as HTMLElement | null;
  const svg = el?.querySelector("svg") as SVGElement | null;
  if (!svg) {
    return marksFromSvg(script.root, null, SCALE);
  }
  const cached = marksCache.get(svg);
  if (cached) {
    return cached;
  }
  const marks = marksFromSvg(script.root, svg, SCALE);
  marksCache.set(svg, marks);
  return marks;
}

function renderGutter(): void {
  if (!program) {
    gutter.innerHTML = "";
    return;
  }
  gutter.innerHTML = "";
  const scripts = program.sprites[0].scripts;
  for (let i = 0; i < scripts.length; i++) {
    const script = scripts[i];
    const marks = marksForScript(script);
    if (i > 0) {
      const gap = Math.max(0, script.gapBefore ?? 0);
      const first = marks.map((m) => m.line).filter((n): n is number => n !== undefined).sort((a, b) => a - b)[0];
      const prev = scripts[i - 1];
      const top = prev.y + scriptHeight(prev);
      const startLine = first !== undefined ? first - gap : undefined;
      for (let k = 0; k < gap; k++) {
        const n = document.createElement("div");
        n.className = "ln";
        n.textContent = startLine !== undefined ? String(startLine + k) : "";
        n.title = startLine !== undefined ? `Line ${startLine + k}` : "Blank line";
        n.style.top = `${(top + k * LINE_H) * zoom - canvasEl.scrollTop}px`;
        n.style.height = `${LINE_H * zoom}px`;
        gutter.appendChild(n);
      }
    }
    for (const mark of marks) {
      if (mark.line === undefined) {
        continue;
      }
      const n = document.createElement("div");
      n.className = `ln${mark.block.id === selectedBlockId && mark.role !== "closer" ? " active" : ""}`;
      n.textContent = String(mark.line);
      n.title = mark.role === "closer" ? `Line ${mark.line} (closer)` : `Line ${mark.line}`;
      n.style.top = `${(script.y + mark.y) * zoom - canvasEl.scrollTop}px`;
      n.style.height = `${Math.max(12, (mark.headerH || Math.min(mark.h, 36)) * zoom)}px`;
      gutter.appendChild(n);
    }
  }
}

function clientToWorld(cx: number, cy: number): { x: number; y: number } {
  const rect = canvasEl.getBoundingClientRect();
  return {
    x: (cx - rect.left + canvasEl.scrollLeft) / zoom,
    y: (cy - rect.top + canvasEl.scrollTop) / zoom,
  };
}

function findScript(id: string): Script | undefined {
  return program?.sprites[0]?.scripts.find((s) => s.id === id);
}

function selectedRoot(): Block | undefined {
  if (!program || !selectedBlockId) {
    return undefined;
  }
  return findInProgram(program, selectedBlockId);
}

function isFnSig(block: Block): boolean {
  return block.opcode === "events.flag" || block.opcode === "custom.define" || block.opcode === "c.fn" || block.opcode === "py.def";
}

function isCall(block: Block): boolean {
  return (
    block.opcode === "custom.call" ||
    block.opcode === "custom.reporter" ||
    block.opcode === "custom.method" ||
    block.opcode === "custom.tmplCall" ||
    block.opcode === "ops.chain" ||
    block.opcode === "py.list" ||
    block.opcode === "py.tuple"
  );
}

function isReporterish(block: Block): boolean {
  return block.shape === "reporter" || block.shape === "boolean";
}

function isArityBlock(block: Block): boolean {
  return isCall(block) || isFnSig(block);
}

function arityCount(block: Block): number {
  return isFnSig(block) ? block.params?.length ?? 0 : block.extraArgs?.length ?? 0;
}

function arityMin(block: Block): number {
  return block.opcode === "ops.chain" ? 1 : 0;
}

function isEmptySlot(block: Block, index: number): boolean {
  if (isFnSig(block)) {
    const name = block.params?.[index]?.name ?? "";
    return !name.trim();
  }
  const arg = block.extraArgs?.[index];
  return !arg || (isLiteral(arg) && arg.kind === "empty");
}

function setArity(block: Block, count: number): boolean {
  const min = arityMin(block);
  let next = Math.max(min, count);
  if (isFnSig(block)) {
    block.params = block.params ?? [];
    while (block.params.length < next) {
      block.params.push({ type: program?.language === "python" ? "Any" : "int", name: "" });
    }
    while (block.params.length > next && block.params.length > min && isEmptySlot(block, block.params.length - 1)) {
      block.params.pop();
    }
    next = block.params.length;
    rebuildHat(block);
  } else {
    block.extraArgs = block.extraArgs ?? [];
    while (block.extraArgs.length < next) {
      block.extraArgs.push(litEmpty());
      if (block.opcode === "ops.chain") {
        const i = block.extraArgs.length - 1;
        block.fields[`op${i}`] = block.fields.op || "+";
      }
    }
    while (block.extraArgs.length > next && block.extraArgs.length > min && isEmptySlot(block, block.extraArgs.length - 1)) {
      block.extraArgs.pop();
    }
    next = block.extraArgs.length;
    if (block.opcode === "ops.chain") {
      rebuildChain(block);
    } else {
      rebuildCall(block);
    }
  }
}

function rectIn(el: HTMLElement, r: DOMRect): { x: number; y: number; w: number; h: number } {
  const sr = el.getBoundingClientRect();
  const sx = el.offsetWidth / Math.max(1, sr.width);
  const sy = el.offsetHeight / Math.max(1, sr.height);
  return {
    x: (r.left - sr.left) * sx,
    y: (r.top - sr.top) * sy,
    w: r.width * sx,
    h: r.height * sy,
  };
}

function placeArityHandles(): void {
  if (!program) {
    return;
  }
  for (const script of program.sprites[0].scripts) {
    const el = world.querySelector(`.script[data-id="${script.id}"]`) as HTMLElement | null;
    if (!el) {
      continue;
    }
    for (const mark of marksForScript(script)) {
      if (mark.role === "closer" || !mark.el || !isArityBlock(mark.block)) {
        continue;
      }
      const box = rectIn(el, mark.el.getBoundingClientRect());
      const handle = document.createElement("div");
      handle.className = "arity-handle";
      handle.dataset.block = mark.block.id;
      handle.title = "Drag to add or remove slots";
      handle.style.left = `${box.x + box.w - 6}px`;
      handle.style.top = `${box.y + 4}px`;
      handle.style.height = `${Math.max(16, Math.min(box.h, mark.headerH || box.h) - 8)}px`;
      handle.addEventListener("pointerdown", (event) => startArityDrag(event, mark.block));
      el.appendChild(handle);
    }
  }
}

function updateArityHandleHot(scriptId: string, event: PointerEvent): void {
  const script = findScript(scriptId);
  const el = world.querySelector(`.script[data-id="${scriptId}"]`) as HTMLElement | null;
  if (!script || !el) {
    return;
  }
  const marks = marksForScript(script);
  const hit = hitMark(marks, clientToWorld(event.clientX, event.clientY).y - script.y);
  el.querySelectorAll(".arity-handle").forEach((node) => {
    const handle = node as HTMLElement;
    const hot = Boolean(hit && handle.dataset.block === hit.block.id && isArityBlock(hit.block));
    handle.classList.toggle("hot", hot);
  });
}

function startArityDrag(event: PointerEvent, block: Block): void {
  event.stopPropagation();
  event.preventDefault();
  dragging = true;
  selectedBlockId = block.id;
  arityDrag = {
    blockId: block.id,
    startX: event.clientX,
    startCount: arityCount(block),
    kind: isFnSig(block) ? "params" : "args",
  };
  clearHover();
  const move = (ev: PointerEvent) => {
    if (!arityDrag || !program) {
      return;
    }
    const current = findInProgram(program, arityDrag.blockId);
    if (!current) {
      return;
    }
    const delta = Math.round((ev.clientX - arityDrag.startX) / (SLOT_PX * zoom));
    const target = arityDrag.startCount + delta;
    const before = arityCount(current);
    setArity(current, target);
    if (arityCount(current) !== before) {
      renderScripts();
      updateMutator();
    }
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    dragging = false;
    arityDrag = undefined;
    commit();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function publishSelection(): void {
  const block = selectedRoot() ?? null;
  post({ type: "select", block, language: program?.language ?? "c", fileName: program?.fileName });
}

function updateMutator(): void {
  const bar = $("mutator");
  const label = $("mutatorLabel");
  const root = selectedRoot();
  if (!root || (!isFnSig(root) && !isCall(root))) {
    bar.classList.remove("show");
    return;
  }
  bar.classList.add("show");
  if (isFnSig(root)) {
    const n = root.params?.length ?? 0;
    label.textContent = n === 1 ? "1 parameter" : `${n} parameters`;
  } else {
    const n = root.extraArgs?.length ?? 0;
    label.textContent = n === 1 ? "1 argument" : `${n} arguments`;
  }
}

function scriptSvg(scriptId: string): SVGSVGElement | null {
  return world.querySelector(`.script[data-id="${scriptId}"] svg`) as SVGSVGElement | null;
}

function clearHover(_scriptId?: string): void {
  hoverKey = "";
  clearHoverGlows(world);
}

function paintSelection(): void {
  clearAllGlows(world);
  if (!program || !selectedBlockId) {
    return;
  }
  for (const script of program.sprites[0].scripts) {
    const mark = marksForScript(script).find((m) => m.block.id === selectedBlockId);
    if (mark) {
      paintSelect(scriptSvg(script.id), mark);
      return;
    }
  }
}

function hoverScript(scriptId: string, event: PointerEvent): void {
  const script = findScript(scriptId);
  if (!script) {
    return;
  }
  const worldPt = clientToWorld(event.clientX, event.clientY);
  const marks = marksForScript(script);
  const hit = hitMark(marks, worldPt.y - script.y);
  const svg = scriptSvg(scriptId);
  if (!hit) {
    clearHover(scriptId);
    return;
  }
  const key = `${scriptId}:${hit.block.id}`;
  if (hoverKey === key) {
    return;
  }
  hoverKey = key;
  paintHover(svg, hit, marks);
}

function mutateSelected(delta: number): void {
  const root = selectedRoot();
  if (!root) {
    return;
  }
  applyMutation({
    id: root.id,
    extraArgsCount: isCall(root) ? Math.max(0, (root.extraArgs?.length ?? 0) + delta) : root.extraArgs?.length,
    params: isFnSig(root)
      ? delta > 0
        ? [...(root.params ?? []), { type: "int", name: `arg${(root.params?.length ?? 0) + 1}` }]
        : (root.params ?? []).slice(0, -1)
      : root.params,
  });
}

function typeNamed(name: string): Block {
  const def = CATALOG_BY_OPCODE.get("type.named")!;
  const block = prototypeFromDef(def);
  block.fields.name = name || "int";
  return block;
}

function applyMutation(m: InspectorMutation): void {
  if (!program) {
    return;
  }
  const block = findInProgram(program, m.id);
  if (!block) {
    return;
  }
  if (m.fields) {
    Object.assign(block.fields, m.fields);
  }
  if (m.params) {
    block.params = m.params;
    m.params.forEach((p, i) => {
      block.fields[`p${i}`] = p.name;
      const existing = block.values[`t${i}`];
      if (!existing || isLiteral(existing) || existing.opcode === "type.named" || existing.opcode === "type.custom") {
        block.values[`t${i}`] = typeNamed(p.type || "int");
      }
    });
    for (const key of Object.keys(block.values)) {
      const match = /^t(\d+)$/.exec(key);
      if (match && Number(match[1]) >= m.params.length) {
        delete block.values[key];
        delete block.fields[`p${match[1]}`];
      }
    }
  }
  if (m.slotText) {
    for (const [slot, text] of Object.entries(m.slotText)) {
      const cur = block.values[slot];
      if (cur && !isLiteral(cur) && (cur.opcode === "type.named" || cur.opcode === "type.custom")) {
        cur.fields.name = text;
      } else {
        block.values[slot] = typeNamed(text);
      }
      if (slot === "ret") {
        block.fields.returnType = text;
      }
      if (slot === "type") {
        block.fields.type = text;
      }
    }
  }
  if (m.extraArgsCount !== undefined) {
    block.extraArgs = block.extraArgs ?? [];
    while (block.extraArgs.length < m.extraArgsCount) {
      block.extraArgs.push(litEmpty());
    }
    while (block.extraArgs.length > m.extraArgsCount) {
      block.extraArgs.pop();
    }
  }
  if (isFnSig(block)) {
    rebuildHat(block);
  }
  if (isCall(block)) {
    if (block.opcode === "ops.chain") {
      rebuildChain(block);
    } else {
      rebuildCall(block);
    }
  }
  if (block.opcode === "control.forRange") {
    rebuildForRange(block);
  }
  if (block.opcode === "ops.lambda" || block.opcode === "ops.lambdaBlock") {
    rebuildLambda(block);
  }
  selectedBlockId = block.id;
  commit();
}

function startBlockDrag(event: PointerEvent, scriptId: string): void {
  event.stopPropagation();
  event.preventDefault();
  const script = findScript(scriptId);
  if (!script || !program) {
    return;
  }
  const worldPt = clientToWorld(event.clientX, event.clientY);
  const hit = hitMark(marksForScript(script), worldPt.y - script.y);
  const origin = hit?.block ?? script.root;
  selectedId = scriptId;
  selectedBlockId = origin.id;
  updateMutator();
  paintSelection();
  publishSelection();

  let dragScript = script;
  let split = false;
  let moved = false;
  const startX = script.x;
  const startY = script.y;
  const px = event.clientX;
  const py = event.clientY;
  dragging = true;
  clearHover();

  const move = (ev: PointerEvent) => {
    const dist = Math.hypot(ev.clientX - px, ev.clientY - py);
    if (dist < 8) {
      return;
    }
    if (!moved) {
      clearAllGlows(world);
    }
    moved = true;
    if (!split && origin !== script.root) {
      unlink(script.root, origin);
      const placed = clientToWorld(ev.clientX, ev.clientY);
      dragScript = { id: createIdFactory("s")(), x: placed.x, y: placed.y, root: origin, gapBefore: 1 };
      program!.sprites[0].scripts.push(dragScript);
      selectedId = dragScript.id;
      selectedBlockId = origin.id;
      split = true;
      renderScripts();
    }
    const pt = clientToWorld(ev.clientX, ev.clientY);
    const el = world.querySelector(`.script[data-id="${dragScript.id}"]`) as HTMLElement | null;
    if (!el) {
      return;
    }
    el.classList.add("dragging");
    if (split || origin === script.root) {
      dragScript.x = split ? pt.x : startX + (ev.clientX - px) / zoom;
      dragScript.y = split ? pt.y : startY + (ev.clientY - py) / zoom;
    }
    el.style.left = `${dragScript.x}px`;
    el.style.top = `${dragScript.y}px`;
    showSnap(dragScript);
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    dragging = false;
    const el = world.querySelector(`.script[data-id="${dragScript.id}"]`) as HTMLElement | null;
    el?.classList.remove("dragging");
    const snap = findMouthSnap(dragScript);
    hideSnap();
    if (!moved) {
      paintSelection();
      return;
    }
    if (isReporterish(dragScript.root)) {
      const over = scriptAt(clientToWorld(ev.clientX, ev.clientY), dragScript.id);
      if (over && plugInto(over, dragScript.root, ev)) {
        program!.sprites[0].scripts = program!.sprites[0].scripts.filter((s) => s.id !== dragScript.id);
        commit();
        return;
      }
    }
    if (snap && !isReporterish(dragScript.root)) {
      snap.apply(dragScript);
      return;
    }
    enforceMinGaps();
    commit();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function scriptAt(worldPt: { x: number; y: number }, exclude?: string): Script | undefined {
  if (!program) {
    return undefined;
  }
  for (const script of program.sprites[0].scripts) {
    if (script.id === exclude) {
      continue;
    }
    const el = world.querySelector(`.script[data-id="${script.id}"]`) as HTMLElement | null;
    if (!el) {
      continue;
    }
    if (worldPt.x >= script.x && worldPt.x <= script.x + el.offsetWidth && worldPt.y >= script.y && worldPt.y <= script.y + el.offsetHeight) {
      return script;
    }
  }
  return undefined;
}

function bestSlot(target: Block, incoming: Block): string | undefined {
  const keys = Object.keys(target.values);
  if (incoming.opcode.startsWith("type.")) {
    const prefer = ["type", "ret", "targ", "inner", "base", "arg", ...keys.filter((k) => /^t\d+$/.test(k))];
    for (const k of prefer) {
      if (k in target.values || k === "type" || k === "ret") {
        if (!(k in target.values)) {
          return k;
        }
        return k;
      }
    }
  }
  if (incoming.shape === "boolean" && "condition" in target.values) {
    return "condition";
  }
  const empty = keys.find((k) => {
    const v = target.values[k];
    return !v || (isLiteral(v) && v.kind === "empty");
  });
  return empty ?? keys[0];
}

function plugInto(host: Script, incoming: Block, ev: PointerEvent): boolean {
  const worldPt = clientToWorld(ev.clientX, ev.clientY);
  const hit = hitMark(marksForScript(host), worldPt.y - host.y);
  const target = hit?.block ?? host.root;
  const slot = bestSlot(target, incoming);
  if (!slot) {
    return false;
  }
  target.values[slot] = incoming;
  if (slot === "ret" && incoming.opcode.startsWith("type.")) {
    target.fields.returnType = incoming.fields.name || target.fields.returnType;
  }
  return true;
}

function insertBlockAt(proto: Block, x: number, y: number): void {
  if (!program) {
    return;
  }
  if (!program.sprites[0]) {
    program.sprites.push({ name: program.fileName || "file", scripts: [] });
  }
  const root = cloneBlock(proto);
  const dummy: Script = { id: "drop", x, y, root };
  const over = scriptAt({ x, y });
  if (over && isReporterish(root)) {
    const fake = { clientX: 0, clientY: 0 } as PointerEvent;
    dummy.x = x;
    dummy.y = y;
    const worldPt = { x, y };
    const hit = hitMark(marksForScript(over), worldPt.y - over.y);
    const target = hit?.block ?? over.root;
    const slot = bestSlot(target, root);
    if (slot) {
      target.values[slot] = root;
      commit();
      return;
    }
    void fake;
  }
  dummy.id = createIdFactory("s")();
  dummy.gapBefore = 1;
  program.sprites[0].scripts.push(dummy);
  const snap = findMouthSnap(dummy);
  if (snap && !isReporterish(root)) {
    snap.apply(dummy);
    return;
  }
  selectedId = dummy.id;
  selectedBlockId = root.id;
  enforceMinGaps();
  commit();
}

function insertBlock(proto: Block): void {
  if (!program) {
    return;
  }
  if (!program.sprites[0]) {
    program.sprites.push({ name: program.fileName || "file", scripts: [] });
  }
  const root = cloneBlock(proto);
  const sprite = program.sprites[0];
  if (root.opcode === "c.include") {
    const pile = sprite.scripts.find((s) => s.root.opcode === "c.include" || chainHas(s.root, "c.include"));
    if (pile && root.shape !== "hat") {
      lastBlock(pile.root).next = root;
      commit();
      return;
    }
  }
  if (root.shape !== "hat" && !isReporterish(root) && selectedId) {
    const selected = findScript(selectedId);
    if (selected && lastBlock(selected.root).shape !== "cap") {
      lastBlock(selected.root).next = root;
      commit();
      return;
    }
  }
  let y = 12;
  for (const existing of sprite.scripts) {
    const el = world.querySelector(`.script[data-id="${existing.id}"]`) as HTMLElement | null;
    y = Math.max(y, existing.y + (el?.offsetHeight ?? 72) + 18);
  }
  sprite.scripts.push({ id: createIdFactory("s")(), x: 12, y, root });
  commit();
}

function chainHas(block: Block, opcode: string): boolean {
  let current: Block | undefined = block;
  while (current) {
    if (current.opcode === opcode) {
      return true;
    }
    current = current.next;
  }
  return false;
}

interface MouthSnap {
  x: number;
  y: number;
  w: number;
  apply: (dragged: Script) => void;
}

function takeDragged(dragged: Script): Block | undefined {
  if (!program) {
    return undefined;
  }
  program.sprites[0].scripts = program.sprites[0].scripts.filter((s) => s.id !== dragged.id);
  return dragged.root;
}

function findMouthSnap(moving: Script): MouthSnap | undefined {
  if (!program || moving.root.shape === "hat" || isReporterish(moving.root)) {
    return undefined;
  }
  const movingEl = world.querySelector(`.script[data-id="${moving.id}"]`) as HTMLElement | null;
  const mw = movingEl?.offsetWidth ?? 160;
  let best: { snap: MouthSnap; dist: number } | undefined;
  const consider = (dist: number, snap: MouthSnap): void => {
    if (dist > SNAP) {
      return;
    }
    if (!best || dist < best.dist) {
      best = { snap, dist };
    }
  };
  const indent = 16 * SCALE;
  for (const other of program.sprites[0].scripts) {
    if (other.id === moving.id) {
      continue;
    }
    const marks = marksForScript(other);
    for (const mark of marks) {
      if (mark.block.shape !== "c" && mark.block.shape !== "c2") {
        continue;
      }
      if (findBlock(moving.root, mark.block.id)) {
        continue;
      }
      const host = mark.block;
      const mouthX = other.x + indent;
      const slots: Array<{ slot: string; top: number }> = [{ slot: "body", top: other.y + mark.y + mark.headerH }];
      if (mark.block.shape === "c2") {
        slots.push({ slot: "else", top: other.y + mark.y + mark.h * 0.55 });
      }
      for (const { slot, top } of slots) {
        const w = Math.max(72, mw * 0.7);
        consider(Math.hypot(moving.x - mouthX, moving.y - top), {
          x: mouthX,
          y: top - 4,
          w,
          apply: (dragged) => {
            const root = takeDragged(dragged);
            if (!root) {
              return;
            }
            const tail = lastBlock(root);
            tail.next = host.branches[slot];
            host.branches[slot] = root;
            commit();
          },
        });
        let inner: Block | undefined = host.branches[slot];
        while (inner) {
          const im = marks.find((m) => m.block.id === inner!.id);
          if (im && inner.shape !== "cap") {
            const ay = other.y + im.y + im.h - 6;
            const block = inner;
            consider(Math.hypot(moving.x - mouthX, moving.y - ay), {
              x: mouthX,
              y: ay,
              w,
              apply: (dragged) => {
                const root = takeDragged(dragged);
                if (!root) {
                  return;
                }
                const tail = lastBlock(root);
                tail.next = block.next;
                block.next = root;
                commit();
              },
            });
          }
          inner = inner.next;
        }
      }
    }
  }
  return best?.snap;
}

function showSnap(moving: Script): void {
  const notch = document.getElementById("snapNotch") as SVGSVGElement | null;
  const snap = findMouthSnap(moving);
  if (!snap || !notch || isReporterish(moving.root)) {
    hideSnap();
    return;
  }
  const w = snap.w;
  notch.setAttribute("width", String(w));
  notch.setAttribute("height", "16");
  notch.style.left = `${snap.x * zoom}px`;
  notch.style.top = `${snap.y * zoom}px`;
  notch.innerHTML = `<path d="M0 4 H12 C16 4 16 12 22 12 H36 C42 12 42 4 48 4 H${w}" fill="none" stroke="#fff04d" stroke-width="3" stroke-linecap="round"/>`;
  notch.classList.add("show");
  guide.classList.remove("show");
}

function hideSnap(): void {
  guide.classList.remove("show");
  document.getElementById("snapNotch")?.classList.remove("show");
}

function editScript(scriptId: string): void {
  const script = findScript(scriptId);
  if (!script) {
    return;
  }
  const field = firstEditableField(script.root);
  if (field) {
    const next = window.prompt(`Edit ${field.key}`, field.block.fields[field.key] ?? "");
    if (next === null) {
      return;
    }
    field.block.fields[field.key] = next;
    if (isFnSig(field.block)) {
      rebuildHat(field.block);
    }
    if (isCall(field.block)) {
      rebuildCall(field.block);
    }
    commit();
    return;
  }
  const found = firstLiteral(script.root);
  if (!found) {
    return;
  }
  const current = found.lit.kind === "empty" ? "" : found.lit.value;
  const next = window.prompt("Edit value", current);
  if (next === null) {
    return;
  }
  if (found.lit.kind === "number" || /^\d+(\.\d+)?$/.test(next)) {
    found.lit.kind = "number";
    found.lit.value = next;
  } else {
    found.lit.kind = "string";
    found.lit.value = next;
  }
  commit();
}

function firstEditableField(block: Block): { block: Block; key: string } | undefined {
  const keys = ["name", "var", "field", "header", "label"];
  let current: Block | undefined = block;
  while (current) {
    for (const key of keys) {
      if (current.fields[key]) {
        return { block: current, key };
      }
    }
    current = current.next;
  }
  return undefined;
}

function firstLiteral(block: Block): { lit: Literal } | undefined {
  let current: Block | undefined = block;
  while (current) {
    for (const v of Object.values(current.values)) {
      if (isLiteral(v) && v.kind !== "empty") {
        return { lit: v };
      }
      if (v && !isLiteral(v)) {
        const nested = firstLiteral(v);
        if (nested) {
          return nested;
        }
      }
    }
    current = current.next;
  }
  return undefined;
}

function commit(): void {
  if (!program) {
    return;
  }
  recomputeStats(program);
  renderAll();
  publishSelection();
  post({ type: "programChanged", program });
}

async function exportPng(): Promise<void> {
  const scripts = [...world.querySelectorAll(".script")] as HTMLElement[];
  if (!scripts.length) {
    return;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = 0;
  let maxY = 0;
  for (const el of scripts) {
    const x = parseFloat(el.style.left);
    const y = parseFloat(el.style.top);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + el.offsetWidth);
    maxY = Math.max(maxY, y + el.offsetHeight);
  }
  const pad = 32;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(maxX - minX + pad * 2));
  canvas.height = Math.max(1, Math.ceil(maxY - minY + pad * 2));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#e9f1fc";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const cssText = [...document.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n");
  for (const el of scripts) {
    const svg = el.querySelector("svg");
    if (!svg) {
      continue;
    }
    const clone = svg.cloneNode(true) as SVGElement;
    const styleEl = document.createElementNS("http://www.w3.org/2000/svg", "style");
    styleEl.textContent = cssText;
    clone.insertBefore(styleEl, clone.firstChild);
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
    const img = await loadImage(url);
    ctx.drawImage(img, parseFloat(el.style.left) - minX + pad, parseFloat(el.style.top) - minY + pad);
    URL.revokeObjectURL(url);
  }
  post({ type: "exportPng", dataUrl: canvas.toDataURL("image/png") });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image"));
    img.src = url;
  });
}

void renderBlockSvg;
void findBlock;
