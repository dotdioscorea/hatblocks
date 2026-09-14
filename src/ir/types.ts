/** Canonical, language-agnostic Scratch-shaped program.
 *
 * Language adapters lower source → Program.
 * Emitters turn Program → scratchblocks text, Blockly, or (later) source.
 * The webview mutates Program when the user snaps blocks on the stage.
 */

export type CategoryId =
  | "motion"
  | "looks"
  | "sound"
  | "events"
  | "control"
  | "sensing"
  | "operators"
  | "variables"
  | "lists"
  | "custom"
  | "extension";

export type BlockShape =
  | "hat"
  | "stack"
  | "c"
  | "c2"
  | "cap"
  | "reporter"
  | "boolean";

export type Literal =
  | { kind: "number"; value: string }
  | { kind: "string"; value: string }
  | { kind: "empty" };

export interface SourceSpan {
  start: { line: number; column: number; offset: number };
  end: { line: number; column: number; offset: number };
}

export interface Diagnostic {
  message: string;
  span?: SourceSpan;
  severity: "info" | "warning" | "error";
}

export interface Block {
  id: string;
  opcode: string;
  shape: BlockShape;
  category: CategoryId;
  /** Line template. `{slot}` is replaced by values/fields. Icons: `@greenFlag`. */
  line: string;
  fields: Record<string, string>;
  values: Record<string, Block | Literal>;
  /** Statement mouths. Value is the head of a `next` chain. */
  branches: Record<string, Block | undefined>;
  /** Extra reporter slots, used by variable-arity calls. */
  extraArgs?: (Block | Literal)[];
  /** Function hats: typed parameters. */
  params?: { type: string; name: string }[];
  /** For custom C-block hacks (`while <> { ... } :: control`). */
  closer?: string;
  next?: Block;
  source?: SourceSpan;
  comment?: string;
}

export interface Script {
  id: string;
  x: number;
  y: number;
  root: Block;
  /** Blank lines to emit/show before this stack. 0 for the first; at least 1 between stacks. */
  gapBefore?: number;
}

export interface Sprite {
  name: string;
  scripts: Script[];
}

export interface ToolboxCategory {
  id: CategoryId;
  label: string;
  color: string;
  blocks: Block[];
}

export interface Program {
  language: string;
  fileName: string;
  sprites: Sprite[];
  toolbox: ToolboxCategory[];
  diagnostics: Diagnostic[];
  stats: { scripts: number; blocks: number; truncated: boolean };
}

export interface ParseOptions {
  fileName: string;
  wasmDir: string;
  maxBlocks?: number;
}
