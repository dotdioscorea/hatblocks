import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { cAdapter } from "../src/languages/c/adapter";
import { emitC } from "../src/emit/c";

const wasmDir = join(process.cwd(), "wasm");
const examples = join(process.cwd(), "examples");

async function parseFile(name: string) {
  const source = readFileSync(join(examples, name), "utf8");
  return cAdapter.parse(source, { fileName: name, wasmDir, maxBlocks: 2500 });
}

test("hello.c emits a compiling-shaped main that prints hello", async () => {
  const program = await parseFile("hello.c");
  const c = emitC(program);
  assert.match(c, /#include <stdio.h>/);
  assert.match(c, /int main\(void\)/);
  assert.match(c, /Hello, world!/);
  assert.match(c, /return 0;/);
});

test("fizzbuzz.c emit keeps the Fizz/Buzz branches", async () => {
  const c = emitC(await parseFile("fizzbuzz.c"));
  assert.match(c, /FizzBuzz/);
  assert.match(c, /Fizz/);
  assert.match(c, /Buzz/);
  assert.match(c, /for \(/);
});

test("greet.c emit has helper functions and main", async () => {
  const c = emitC(await parseFile("greet.c"));
  assert.match(c, /greet\s*\(/);
  assert.match(c, /add\s*\(/);
  assert.match(c, /int main\(void\)/);
});

test("emitted C can be parsed back into a green-flag script", async () => {
  const original = await parseFile("hello.c");
  const c = emitC(original);
  const again = await cAdapter.parse(c, { fileName: "hello.c", wasmDir, maxBlocks: 2500 });
  assert.ok(again.stats.scripts >= 1);
  assert.ok(again.sprites[0].scripts.some((s) => s.root.opcode === "events.flag"));
});
