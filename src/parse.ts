import * as vscode from "vscode";
import type { Program } from "./ir/types";
import { adapterFor } from "./languages/registry";
import { wasmDirFrom } from "./paths";

export async function parseDocument(context: vscode.ExtensionContext, doc: vscode.TextDocument): Promise<Program> {
  const adapter = adapterFor({ languageId: doc.languageId, fileName: doc.fileName });
  const maxBlocks = vscode.workspace.getConfiguration("hatblocks").get<number>("maxBlocks", 2500);
  if (!adapter) {
    return {
      language: "unknown",
      fileName: doc.fileName,
      sprites: [{ name: "unknown", scripts: [] }],
      toolbox: [],
      diagnostics: [{ message: "No Hatblocks language adapter for this file.", severity: "error" }],
      stats: { scripts: 0, blocks: 0, truncated: false },
    };
  }
  const program = await adapter.parse(doc.getText(), {
    fileName: doc.fileName,
    wasmDir: wasmDirFrom(context.extensionPath),
    maxBlocks,
  });
  attachGaps(program, doc.getText());
  return program;
}

/** Count blank lines between top-level stacks so the stage can keep that spacing. */
export function attachGaps(program: Program, source: string): void {
  const scripts = program.sprites[0]?.scripts;
  if (!scripts?.length) {
    return;
  }
  const lines = source.split(/\n/);
  for (let i = 0; i < scripts.length; i++) {
    if (i === 0) {
      scripts[i].gapBefore = 0;
      continue;
    }
    const prevEnd = scripts[i - 1].root.source?.end.line ?? 0;
    const start = scripts[i].root.source?.start.line ?? prevEnd + 2;
    let blanks = 0;
    for (let line = prevEnd + 1; line < start && line < lines.length; line++) {
      if (!lines[line].trim()) {
        blanks++;
      }
    }
    scripts[i].gapBefore = Math.max(1, blanks);
  }
}

export function emitDocument(doc: vscode.TextDocument, program: Program): string | undefined {
  const adapter = adapterFor({ languageId: doc.languageId, fileName: doc.fileName });
  return adapter?.emit?.(program);
}
