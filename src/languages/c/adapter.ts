import type { LanguageAdapter } from "../types";
import type { ParseOptions, Program } from "../../ir/types";
import { createParser, loadLanguage } from "../tree-sitter";
import { lowerCAst } from "./lower";
import { emitC } from "../../emit/c";

export const cAdapter: LanguageAdapter = {
  id: "c",
  name: "C",
  vscodeLanguageIds: ["c"],
  extensions: [".c", ".h"],
  emit: emitC,

  async parse(source: string, options: ParseOptions): Promise<Program> {
    const language = await loadLanguage(options.wasmDir, "tree-sitter-c.wasm");
    const parser = createParser(language);
    try {
      const tree = parser.parse(source);
      if (!tree) {
        return emptyProgram(options.fileName, "C parser returned no tree.");
      }
      return lowerCAst(tree.rootNode, {
        fileName: options.fileName,
        maxBlocks: options.maxBlocks ?? 2500,
      });
    } finally {
      parser.delete();
    }
  },
};

function emptyProgram(fileName: string, message: string): Program {
  return {
    language: "c",
    fileName,
    sprites: [{ name: fileName, scripts: [] }],
    toolbox: [],
    diagnostics: [{ message, severity: "error" }],
    stats: { scripts: 0, blocks: 0, truncated: false },
  };
}
