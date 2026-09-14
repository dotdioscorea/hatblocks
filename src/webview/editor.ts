import css from "./editor.css";
import { emitProgram } from "../emit/scratchblocks";
import { cloneBlock, lastBlock } from "../ir/clone";
import { createIdFactory, recomputeStats } from "../ir/ids";
import { isLiteral, litEmpty } from "../ir/builders";
import { rebuildHat, rebuildCall, C_TYPES, PY_TYPES } from "../library/hats";
import { findBlock, unlink } from "../ir/tree";
import type { Block, Literal, Program, Script } from "../ir/types";
import type { EditorToHost, HostToEditor } from "../protocol";
import { renderCodeSvg, renderBlockSvg, ensureScratchStyles } from "./render";
import { layoutMarks, hitMark, scaleMarks, type Mark } from "./layout";

const vscode = acquireVsCodeApi();
const SCALE = 0.72;
const SNAP = 22;

let program: Program | undefined;
let selectedId: string | undefined;
let selectedBlockId: string | undefined;
let panX = 16;
let panY = 16;
let zoom = 1;
let libraryProto: Block | undefined;

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
      <div class="mutator" id="mutator">
        <span class="label" id="mutatorLabel"></span>
        <button type="button" id="addArg">+ arg</button>
        <button type="button" id="delArg">− arg</button>
      </div>
    </div>
    <div class="hint">Drag a block to tear it off. Snap to the glowing notch. Library parts drag in from the sidebar.</div>
    <svg class="snap-notch" id="snapNotch" width="200" height="20"></svg>
  </div>
  <aside class="inspector" id="inspector">
    <h3>Inspector</h3>
    <div id="inspectorBody"><p class="muted">Select a block.</p></div>
  </aside>
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
    selectedBlockId = undefined;
    packOnce = true;
    renderAll();
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
  updateMutator();
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
  const scripts = [...program.sprites[0].scripts].sort((a, b) => {
    const la = a.root.source?.start.line ?? 1e9;
    const lb = b.root.source?.start.line ?? 1e9;
    return la - lb;
  });
  program.sprites[0].scripts = scripts;
  for (const script of scripts) {
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
    el.addEventListener("pointerdown", (event) => startBlockDrag(event, script.id));
    el.addEventListener("dblclick", (event) => {
      event.preventDefault();
      editScript(script.id);
    });
    world.appendChild(el);
  }
  renderGutter();
}

function marksForScript(script: Script): Mark[] {
  const laid = layoutMarks(script.root, 0);
  const el = world.querySelector(`.script[data-id="${script.id}"]`) as HTMLElement | null;
  const svgH = el?.offsetHeight ?? laid.height;
  return scaleMarks(laid.marks, laid.height, svgH);
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
      n.style.height = `${Math.max(14, mark.h * zoom)}px`;
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
  if (!selectedId) {
    return undefined;
  }
  const script = findScript(selectedId);
  if (!script) {
    return undefined;
  }
  if (selectedBlockId) {
    return findBlock(script.root, selectedBlockId) ?? script.root;
  }
  return script.root;
}

function isHat(block: Block): boolean {
  return block.opcode === "events.flag" || block.opcode === "custom.define";
}

function isCall(block: Block): boolean {
  return block.opcode === "custom.call" || block.opcode === "custom.reporter" || block.opcode === "looks.printf";
}

function updateMutator(): void {
  const bar = $("mutator");
  const label = $("mutatorLabel");
  const root = selectedRoot();
  if (!root || (!isHat(root) && !isCall(root))) {
    bar.classList.remove("show");
    renderInspector();
    return;
  }
  bar.classList.add("show");
  if (isHat(root)) {
    const n = root.params?.length ?? 0;
    label.textContent = n === 1 ? "1 parameter" : `${n} parameters`;
  } else {
    const n = root.extraArgs?.length ?? 0;
    label.textContent = n === 1 ? "1 argument" : `${n} arguments`;
  }
  renderInspector();
}

function typeOptions(current: string): string {
  const types = program?.language === "python" ? PY_TYPES.filter(Boolean) : C_TYPES;
  const all = types.includes(current) ? types : [current, ...types];
  return all.map((t) => `<option value="${escapeAttr(t)}"${t === current ? " selected" : ""}>${escapeAttr(t)}</option>`).join("");
}

function escapeAttr(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}

