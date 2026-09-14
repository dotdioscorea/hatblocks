import css from "./inspector.css";
import type { Block } from "../ir/types";
import { isLiteral } from "../ir/builders";
import type { HostToInspector, InspectorMutation, InspectorToHost } from "../protocol";
import { PY_STD_IMPORTS, PY_STD_MODULES, PY_STD_TYPES } from "../languages/python/catalog";
import { C_TYPES } from "../library/hats";

const vscode = acquireVsCodeApi();

const app = document.createElement("div");
app.id = "app";
app.innerHTML = `<h3>Inspector</h3><div id="body"><p class="muted">Select a block on the stage.</p></div>`;
document.body.appendChild(app);
const style = document.createElement("style");
style.textContent = css;
document.head.appendChild(style);

const body = document.getElementById("body")!;
let current: Block | null = null;
let language = "c";

const C_HEADERS = ["stdio.h", "stdlib.h", "string.h", "math.h", "stdint.h", "stdbool.h", "iostream", "vector", "string"];

function post(msg: InspectorToHost): void {
  vscode.postMessage(msg);
}

post({ type: "ready" });

window.addEventListener("message", (event: MessageEvent<HostToInspector>) => {
  const msg = event.data;
  if (msg.type === "setSelection") {
    current = msg.state.block;
    language = msg.state.language || "c";
    render();
  }
});

function escapeAttr(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
}

