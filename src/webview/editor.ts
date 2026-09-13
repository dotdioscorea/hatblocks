import css from "./editor.css";
import { emitProgram } from "../emit/scratchblocks";
import { cloneBlock, lastBlock } from "../ir/clone";
import { createIdFactory, recomputeStats } from "../ir/ids";
import { isLiteral } from "../ir/builders";
import type { Block, Literal, Program, Script } from "../ir/types";
import type { EditorToHost, HostToEditor } from "../protocol";
import { renderCodeSvg, renderBlockSvg, ensureScratchStyles } from "./render";

const vscode = acquireVsCodeApi();
const SCALE = 0.72;
const SNAP = 22;

let program: Program | undefined;
let selectedId: string | undefined;
let panX = 16;
let panY = 16;
let zoom = 1;

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
    </div>
    <div class="hud">
      <button class="flag" id="run" title="Green flag — compile and run">
        <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <rect x="2" y="3" width="2.2" height="13" rx="0.6" fill="#fff"/>
          <path d="M4.2 3.2h9.2l-2.4 3.2 2.4 3.2H4.2V3.2z" fill="#fff"/>
        </svg>
      </button>
      <div class="stats" id="stats"></div>
    </div>
    <div class="hint">Scratch blocks on a VS Code editor. Sidebar is the parts palette. Double-click a value to edit.</div>
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
    program = msg.program;
    selectedId = undefined;
    packOnce = true;
    renderAll();
  }
  if (msg.type === "insert") {
    insertBlock(msg.block);
  }
  if (msg.type === "requestExport") {
    void exportPng();
  }
});

$("run").addEventListener("click", () => post({ type: "run" }));

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
  if ((event.key === "Backspace" || event.key === "Delete") && selectedId && program) {
    const sprite = program.sprites[0];
    sprite.scripts = sprite.scripts.filter((s) => s.id !== selectedId);
    selectedId = undefined;
    commit();
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
  renderScripts();
  if (packOnce) {
    packOnce = false;
    packVertically();
    renderScripts();
  }
  applyPan();
}

function packVertically(): void {
  if (!program) {
    return;
  }
  let y = 12;
  for (const script of program.sprites[0].scripts) {
    const el = world.querySelector(`.script[data-id="${script.id}"]`) as HTMLElement | null;
    script.x = 12;
    script.y = y;
    y += (el?.offsetHeight ?? 72) + 18;
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
    el.className = `script${script.id === selectedId ? " selected" : ""}`;
    el.dataset.id = script.id;
    el.style.left = `${script.x}px`;
    el.style.top = `${script.y}px`;
    el.appendChild(renderCodeSvg(script.code, SCALE));
    el.addEventListener("pointerdown", (event) => startScriptDrag(event, script.id));
    el.addEventListener("dblclick", (event) => {
      event.preventDefault();
      editScript(script.id);
    });
    world.appendChild(el);
  }
  renderGutter();
}

function renderGutter(): void {
  if (!program) {
    gutter.innerHTML = "";
    return;
  }
  gutter.innerHTML = "";
  for (const script of program.sprites[0].scripts) {
    const el = world.querySelector(`.script[data-id="${script.id}"]`) as HTMLElement | null;
    const line = script.root.source ? script.root.source.start.line + 1 : undefined;
    const n = document.createElement("div");
    n.className = `ln${script.id === selectedId ? " active" : ""}${line === undefined ? " empty" : ""}`;
    n.textContent = line !== undefined ? String(line) : "·";
    n.title = line !== undefined ? `Line ${line}` : "Not in source yet";
    const top = panY + script.y * zoom;
    n.style.top = `${top}px`;
    n.style.height = `${Math.max(18, (el?.offsetHeight ?? 24) * zoom)}px`;
    n.style.paddingTop = `${Math.max(0, 4 * zoom)}px`;
    gutter.appendChild(n);
  }
}

function findScript(id: string): Script | undefined {
  return program?.sprites[0]?.scripts.find((s) => s.id === id);
}

function startScriptDrag(event: PointerEvent, id: string): void {
  event.stopPropagation();
  event.preventDefault();
  selectedId = id;
  const script = findScript(id);
  if (!script || !program) {
    return;
  }
  const el = event.currentTarget as HTMLElement;
  el.classList.add("dragging", "selected");
  const startX = script.x;
  const startY = script.y;
  const px = event.clientX;
  const py = event.clientY;
  el.setPointerCapture(event.pointerId);
  const move = (ev: PointerEvent) => {
    script.x = startX + (ev.clientX - px) / zoom;
    script.y = startY + (ev.clientY - py) / zoom;
    el.style.left = `${script.x}px`;
    el.style.top = `${script.y}px`;
    showSnap(script);
    renderGutter();
  };
  const up = () => {
    el.classList.remove("dragging");
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    const target = snapTarget(script);
    hideSnap();
    if (target) {
      attach(target, script);
    } else {
      renderScripts();
      applyPan();
    }
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
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
  if (root.shape !== "hat" && selectedId) {
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

function attach(target: Script, dragged: Script): void {
  if (!program || target.id === dragged.id) {
    return;
  }
  if (dragged.root.shape === "hat") {
    return;
  }
  const last = lastBlock(target.root);
  if (last.shape === "cap") {
    return;
  }
  last.next = dragged.root;
  program.sprites[0].scripts = program.sprites[0].scripts.filter((s) => s.id !== dragged.id);
  commit();
}

function snapTarget(moving: Script): Script | undefined {
  if (!program || moving.root.shape === "hat") {
    return undefined;
  }
  const movingEl = world.querySelector(`.script[data-id="${moving.id}"]`) as HTMLElement | null;
  const mw = movingEl?.offsetWidth ?? 120;
  for (const other of program.sprites[0].scripts) {
    if (other.id === moving.id) {
      continue;
    }
    const last = lastBlock(other.root);
    if (last.shape === "cap") {
      continue;
    }
    const el = world.querySelector(`.script[data-id="${other.id}"]`) as HTMLElement | null;
    if (!el) {
      continue;
    }
    const bottomX = other.x + 16;
    const bottomY = other.y + el.offsetHeight - 4;
    if (Math.hypot(moving.x - bottomX, moving.y - bottomY) < SNAP && moving.x < other.x + Math.max(el.offsetWidth, mw)) {
      return other;
    }
  }
  return undefined;
}

function showSnap(moving: Script): void {
  const target = snapTarget(moving);
  if (!target) {
    hideSnap();
    return;
  }
  const el = world.querySelector(`.script[data-id="${target.id}"]`) as HTMLElement | null;
  if (!el) {
    return;
  }
  guide.classList.add("show");
  guide.style.left = `${target.x}px`;
  guide.style.top = `${target.y + el.offsetHeight - 4}px`;
  guide.style.width = `${Math.max(80, el.offsetWidth * 0.7)}px`;
}

function hideSnap(): void {
  guide.classList.remove("show");
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
  const keys = ["header", "var", "name", "msg", "label", "what"];
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
