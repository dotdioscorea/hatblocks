import assert from "node:assert/strict";
import test from "node:test";
import { insertAfter, prependBranch, unlink } from "../src/ir/tree";
import type { Block } from "../src/ir/types";

function blk(id: string, extra: Partial<Block> = {}): Block {
  return {
    id,
    opcode: extra.opcode ?? "py.def",
    shape: extra.shape ?? "c",
    category: "custom",
    line: "",
    fields: extra.fields ?? { name: id },
    values: {},
    branches: extra.branches ?? {},
    ...extra,
  };
}

test("prependBranch puts a detached method back at the start of a class mouth", () => {
  const bump = blk("bump");
  const init = blk("init");
  const klass = blk("class", { opcode: "py.class", branches: { body: init } });
  prependBranch(klass, "body", bump);
  assert.equal(klass.branches.body, bump);
  assert.equal(bump.next, init);
});

test("insertAfter appends a detached method under an existing member", () => {
  const init = blk("init");
  const bump = blk("bump");
  const klass = blk("class", { opcode: "py.class", branches: { body: init } });
  insertAfter(init, bump);
  assert.equal(klass.branches.body, init);
  assert.equal(init.next, bump);
});

test("unlink from a mouth then prepend restores membership", () => {
  const init = blk("init");
  const bump = blk("bump");
  init.next = bump;
  const klass = blk("class", { opcode: "py.class", branches: { body: init } });
  assert.ok(unlink(klass, bump));
  assert.equal(init.next, undefined);
  prependBranch(klass, "body", bump);
  assert.equal(klass.branches.body, bump);
  assert.equal(bump.next, init);
});
