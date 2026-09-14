import type { Block, Program, SourceSpan } from "./ir/types";

export interface InspectorMutation {
  id: string;
  fields?: Record<string, string>;
  params?: { type: string; name: string }[];
  extraArgsCount?: number;
  /** Freeform names for type.named / type.custom reporters sitting in value slots. */
  slotText?: Record<string, string>;
}

export interface InspectorState {
  language: string;
  fileName?: string;
  block: Block | null;
}

export type HostToEditor =
  | { type: "setProgram"; program: Program }
  | { type: "insert"; block: Block }
  | { type: "libraryDrag"; block: Block }
  | { type: "requestExport" }
  | { type: "applyMutation"; mutation: InspectorMutation };

export type EditorToHost =
  | { type: "ready" }
  | { type: "programChanged"; program: Program }
  | { type: "run" }
  | { type: "exportPng"; dataUrl: string }
  | { type: "reveal"; span: SourceSpan }
  | { type: "select"; block: Block | null; language: string; fileName?: string }
  | { type: "undo" }
  | { type: "redo" };

export type HostToToolbox =
  | { type: "setToolbox"; program: Program | undefined; blocksMode: boolean; fileName?: string };

export type ToolboxToHost =
  | { type: "ready" }
  | { type: "insert"; block: Block }
  | { type: "dragStart"; block: Block }
  | { type: "toggleMode" };

export type HostToInspector = { type: "setSelection"; state: InspectorState };

export type InspectorToHost =
  | { type: "ready" }
  | { type: "mutate"; mutation: InspectorMutation };
