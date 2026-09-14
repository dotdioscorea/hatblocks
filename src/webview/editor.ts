import css from "./editor.css";
import { emitProgram } from "../emit/scratchblocks";
import { cloneBlock, lastBlock } from "../ir/clone";
import { createIdFactory, recomputeStats } from "../ir/ids";
import { isLiteral, litEmpty } from "../ir/builders";
import { rebuildHat, rebuildCall, rebuildForRange, rebuildLambda } from "../library/hats";
import { CATALOG_BY_OPCODE, prototypeFromDef } from "../library/catalog";
import { findBlock, findInProgram, unlink } from "../ir/tree";
import type { Block, Literal, Program, Script } from "../ir/types";
import type { EditorToHost, HostToEditor, InspectorMutation } from "../protocol";
import { renderCodeSvg, renderBlockSvg, ensureScratchStyles } from "./render";
import { hitMark, marksFromSvg, type Mark } from "./layout";
import { clearHoverGlows, paintHover, paintSelect } from "./highlight";

const vscode = acquireVsCodeApi();
const SCALE = 0.72;
const COLUMN_X = 12;
const GAP = 18;

let program: Program | undefined;
let selectedId: string | undefined;
let selectedBlockId: string | undefined;
let panX = 16;
let panY = 16;
let zoom = 1;
let libraryProto: Block | undefined;
let dragging = false;
let hoverKey = "";
const marksCache = new WeakMap<SVGElement, Mark[]>();
let dropKey = "";
let mouthPreview: {
  host: Block;
  slot: string;
  after?: Block;
  inserted: Block;
  tail: Block;
  savedTailNext: Block | undefined;
} | undefined;

