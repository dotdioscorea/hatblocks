import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { pythonAdapter } from "../src/languages/python/adapter";
import { cppAdapter } from "../src/languages/cpp/adapter";
import { cAdapter } from "../src/languages/c/adapter";
import { emitProgram } from "../src/emit/scratchblocks";
import { emitC } from "../src/emit/c";

const wasmDir = join(process.cwd(), "wasm");
const examples = join(process.cwd(), "examples");

test("python hello.py lowers defs and print", async () => {
  const source = readFileSync(join(examples, "hello.py"), "utf8");
  const program = await pythonAdapter.parse(source, { fileName: "hello.py", wasmDir });
  const code = emitProgram(program).map((s) => s.code).join("\n");
  assert.ok(program.stats.scripts >= 1);
  assert.match(code, /define/);
  assert.match(code, /greet|print|__main__/);
});

test("cpp hello.cpp parses as cpp with a main hat", async () => {
  const source = readFileSync(join(examples, "hello.cpp"), "utf8");
  const program = await cppAdapter.parse(source, { fileName: "hello.cpp", wasmDir });
  assert.equal(program.language, "cpp");
  const code = emitProgram(program).map((s) => s.code).join("\n");
  assert.match(code, /main/);
});

test("args.c round-trips main params and return add()", async () => {
  const source = readFileSync(join(examples, "args.c"), "utf8");
  const program = await cAdapter.parse(source, { fileName: "args.c", wasmDir });
  const hat = program.sprites[0].scripts.find((s) => s.root.opcode === "events.flag")?.root;
  assert.ok(hat);
  assert.equal(hat?.fields.returnType, "int");
  assert.ok((hat?.params?.length ?? 0) >= 1);
  const c = emitC(program);
  assert.match(c, /int main\s*\(/);
  assert.match(c, /argc/);
});

test("cast.c keeps a cast operator", async () => {
  const source = readFileSync(join(examples, "cast.c"), "utf8");
  const program = await cAdapter.parse(source, { fileName: "cast.c", wasmDir });
  const code = emitProgram(program).map((s) => s.code).join("\n");
  assert.match(code, /int|cast|\(int\)/i);
});
