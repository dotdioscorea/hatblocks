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

test("python cls.py splits class, methods, and try into separate scripts", async () => {
  const source = readFileSync(join(examples, "cls.py"), "utf8");
  const program = await pythonAdapter.parse(source, { fileName: "cls.py", wasmDir });
  const roots = program.sprites[0].scripts.map((s) => s.root.opcode);
  assert.ok(roots.includes("py.class"));
  assert.ok(roots.filter((o) => o === "custom.define").length >= 2);
  const code = emitProgram(program).map((s) => s.code).join("\n");
  assert.doesNotMatch(code, /when file/);
  assert.match(code, /class Counter|Counter/);
});

test("python hello.py lowers defs and print", async () => {
  const source = readFileSync(join(examples, "hello.py"), "utf8");
  const program = await pythonAdapter.parse(source, { fileName: "hello.py", wasmDir });
  const code = emitProgram(program).map((s) => s.code).join("\n");
  assert.ok(program.stats.scripts >= 1);
  assert.match(code, /:: custom hat|greet/);
  assert.match(code, /print|__main__/);
  assert.doesNotMatch(code, /clicked/);
  const opcodes = collectOpcodes(program);
  assert.ok(opcodes.has("py.list"), "list literals are list reporters, not C-block braces");
  assert.doesNotMatch(code, /\{\s*\}/);
  assert.match(code, /for \[n\] in/);
  assert.match(code, /variables stack/);
  const labels = program.toolbox.map((c) => c.label);
  assert.ok(labels.includes("Import"));
  assert.ok(!labels.includes("Pre"));
  assert.ok(!labels.includes("Ptr"));
  const lines = collectSourceLines(program);
  assert.ok(lines.has(13) || lines.has(14), "greet/xs should keep their source lines");
  assert.ok(lines.has(15) && lines.has(16) && lines.has(17), "statements after the list keep line numbers");
});

function collectSourceLines(program: { sprites: Array<{ scripts: Array<{ root: { source?: { start: { line: number } }; next?: unknown; values?: Record<string, unknown>; branches?: Record<string, unknown> } }> }> }): Set<number> {
  const out = new Set<number>();
  const walk = (block: { source?: { start: { line: number } }; next?: unknown; values?: Record<string, unknown>; branches?: Record<string, unknown> } | undefined): void => {
    let current = block;
    while (current) {
      if (current.source) {
        out.add(current.source.start.line + 1);
      }
      for (const b of Object.values(current.branches ?? {})) {
        if (b && typeof b === "object") {
          walk(b as typeof current);
        }
      }
      current = current.next as typeof current;
    }
  };
  for (const sprite of program.sprites) {
    for (const script of sprite.scripts) {
      walk(script.root);
    }
  }
  return out;
}

test("cpp hello.cpp parses as cpp with a main hat", async () => {
  const source = readFileSync(join(examples, "hello.cpp"), "utf8");
  const program = await cppAdapter.parse(source, { fileName: "hello.cpp", wasmDir });
  assert.equal(program.language, "cpp");
  const code = emitProgram(program).map((s) => s.code).join("\n");
  assert.match(code, /main/);
  assert.doesNotMatch(code, /clicked/);
  const opcodes = collectOpcodes(program);
  assert.ok(opcodes.has("type.tmpl") || opcodes.has("type.scope"), "vector type should be nested type boxes");
  assert.ok(opcodes.has("custom.method"), "push_back should be member access");
  assert.ok(opcodes.has("control.forRange"), "range-for should be customisable");
  assert.ok(opcodes.has("ops.shl"), "cout << should be the shift/stream operator");
  assert.ok(!opcodes.has("looks.printf"));
});

test("shape.cpp assignment lhs is a slot and class members declare", async () => {
  const source = readFileSync(join(examples, "shape.cpp"), "utf8");
  const program = await cppAdapter.parse(source, { fileName: "shape.cpp", wasmDir });
  const code = emitProgram(program).map((s) => s.code).join("\n");
  assert.doesNotMatch(code, /std::cout/);
  const opcodes = collectOpcodes(program);
  assert.ok(opcodes.has("data.assign"));
  assert.ok(opcodes.has("sensing.field"));
  assert.ok(opcodes.has("cpp.class"));
  const c = emitC(program);
  assert.match(c, /p\.x\s*=\s*3/);
  assert.match(c, /class Point/);
});

function collectOpcodes(program: { sprites: Array<{ scripts: Array<{ root: { opcode: string; next?: unknown; values?: Record<string, unknown>; branches?: Record<string, unknown>; extraArgs?: unknown[] } }> }> }): Set<string> {
  const out = new Set<string>();
  const walk = (block: { opcode: string; next?: unknown; values?: Record<string, unknown>; branches?: Record<string, unknown>; extraArgs?: unknown[] } | undefined): void => {
    let current = block;
    while (current) {
      out.add(current.opcode);
      for (const v of Object.values(current.values ?? {})) {
        if (v && typeof v === "object" && "opcode" in (v as object)) {
          walk(v as typeof current);
        }
      }
      for (const extra of current.extraArgs ?? []) {
        if (extra && typeof extra === "object" && "opcode" in (extra as object)) {
          walk(extra as typeof current);
        }
      }
      for (const b of Object.values(current.branches ?? {})) {
        if (b && typeof b === "object" && "opcode" in (b as object)) {
          walk(b as typeof current);
        }
      }
      current = current.next as typeof current;
    }
  };
  for (const sprite of program.sprites) {
    for (const script of sprite.scripts) {
      walk(script.root);
    }
  }
  return out;
}

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
  const opcodes = collectOpcodes(program);
  assert.ok(opcodes.has("ops.cast"));
  assert.ok(opcodes.has("type.named") || opcodes.has("type.ptr"));
});

test("hello.c printf is a generic call, not a magic block", async () => {
  const source = readFileSync(join(examples, "hello.c"), "utf8");
  const program = await cAdapter.parse(source, { fileName: "hello.c", wasmDir });
  const opcodes = collectOpcodes(program);
  assert.ok(opcodes.has("custom.call"));
  assert.ok(!opcodes.has("looks.printf"));
  const c = emitC(program);
  assert.match(c, /printf\s*\(/);
});