function renderInspector(): void {
  const body = document.getElementById("inspectorBody");
  if (!body) {
    return;
  }
  const block = selectedRoot();
  if (!block) {
    body.innerHTML = `<p class="muted">Select a block.</p>`;
    return;
  }
  const bits: string[] = [`<p><b>${escapeAttr(block.opcode)}</b></p>`];
  if (block.source) {
    bits.push(`<p class="muted">Line ${block.source.start.line + 1}</p>`);
  }
  if (isHat(block) || block.opcode === "py.class") {
    bits.push(`<label>Return / kind</label><select id="inspRet">${typeOptions(block.fields.returnType || block.fields.type || "int")}</select>`);
    bits.push(`<label>Name</label><input id="inspName" value="${escapeAttr(block.fields.name || "")}" />`);
    bits.push(`<label>Parameters</label>`);
    for (const [i, p] of (block.params ?? []).entries()) {
      bits.push(`<div class="row"><select data-pi="${i}">${typeOptions(p.type)}</select><input data-pn="${i}" value="${escapeAttr(p.name)}" /></div>`);
    }
    bits.push(`<button type="button" id="inspAdd">+ parameter</button>`);
  } else if (isCall(block)) {
    bits.push(`<label>Callee</label><input id="inspName" value="${escapeAttr(block.fields.name || "")}" />`);
    bits.push(`<p class="muted">${block.extraArgs?.length ?? 0} argument slots</p>`);
    bits.push(`<button type="button" id="inspAdd">+ argument</button> <button type="button" id="inspDel">− argument</button>`);
  } else if (block.fields.type || block.fields.var || block.fields.header) {
    if (block.fields.type) {
      bits.push(`<label>Type</label><select id="inspRet">${typeOptions(block.fields.type)}</select>`);
    }
    if (block.fields.var) {
      bits.push(`<label>Name</label><input id="inspName" value="${escapeAttr(block.fields.var)}" />`);
    }
    if (block.fields.header) {
      bits.push(`<label>Header</label><input id="inspName" value="${escapeAttr(block.fields.header)}" />`);
    }
  } else {
    bits.push(`<p class="muted">This block has no extra controls. Drag to detach. Snap to join.</p>`);
  }
  body.innerHTML = bits.join("");
  body.querySelector("#inspRet")?.addEventListener("change", (e) => {
    const v = (e.target as HTMLSelectElement).value;
    if (isHat(block)) {
      block.fields.returnType = v;
      rebuildHat(block);
    } else if (block.fields.type !== undefined) {
      block.fields.type = v;
    }
    commit();
  });
  body.querySelector("#inspName")?.addEventListener("change", (e) => {
    const v = (e.target as HTMLInputElement).value;
    if (isHat(block) || isCall(block)) {
      block.fields.name = v;
      if (isHat(block)) {
        rebuildHat(block);
      } else {
        rebuildCall(block);
      }
    } else if (block.fields.var !== undefined) {
      block.fields.var = v;
    } else if (block.fields.header !== undefined) {
      block.fields.header = v;
    }
    commit();
  });
  body.querySelectorAll("select[data-pi]").forEach((el) => {
    el.addEventListener("change", (e) => {
      const i = Number((e.target as HTMLSelectElement).dataset.pi);
      if (block.params?.[i]) {
        block.params[i].type = (e.target as HTMLSelectElement).value;
        rebuildHat(block);
        commit();
      }
    });
  });
  body.querySelectorAll("input[data-pn]").forEach((el) => {
    el.addEventListener("change", (e) => {
      const i = Number((e.target as HTMLInputElement).dataset.pn);
      if (block.params?.[i]) {
        block.params[i].name = (e.target as HTMLInputElement).value;
        rebuildHat(block);
        commit();
      }
    });
  });
  body.querySelector("#inspAdd")?.addEventListener("click", () => mutateSelected(1));
  body.querySelector("#inspDel")?.addEventListener("click", () => mutateSelected(-1));
}

