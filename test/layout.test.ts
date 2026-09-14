import assert from "node:assert/strict";
import test from "node:test";
import { layoutMarks } from "../src/webview/layout";
import type { Block } from "../src/ir/types";

function blk(partial: Partial<Block> & Pick<Block, "opcode" | "shape">): Block {
  return {
    id: partial.id ?? "b",
    opcode: partial.opcode,
    shape: partial.shape,
    category: "custom",
    line: "",
    fields: {},
    values: {},
    branches: {},
    ...partial,
  };
}

test("function mouth body sits below the header, not over it", () => {
  const print = blk({
    id: "print",
    opcode: "custom.call",
    shape: "stack",
    source: { start: { line: 4, column: 0, offset: 0 }, end: { line: 4, column: 1, offset: 1 } },
  });
  const fn = blk({
    id: "greet",
    opcode: "py.def",
    shape: "c",
    branches: { body: print },
    source: { start: { line: 3, column: 0, offset: 0 }, end: { line: 5, column: 1, offset: 1 } },
  });
  const { marks } = layoutMarks(fn);
  const header = marks.find((m) => m.block.id === "greet")!;
  const body = marks.find((m) => m.block.id === "print")!;
  assert.ok(header);
  assert.ok(body);
  assert.equal(header.line, 4);
  assert.equal(body.line, 5);
  assert.ok(header.headerH < header.h, "header is shorter than the whole function");
  assert.ok(body.y >= header.y + header.headerH, "print is below the def header");
});

test("class methods are nested under the class header", () => {
  const init = blk({
    id: "init",
    opcode: "py.def",
    shape: "c",
    source: { start: { line: 1, column: 0, offset: 0 }, end: { line: 2, column: 1, offset: 1 } },
  });
  const bump = blk({
    id: "bump",
    opcode: "py.def",
    shape: "c",
    source: { start: { line: 4, column: 0, offset: 0 }, end: { line: 6, column: 1, offset: 1 } },
  });
  init.next = bump;
  const klass = blk({
    id: "cls",
    opcode: "py.class",
    shape: "c",
    branches: { body: init },
    source: { start: { line: 0, column: 0, offset: 0 }, end: { line: 6, column: 1, offset: 1 } },
  });
  const { marks } = layoutMarks(klass);
  const cls = marks.find((m) => m.block.id === "cls")!;
  const a = marks.find((m) => m.block.id === "init")!;
  const b = marks.find((m) => m.block.id === "bump")!;
  assert.equal(cls.line, 1);
  assert.equal(a.line, 2);
  assert.equal(b.line, 5);
  assert.ok(a.y > cls.y);
  assert.ok(b.y > a.y);
});