const app = document.createElement("div");
app.id = "app";
app.innerHTML = `
  <div class="stage-wrap" id="stageWrap">
    <div class="gutter" id="gutter"></div>
    <div class="canvas">
      <div class="stage" id="stage">
        <div class="world" id="world"></div>
        <div class="snap-guide" id="guide"></div>
      </div>
      <svg class="snap-notch" id="snapNotch" width="200" height="20"></svg>
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
const stageWrap = $("stageWrap");
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

const canvasEl = document.querySelector(".canvas") as HTMLElement;
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
  event.preventDefault();
  const factor = event.deltaY > 0 ? 0.92 : 1.08;
  zoom = Math.min(2.4, Math.max(0.35, zoom * factor));
  applyPan();
}, { passive: false });

let panning: { x: number; y: number; px: number; py: number } | undefined;
stageWrap.addEventListener("pointerdown", (event) => {
  if ((event.target as HTMLElement).closest(".script")) {
    return;
  }
  clearHover();
  panning = { x: panX, y: panY, px: event.clientX, py: event.clientY };
  stageWrap.classList.add("panning");
  stageWrap.setPointerCapture(event.pointerId);
});
stageWrap.addEventListener("pointermove", (event) => {
  if (!panning) {
    return;
  }
  panX = panning.x + (event.clientX - panning.px);
  panY = panning.y + (event.clientY - panning.py);
  applyPan();
});
stageWrap.addEventListener("pointerup", () => {
  panning = undefined;
  stageWrap.classList.remove("panning");
});

window.addEventListener("keydown", (event) => {
  const mod = event.metaKey || event.ctrlKey;
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

function applyPan(): void {
  world.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  renderGutter();
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
  applyPan();
}

function packColumn(): void {
  if (!program) {
    return;
  }
  let y = 12;
  for (const script of program.sprites[0].scripts) {
    script.x = COLUMN_X;
    script.y = y;
    const el = world.querySelector(`.script[data-id="${script.id}"]`) as HTMLElement | null;
    y += (el?.offsetHeight ?? 72) + GAP;
  }
}

function packVertically(): void {
  packColumn();
}

function applyColumnPositions(): void {
  if (!program) {
    return;
  }
  packColumn();
  for (const script of program.sprites[0].scripts) {
    const el = world.querySelector(`.script[data-id="${script.id}"]`) as HTMLElement | null;
    if (!el) {
      continue;
    }
    el.style.left = `${script.x}px`;
    el.style.top = `${script.y}px`;
  }
  renderGutter();
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
      if (dragging) {
        return;
      }
      hoverScript(script.id, event);
    });
    el.addEventListener("pointerleave", () => clearHover(script.id));
    el.addEventListener("dblclick", (event) => {
      event.preventDefault();
      editScript(script.id);
    });
    world.appendChild(el);
  }
  hoverKey = "";
  paintSelection();
  renderGutter();
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
  for (const script of program.sprites[0].scripts) {
    for (const mark of marksForScript(script)) {
      if (mark.line === undefined) {
        continue;
      }
      const n = document.createElement("div");
      n.className = `ln${mark.block.id === selectedBlockId ? " active" : ""}`;
      n.textContent = String(mark.line);
      n.title = `Line ${mark.line}`;
      n.style.top = `${panY + (script.y + mark.y) * zoom}px`;
      n.style.height = `${Math.max(12, (mark.headerH || Math.min(mark.h, 36)) * zoom)}px`;
      n.style.paddingTop = `${Math.max(0, 2 * zoom)}px`;
      gutter.appendChild(n);
    }
  }
}

function clientToWorld(cx: number, cy: number): { x: number; y: number } {
  const canvas = document.querySelector(".canvas")!.getBoundingClientRect();
  return {
    x: (cx - canvas.left - panX) / zoom,
    y: (cy - canvas.top - panY) / zoom,
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
    block.opcode === "py.list" ||
    block.opcode === "py.tuple"
  );
}

function isReporterish(block: Block): boolean {
  return block.shape === "reporter" || block.shape === "boolean";
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

function paintSelection(): void {
  if (!program) {
    return;
  }
  for (const script of program.sprites[0].scripts) {
    const svg = scriptSvg(script.id);
    const mark = selectedBlockId ? marksForScript(script).find((m) => m.block.id === selectedBlockId) : undefined;
    paintSelect(svg, mark?.block.id === selectedBlockId ? mark : undefined);
  }
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
    rebuildCall(block);
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
  const px = event.clientX;
  const py = event.clientY;
  dragging = true;
  dropKey = "";
  mouthPreview = undefined;
  clearHover();

  const move = (ev: PointerEvent) => {
    const dist = Math.hypot(ev.clientX - px, ev.clientY - py);
    if (dist < 8) {
      return;
    }
    if (!split && origin !== script.root) {
      unlink(script.root, origin);
      dragScript = { id: createIdFactory("s")(), x: COLUMN_X, y: script.y, root: origin };
      program!.sprites[0].scripts.push(dragScript);
      selectedId = dragScript.id;
      selectedBlockId = origin.id;
      split = true;
    }
    const pt = clientToWorld(ev.clientX, ev.clientY);
    if (isReporterish(dragScript.root)) {
      dragScript.x = pt.x;
      dragScript.y = pt.y;
      const el = world.querySelector(`.script[data-id="${dragScript.id}"]`) as HTMLElement | null;
      if (el) {
        el.style.left = `${dragScript.x}px`;
        el.style.top = `${dragScript.y}px`;
      }
      return;
    }
    const target = findDrop(pt, dragScript);
    const key = target ? dropTargetKey(target) : "free";
    if (key === dropKey) {
      return;
    }
    dropKey = key;
    applyDropPreview(dragScript, target);
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    dragging = false;
    hideSnap();
    const pt = clientToWorld(ev.clientX, ev.clientY);
    if (isReporterish(dragScript.root)) {
      const over = scriptAt(pt, dragScript.id);
      if (over && plugInto(over, dragScript.root, ev)) {
        program!.sprites[0].scripts = program!.sprites[0].scripts.filter((s) => s.id !== dragScript.id);
        mouthPreview = undefined;
        dropKey = "";
        commit();
        return;
      }
    }
    const didDrag = dropKey !== "";
    mouthPreview = undefined;
    dropKey = "";
    if (didDrag) {
      packColumn();
      commit();
    }
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
  dummy.x = COLUMN_X;
  program.sprites[0].scripts.push(dummy);
  applyDropPreview(dummy, findDrop({ x, y }, dummy));
  selectedId = dummy.id;
  selectedBlockId = root.id;
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

type DropTarget =
  | { kind: "between"; index: number }
  | { kind: "mouth"; host: Block; slot: string; after?: Block };

function dropTargetKey(target: DropTarget): string {
  if (target.kind === "between") {
    return `between:${target.index}`;
  }
  return `mouth:${target.host.id}:${target.slot}:${target.after?.id ?? "head"}`;
}

function restoreMouthPreview(): void {
  if (!mouthPreview) {
    return;
  }
  const { host, slot, after, inserted, tail, savedTailNext } = mouthPreview;
  if (!after) {
    host.branches[slot] = tail.next;
  } else if (after.next === inserted) {
    after.next = tail.next;
  }
  tail.next = savedTailNext;
  mouthPreview = undefined;
}

function ensureDragScript(drag: Script): void {
  if (!program) {
    return;
  }
  if (!program.sprites[0].scripts.some((s) => s.id === drag.id)) {
    program.sprites[0].scripts.push(drag);
  }
}

function applyDropPreview(drag: Script, target: DropTarget | undefined): void {
  if (!program) {
    return;
  }
  restoreMouthPreview();
  ensureDragScript(drag);
  if (!target || target.kind === "between") {
    const list = program.sprites[0].scripts.filter((s) => s.id !== drag.id);
    const index = target?.kind === "between" ? target.index : list.length;
    list.splice(Math.max(0, Math.min(index, list.length)), 0, drag);
    program.sprites[0].scripts = list;
    drag.x = COLUMN_X;
    if (world.querySelector(`.script[data-id="${drag.id}"]`)) {
      applyColumnPositions();
    } else {
      packColumn();
      renderScripts();
    }
    return;
  }
  program.sprites[0].scripts = program.sprites[0].scripts.filter((s) => s.id !== drag.id);
  const tail = lastBlock(drag.root);
  const savedTailNext = tail.next;
  if (!target.after) {
    tail.next = target.host.branches[target.slot];
    target.host.branches[target.slot] = drag.root;
  } else {
    tail.next = target.after.next;
    target.after.next = drag.root;
  }
  mouthPreview = {
    host: target.host,
    slot: target.slot,
    after: target.after,
    inserted: drag.root,
    tail,
    savedTailNext,
  };
  packColumn();
  renderScripts();
}

function findDrop(worldPt: { x: number; y: number }, drag: Script): DropTarget | undefined {
  if (!program || drag.root.shape === "hat" || isReporterish(drag.root)) {
    return undefined;
  }
  const scripts = program.sprites[0].scripts;
  for (const other of scripts) {
    if (other.id === drag.id) {
      continue;
    }
    const marks = marksForScript(other);
    for (const mark of marks) {
      if (mark.block.shape !== "c" && mark.block.shape !== "c2") {
        continue;
      }
      if (findBlock(drag.root, mark.block.id)) {
        continue;
      }
      const relY = worldPt.y - other.y;
      const relX = worldPt.x - other.x;
      if (relY < mark.y - 8 || relY > mark.y + mark.h + 12 || relX < -24 || relX > Math.max(280, mark.h)) {
        continue;
      }
      const slot = mark.block.shape === "c2" && relY > mark.y + mark.h * 0.55 ? "else" : "body";
      let after: Block | undefined;
      let inner: Block | undefined = mark.block.branches[slot];
      while (inner) {
        if (inner === drag.root || findBlock(drag.root, inner.id)) {
          inner = inner.next;
          continue;
        }
        const im = marks.find((m) => m.block.id === inner!.id);
        if (im && relY > other.y + im.y + im.h / 2 - other.y) {
          after = inner;
        }
        inner = inner.next;
      }
      return { kind: "mouth", host: mark.block, slot, after };
    }
  }
  const others = scripts.filter((s) => s.id !== drag.id);
  let index = others.length;
  for (let i = 0; i < others.length; i++) {
    const el = world.querySelector(`.script[data-id="${others[i].id}"]`) as HTMLElement | null;
    const h = el?.offsetHeight ?? 72;
    const mid = others[i].y + h / 2;
    if (worldPt.y < mid) {
      index = i;
      break;
    }
  }
  return { kind: "between", index };
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
