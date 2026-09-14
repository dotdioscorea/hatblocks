import assert from "node:assert/strict";
import test from "node:test";
import { layoutMarks, type Mark } from "../src/webview/layout";
import { clumpGroups } from "../src/webview/highlight";
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

test("clumpGroups walks the next chain, not nested mouths", () => {
  const g1 = { id: "g1" } as unknown as SVGGElement;
  const g2 = { id: "g2" } as unknown as SVGGElement;
  const child = blk({ id: "child", opcode: "custom.call", shape: "stack" });
  const a = blk({ id: "a", opcode: "py.def", shape: "c", branches: { body: child } });
  const b = blk({ id: "b", opcode: "py.def", shape: "c" });
  a.next = b;
  const marks: Mark[] = [
    { block: child, y: 10, h: 20, headerH: 20, chainH: 20, el: { id: "gchild" } as unknown as SVGGElement },
    { block: a, y: 0, h: 80, headerH: 40, chainH: 160, el: g1 },
    { block: b, y: 80, h: 80, headerH: 40, chainH: 80, el: g2 },
  ];
  const hit = marks[1];
  const groups = clumpGroups(hit, marks);
  assert.equal(groups.length, 2);
  assert.equal(groups[0], g1);
  assert.equal(groups[1], g2);
});