function mutateSelected(delta: number): void {
  const root = selectedRoot();
  if (!root) {
    return;
  }
  if (isHat(root)) {
    root.params = root.params ?? [];
    if (delta > 0) {
      const n = root.params.length + 1;
      const type = window.prompt("Parameter type", root.params.at(-1)?.type || "int");
      if (type === null) {
        return;
      }
      const name = window.prompt("Parameter name", `arg${n}`);
      if (name === null) {
        return;
      }
      root.params.push({ type: type.trim() || "int", name: name.trim() || `arg${n}` });
    } else if (root.params.length) {
      root.params.pop();
    }
    rebuildHat(root);
    commit();
    return;
  }
  if (isCall(root)) {
    root.extraArgs = root.extraArgs ?? [];
    if (delta > 0) {
      root.extraArgs.push(litEmpty());
    } else if (root.extraArgs.length) {
      root.extraArgs.pop();
    }
    rebuildCall(root);
    commit();
  }
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
  renderInspector();

  let dragScript = script;
  let split = false;
  const startX = script.x;
  const startY = script.y;
  const px = event.clientX;
  const py = event.clientY;
  const host = event.currentTarget as HTMLElement;
  host.setPointerCapture(event.pointerId);

  const move = (ev: PointerEvent) => {
    const dist = Math.hypot(ev.clientX - px, ev.clientY - py);
    if (!split && dist > 8 && origin !== script.root) {
      unlink(script.root, origin);
      const placed = clientToWorld(ev.clientX, ev.clientY);
      dragScript = { id: createIdFactory("s")(), x: placed.x, y: placed.y, root: origin };
      program!.sprites[0].scripts.push(dragScript);
      selectedId = dragScript.id;
      selectedBlockId = origin.id;
      split = true;
      renderScripts();
      updateMutator();
      renderInspector();
    }
    const el = world.querySelector(`.script[data-id="${dragScript.id}"]`) as HTMLElement | null;
    if (!el) {
      return;
    }
    el.classList.add("dragging", "selected");
    if (split) {
      const pt = clientToWorld(ev.clientX, ev.clientY);
      dragScript.x = pt.x;
      dragScript.y = pt.y;
    } else {
      dragScript.x = startX + (ev.clientX - px) / zoom;
      dragScript.y = startY + (ev.clientY - py) / zoom;
    }
    const snap = snapTarget(dragScript);
    if (snap) {
      const tEl = world.querySelector(`.script[data-id="${snap.id}"]`) as HTMLElement | null;
      if (tEl) {
        dragScript.x = snap.x;
        dragScript.y = snap.y + tEl.offsetHeight - 10;
      }
    }
    el.style.left = `${dragScript.x}px`;
    el.style.top = `${dragScript.y}px`;
    showSnap(dragScript);
    renderGutter();
  };
  const up = () => {
    host.removeEventListener("pointermove", move);
    host.removeEventListener("pointerup", up);
    const el = world.querySelector(`.script[data-id="${dragScript.id}"]`) as HTMLElement | null;
    el?.classList.remove("dragging");
    const target = snapTarget(dragScript);
    hideSnap();
    if (target) {
      attach(target, dragScript);
    } else if (split) {
      commit();
    } else {
      renderScripts();
      applyPan();
    }
  };
  host.addEventListener("pointermove", move);
  host.addEventListener("pointerup", up);
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
  const target = snapTarget(dummy);
  if (target && root.shape !== "hat") {
    lastBlock(target.root).next = root;
    commit();
    return;
  }
  program.sprites[0].scripts.push({ id: createIdFactory("s")(), x, y, root });
  selectedId = program.sprites[0].scripts.at(-1)!.id;
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
  const notch = document.getElementById("snapNotch") as SVGSVGElement | null;
  const target = snapTarget(moving);
  if (!target || !notch) {
    hideSnap();
    return;
  }
  const el = world.querySelector(`.script[data-id="${target.id}"]`) as HTMLElement | null;
  if (!el) {
    hideSnap();
    return;
  }
  const w = Math.max(80, el.offsetWidth * 0.85);
  const x = panX + target.x * zoom;
  const y = panY + (target.y + el.offsetHeight - 6) * zoom;
  notch.setAttribute("width", String(w));
  notch.setAttribute("height", "16");
  notch.style.left = `${x}px`;
  notch.style.top = `${y}px`;
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
    if (field.key === "returnType" || field.key === "name" || field.block.params) {
      rebuildHat(field.block);
    }
    if (field.key === "type" && field.block.opcode === "data.set") {
      field.block.line = `[${next} v] ${field.block.fields.var ?? "x"} = {value} :: variables`;
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
  const keys = ["returnType", "type", "header", "var", "name", "msg", "label", "what"];
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
