import type { Block, Program, SourceSpan } from "./ir/types";

export type HostToEditor =
  | { type: "setProgram"; program: Program }
  | { type: "insert"; block: Block }
  | { type: "requestExport" };

export type EditorToHost =
  | { type: "ready" }
  | { type: "programChanged"; program: Program }
  | { type: "run" }
  | { type: "exportPng"; dataUrl: string }
  | { type: "reveal"; span: SourceSpan };

export type HostToToolbox =
  | { type: "setToolbox"; program: Program | undefined; blocksMode: boolean; fileName?: string };

export type ToolboxToHost =
  | { type: "ready" }
  | { type: "insert"; block: Block }
  | { type: "toggleMode" };
