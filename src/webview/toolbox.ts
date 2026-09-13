import css from "./toolbox.css";
import { emitToolboxBlock } from "../emit/scratchblocks";
import type { Block, CategoryId, Program } from "../ir/types";
import type { HostToToolbox, ToolboxToHost } from "../protocol";
import { renderCodeSvg, ensureScratchStyles } from "./render";

const vscode = acquireVsCodeApi();
let program: Program | undefined;
let blocksMode = false;
let active: CategoryId | undefined;

const app = document.createElement("div");
app.id = "app";
app.innerHTML = `
  <div class="header">
    <div class="title">Blocks</div>
    <button class="toggle" id="toggle">Text</button>
  </div>
  <div id="content"></div>
`;
document.body.appendChild(app);
const style = document.createElement("style");
style.textContent = css;
document.head.appendChild(style);
ensureScratchStyles();

const content = document.getElementById("content")!;
const toggle = document.getElementById("toggle") as HTMLButtonElement;

function post(msg: ToolboxToHost): void {
  vscode.postMessage(msg);
}

post({ type: "ready" });

toggle.addEventListener("click", () => post({ type: "toggleMode" }));

window.addEventListener("message", (event: MessageEvent<HostToToolbox>) => {
  const msg = event.data;
  if (msg.type === "setToolbox") {
    program = msg.program;
    blocksMode = msg.blocksMode;
    render();
  }
});

function render(): void {
  toggle.textContent = blocksMode ? "Blocks" : "Text";
  toggle.classList.toggle("on", blocksMode);
  toggle.title = blocksMode ? "Switch all C files back to text" : "Edit all C files as blocks";
  if (!blocksMode) {
    content.innerHTML = `<div class="hint">Turn on <b>Blocks</b> to edit open C files on the stage. The parts palette lives here; the file stays in the editor.</div>`;
    return;
  }
  if (!program || program.toolbox.length === 0) {
    content.innerHTML = `<div class="empty">No parts yet.</div>`;
    return;
  }
  if (!active || !program.toolbox.some((c) => c.id === active)) {
    active = program.toolbox.find((c) => c.id === "custom")?.id
      ?? program.toolbox.find((c) => c.id === "control")?.id
      ?? program.toolbox[0]?.id;
  }
  content.innerHTML = `<div class="body"><nav class="rail" id="rail"></nav><aside class="flyout" id="flyout"></aside></div>`;
  const rail = document.getElementById("rail")!;
  const flyout = document.getElementById("flyout")!;
  for (const cat of program.toolbox) {
    const btn = document.createElement("button");
    btn.className = `cat${cat.id === active ? " active" : ""}`;
    btn.innerHTML = `<span class="swatch" style="background:${cat.color}"></span>${escapeHtml(cat.label)}`;
    btn.addEventListener("click", () => {
      active = cat.id;
      render();
    });
    rail.appendChild(btn);
  }
  const cat = program.toolbox.find((c) => c.id === active);
  if (!cat) {
    return;
  }
  const h = document.createElement("h2");
  h.textContent = cat.label;
  h.style.borderLeft = `4px solid ${cat.color}`;
  h.style.paddingLeft = "8px";
  flyout.appendChild(h);
  const hint = document.createElement("div");
  hint.className = "hint";
  hint.style.padding = "0 0 8px";
  hint.textContent = "Click a part to add it to the open file.";
  flyout.appendChild(hint);
  for (const proto of cat.blocks) {
    const el = document.createElement("div");
    el.className = "proto";
    el.title = proto.opcode;
    el.appendChild(renderCodeSvg(emitToolboxBlock(proto), 0.58));
    el.addEventListener("click", () => post({ type: "insert", block: proto }));
    flyout.appendChild(el);
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}

void (0 as unknown as Block);
