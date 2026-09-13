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
  return adapter.parse(doc.getText(), {
    fileName: doc.fileName,
    wasmDir: wasmDirFrom(context.extensionPath),
    maxBlocks,
  });
}

export function emitDocument(doc: vscode.TextDocument, program: Program): string | undefined {
  const adapter = adapterFor({ languageId: doc.languageId, fileName: doc.fileName });
  return adapter?.emit?.(program);
}
