import type { Block, BlockShape, CategoryId, Literal, SourceSpan } from "./types";
import type { IdFactory } from "./ids";

export interface BlockInit {
  opcode: string;
  shape: BlockShape;
  category: CategoryId;
  line: string;
  fields?: Record<string, string>;
  values?: Record<string, Block | Literal>;
  branches?: Record<string, Block | undefined>;
  extraArgs?: (Block | Literal)[];
  closer?: string;
  source?: SourceSpan;
  comment?: string;
}

export function makeBlock(id: IdFactory, init: BlockInit): Block {
  return {
    id: id(),
    opcode: init.opcode,
    shape: init.shape,
    category: init.category,
    line: init.line,
    fields: init.fields ?? {},
    values: init.values ?? {},
    branches: init.branches ?? {},
    extraArgs: init.extraArgs,
    closer: init.closer,
    source: init.source,
    comment: init.comment,
  };
}

export function litNumber(value: string | number): Literal {
  return { kind: "number", value: String(value) };
}

export function litString(value: string): Literal {
  return { kind: "string", value };
}

export function litEmpty(): Literal {
  return { kind: "empty" };
}

export function isLiteral(value: Block | Literal): value is Literal {
  return "kind" in value && (value.kind === "number" || value.kind === "string" || value.kind === "empty");
}
