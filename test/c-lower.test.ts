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

test("hello.c is int main that prints hello and includes stdio", async () => {
  const program = await parseFile("hello.c");
  const code = allCode(program);
  assert.ok(program.stats.scripts >= 1);
  assert.match(code, /:: events hat|int main/);
  assert.match(code, /Hello, world!/);
  assert.match(code, /#include \[stdio\.h v\]/);
});

test("fizzbuzz.c keeps if/else and Fizz/Buzz as C-shaped control", async () => {
  const program = await parseFile("fizzbuzz.c");
  const code = allCode(program);
  assert.match(code, /if /);
  assert.match(code, /else/);
  assert.match(code, /FizzBuzz/);
  assert.match(code, /Fizz/);
  assert.match(code, /Buzz/);
});

test("memory.c maps malloc/free/NULL onto pointer blocks", async () => {
  const program = await parseFile("memory.c");
  const code = allCode(program);
  assert.match(code, /malloc/);
  assert.match(code, /free/);
  assert.match(code, /NULL/i);
});

test("greet.c emits C function hats for helpers and main", async () => {
  const program = await parseFile("greet.c");
  const code = allCode(program);
  assert.match(code, /greet/);
  assert.match(code, /add/);
  assert.match(code, /:: events hat|:: custom hat/);
  assert.doesNotMatch(code, /\bdefine\b/);
  assert.doesNotMatch(code, /clicked/);
});

test("toolbox is C syntax groups, not Scratch motion/sound", async () => {
  const program = await parseFile("hello.c");
  const ids = program.toolbox.map((c) => c.id);
  const labels = program.toolbox.map((c) => c.label);
  assert.ok(ids.includes("control"));
  assert.ok(ids.includes("operators"));
  assert.ok(ids.includes("extension"));
  assert.ok(!ids.includes("motion"));
  assert.ok(!ids.includes("sound"));
  assert.ok(labels.includes("Pre") || labels.includes("Func") || labels.includes("Functions"));
  const preproc = program.toolbox.find((c) => c.id === "extension");
  const includeCount = preproc?.blocks.filter((b) => b.opcode === "c.include").length ?? 0;
  assert.equal(includeCount, 1);
});
