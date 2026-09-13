import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { cAdapter } from "../src/languages/c/adapter";
import { emitProgram } from "../src/emit/scratchblocks";

const wasmDir = join(process.cwd(), "wasm");
const examples = join(process.cwd(), "examples");

async function parseFile(name: string) {
  const fileName = join(examples, name);
  const source = readFileSync(fileName, "utf8");
  return cAdapter.parse(source, { fileName: name, wasmDir, maxBlocks: 2500 });
}

function allCode(program: Awaited<ReturnType<typeof parseFile>>): string {
  return emitProgram(program)
    .map((s) => s.code)
    .join("\n\n");
}

test("hello.c becomes a green-flag script that says hello", async () => {
  const program = await parseFile("hello.c");
  const code = allCode(program);
  assert.ok(program.stats.scripts >= 1);
  assert.match(code, /when @greenFlag clicked|when flag clicked|when gf clicked/);
  assert.match(code, /say \[Hello, world!\]/);
  assert.match(code, /use library \[stdio\.h v\]/);
});

test("fizzbuzz.c maps the counted for-loop to repeat and keeps the if/else tower", async () => {
  const program = await parseFile("fizzbuzz.c");
  const code = allCode(program);
  assert.match(code, /repeat \(100\)/);
  assert.match(code, /if <.*> then/);
  assert.match(code, /else/);
  assert.match(code, /FizzBuzz/);
  assert.match(code, /Fizz/);
  assert.match(code, /Buzz/);
});

test("memory.c maps malloc/free/NULL onto sensing blocks", async () => {
  const program = await parseFile("memory.c");
  const code = allCode(program);
  assert.match(code, /create clone of/);
  assert.match(code, /delete clone/);
  assert.match(code, /empty :: sensing|NULL|null/i);
});

test("greet.c emits a define hat for helpers and a flag hat for main", async () => {
  const program = await parseFile("greet.c");
  const code = allCode(program);
  assert.match(code, /define greet/);
  assert.match(code, /define add/);
  assert.match(code, /when @greenFlag clicked|when flag clicked/);
  assert.match(code, /greet .*:: custom/);
});

test("toolbox includes Scratch-style categories", async () => {
  const program = await parseFile("hello.c");
  const ids = program.toolbox.map((c) => c.id);
  assert.ok(ids.includes("control"));
  assert.ok(ids.includes("events"));
  assert.ok(ids.includes("operators"));
  assert.ok(ids.includes("extension"));
});
