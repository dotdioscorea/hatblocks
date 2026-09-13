import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { cAdapter } from "./languages/c/adapter";
import { emitProgram } from "./emit/scratchblocks";

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node dist/cli.js <file.c>");
    process.exit(1);
  }
  const abs = resolve(file);
  const source = readFileSync(abs, "utf8");
  const wasmDir = join(__dirname, "..", "wasm");
  const program = await cAdapter.parse(source, {
    fileName: basename(abs),
    wasmDir,
    maxBlocks: 2500,
  });
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(program, null, 2));
    return;
  }
  const scripts = emitProgram(program);
  for (const diag of program.diagnostics) {
    console.error(`${diag.severity}: ${diag.message}`);
  }
  console.error(`# ${program.stats.scripts} scripts, ${program.stats.blocks} blocks`);
  console.log(scripts.map((s) => `// script ${s.id} @ (${s.x},${s.y})\n${s.code}`).join("\n\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
