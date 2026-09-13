import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "test/preview");
mkdirSync(out, { recursive: true });
copyFileSync(join(root, "dist/webview.js"), join(out, "webview.js"));

const scratchblocks = pathToFileURL(join(root, "node_modules/scratchblocks/build/scratchblocks.min.js")).href;
const files = ["hello.c", "fizzbuzz.c", "memory.c", "greet.c"];

for (const name of files) {
  const json = execFileSync(process.execPath, [join(root, "dist/cli.js"), join(root, "examples", name), "--json"], {
    encoding: "utf8",
    cwd: root,
  });
  const program = JSON.parse(json);
  const emit = execFileSync(process.execPath, [join(root, "dist/cli.js"), join(root, "examples", name)], {
    encoding: "utf8",
    cwd: root,
  });
  const scripts = parseEmit(emit);

  const blocksHtml = scripts
    .map(
      (s) =>
        `<div class="script" style="left:${s.x}px;top:${s.y}px"><pre class="blocks">${escapeHtml(s.code)}</pre></div>`,
    )
    .join("\n");

  writeFileSync(
    join(out, `${name}.html`),
    `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${name}</title>
<style>
  html, body { margin:0; background:#e9f1fc; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; }
  h1 { margin:0; padding:16px 20px; background:#4d97ff; color:#fff; font-size:18px; }
  .stage { position:relative; min-height: 900px; background-image: radial-gradient(#c5d4eb 1.2px, transparent 1.2px); background-size:28px 28px; }
  .script { position:absolute; }
</style>
</head><body>
<h1>Hatblocks · ${name} · ${program.stats.scripts} scripts · ${program.stats.blocks} blocks</h1>
<div class="stage">${blocksHtml}</div>
<script src="${scratchblocks}"></script>
<script>scratchblocks.renderMatching("pre.blocks", { style: "scratch3", scale: 0.75 });</script>
</body></html>`,
  );

  writeFileSync(
    join(out, `${name}.stage.html`),
    `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Hatblocks ${name}</title></head>
<body>
<script>
  const PROGRAM = ${JSON.stringify(program)};
  window.acquireVsCodeApi = function () {
    return {
      postMessage: function (msg) {
        if (msg.type === "ready") {
          window.postMessage({ type: "setProgram", program: PROGRAM }, "*");
        }
      },
      getState: function () {},
      setState: function () {},
    };
  };
</script>
<script src="./webview.js"></script>
</body></html>`,
  );
}

console.log("preview pages in test/preview");

function parseEmit(text) {
  const scripts = [];
  const chunks = text.split(/\n\/\/ script /).slice(1);
  for (const chunk of chunks) {
    const nl = chunk.indexOf("\n");
    const header = chunk.slice(0, nl);
    const at = /@ \((\-?\d+),(\-?\d+)\)/.exec(header);
    scripts.push({
      x: at ? Number(at[1]) : 40,
      y: at ? Number(at[2]) : 40,
      code: chunk.slice(nl + 1).trim(),
    });
  }
  return scripts;
}

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

void readFileSync;