function isHat(block: Block): boolean {
  return block.opcode === "events.flag" || block.opcode === "custom.define" || block.opcode === "py.class";
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

function slotName(block: Block, slot: string): string {
  const v = block.values[slot];
  if (!v || isLiteral(v)) {
    return isLiteral(v) && v.kind !== "empty" ? v.value : "";
  }
  if (v.opcode === "type.named" || v.opcode === "type.custom" || v.opcode === "data.get") {
    return v.fields.name || v.fields.var || "";
  }
  return "";
}

function suggestionsFor(key: string): string[] {
  if (language === "python") {
    if (key === "module") {
      return PY_STD_MODULES;
    }
    if (key === "name" && current?.opcode === "py.importFrom") {
      return PY_STD_IMPORTS;
    }
    if (key === "type" || key === "ret" || /^t\d+$/.test(key) || key === "arg" || key === "base") {
      return PY_STD_TYPES;
    }
  } else {
    if (key === "header") {
      return C_HEADERS;
    }
    if (key === "type" || key === "ret" || /^t\d+$/.test(key) || key === "arg" || key === "base") {
      return C_TYPES;
    }
  }
  return [];
}

function fieldInput(key: string, value: string): string {
  const list = suggestionsFor(key);
  const listId = list.length ? `dl-${key}` : "";
  const datalist = list.length
    ? `<datalist id="${listId}">${list.map((o) => `<option value="${escapeAttr(o)}"></option>`).join("")}</datalist>`
    : "";
  const listAttr = listId ? ` list="${listId}"` : "";
  return `<label>${escapeAttr(labelFor(key))}</label><input data-field="${escapeAttr(key)}" value="${escapeAttr(value)}"${listAttr} />${datalist}`;
}

function slotInput(slot: string, value: string): string {
  const list = suggestionsFor(slot);
  const listId = list.length ? `dl-slot-${slot}` : "";
  const datalist = list.length
    ? `<datalist id="${listId}">${list.map((o) => `<option value="${escapeAttr(o)}"></option>`).join("")}</datalist>`
    : "";
  const listAttr = listId ? ` list="${listId}"` : "";
  return `<label>${escapeAttr(labelFor(slot))}</label><input data-slot="${escapeAttr(slot)}" value="${escapeAttr(value)}"${listAttr} />${datalist}`;
}

function render(): void {
  const block = current;
  if (!block) {
    body.innerHTML = `<p class="muted">Select a block on the stage.</p>`;
    return;
  }
  const bits: string[] = [`<p class="opcode">${escapeAttr(block.opcode)}</p>`];
  if (block.source) {
    bits.push(`<p class="muted">Line ${block.source.start.line + 1}</p>`);
  }

  const fieldKeys = Object.keys(block.fields).filter((k) => !/^p\d+$/.test(k) && k !== "returnType");
  for (const key of fieldKeys) {
    bits.push(fieldInput(key, block.fields[key] ?? ""));
  }

  const typeSlots = ["ret", "type", "t0", "inner", "base", "arg", "targ", "module", "name"].filter(
    (s) => s in block.values || (isHat(block) && s === "ret"),
  );
  for (const slot of Object.keys(block.values)) {
    if ((/^t\d+$/.test(slot) || slot === "module" || slot === "name") && !typeSlots.includes(slot)) {
      typeSlots.push(slot);
    }
  }
  for (const slot of typeSlots) {
    const text = slotName(block, slot);
    if (text || slot === "ret" || slot === "type" || slot === "module" || slot === "name" || /^t\d+$/.test(slot)) {
      bits.push(slotInput(slot, text));
    }
  }

  if (isHat(block) || block.opcode === "ops.lambda" || block.opcode === "ops.lambdaBlock") {
    bits.push(`<label>Parameters</label>`);
    for (const [i, p] of (block.params ?? []).entries()) {
      bits.push(
        `<div class="row"><input data-pt="${i}" placeholder="type" value="${escapeAttr(p.type)}" /><input data-pn="${i}" placeholder="name" value="${escapeAttr(p.name)}" /></div>`,
      );
    }
    bits.push(`<button type="button" id="addParam">+ parameter</button><button type="button" id="delParam">− parameter</button>`);
  }

  if (isCall(block) || block.opcode === "cpp.new") {
    const n = block.extraArgs?.length ?? 0;
    const kind = block.opcode === "py.list" || block.opcode === "py.tuple" ? "item" : "argument";
    bits.push(`<p class="muted">${n} ${kind} slot${n === 1 ? "" : "s"}</p>`);
    bits.push(`<button type="button" id="addArg">+ ${kind}</button><button type="button" id="delArg">− ${kind}</button>`);
  }

  bits.push(
    `<p class="hint">${
      language === "python"
        ? "Python parts. Suggestions are a starting point — type anything. Drag type boxes into holes."
        : "Types and names are freeform. Suggestions appear where they help; they are not a closed list."
    }</p>`,
  );
  body.innerHTML = bits.join("");

  body.querySelectorAll("input[data-field]").forEach((el) => {
    el.addEventListener("change", () => flush());
  });
  body.querySelectorAll("input[data-slot]").forEach((el) => {
    el.addEventListener("change", () => flush());
  });
  body.querySelectorAll("input[data-pt], input[data-pn]").forEach((el) => {
    el.addEventListener("change", () => flush());
  });
  body.querySelector("#addParam")?.addEventListener("click", () => flush({ paramDelta: 1 }));
  body.querySelector("#delParam")?.addEventListener("click", () => flush({ paramDelta: -1 }));
  body.querySelector("#addArg")?.addEventListener("click", () => flush({ argDelta: 1 }));
  body.querySelector("#delArg")?.addEventListener("click", () => flush({ argDelta: -1 }));
}

function labelFor(key: string): string {
  if (key === "ret") {
    return "Return type";
  }
  if (key === "name") {
    return current?.opcode === "py.importFrom" ? "Imported name" : "Name";
  }
  if (key === "module") {
    return "Module";
  }
  if (key === "var") {
    return current?.opcode === "py.for" ? "Loop variable" : "Variable";
  }
  if (key === "field") {
    return "Member";
  }
  if (key === "header") {
    return "Header";
  }
  if (key === "type") {
    return "Type";
  }
  const param = /^t(\d+)$/.exec(key);
  if (param) {
    return `Param ${Number(param[1]) + 1} type`;
  }
  return key;
}

function flush(opts: { paramDelta?: number; argDelta?: number } = {}): void {
  if (!current) {
    return;
  }
  const fields: Record<string, string> = { ...current.fields };
  body.querySelectorAll("input[data-field]").forEach((el) => {
    const input = el as HTMLInputElement;
    fields[input.dataset.field!] = input.value;
  });
  const slotText: Record<string, string> = {};
  body.querySelectorAll("input[data-slot]").forEach((el) => {
    const input = el as HTMLInputElement;
    slotText[input.dataset.slot!] = input.value;
  });
  let params = (current.params ?? []).map((p) => ({ ...p }));
  body.querySelectorAll("input[data-pt]").forEach((el) => {
    const input = el as HTMLInputElement;
    const i = Number(input.dataset.pt);
    if (params[i]) {
      params[i].type = input.value;
    }
  });
  body.querySelectorAll("input[data-pn]").forEach((el) => {
    const input = el as HTMLInputElement;
    const i = Number(input.dataset.pn);
    if (params[i]) {
      params[i].name = input.value;
    }
  });
  if (opts.paramDelta === 1) {
    params.push({ type: language === "python" ? "Any" : "int", name: `arg${params.length + 1}` });
  } else if (opts.paramDelta === -1 && params.length) {
    params = params.slice(0, -1);
  }
  let extraArgsCount = current.extraArgs?.length ?? 0;
  if (opts.argDelta === 1) {
    extraArgsCount += 1;
  } else if (opts.argDelta === -1 && extraArgsCount) {
    extraArgsCount -= 1;
  }
  const mutation: InspectorMutation = {
    id: current.id,
    fields,
    params,
    extraArgsCount,
    slotText,
  };
  post({ type: "mutate", mutation });
}
