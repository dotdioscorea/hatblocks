import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "wasm");
mkdirSync(dest, { recursive: true });

const files = [
  ["node_modules/web-tree-sitter/tree-sitter.wasm", "tree-sitter.wasm"],
  ["node_modules/tree-sitter-wasms/out/tree-sitter-c.wasm", "tree-sitter-c.wasm"],
];

for (const [fromRel, name] of files) {
  const from = join(root, fromRel);
  if (!existsSync(from)) {
    if (existsSync(join(root, "node_modules"))) {
      console.warn(`copy-wasm: missing ${fromRel}`);
    }
    continue;
  }
  copyFileSync(from, join(dest, name));
}
