import type { LanguageAdapter } from "../types";
import type { ParseOptions, Program } from "../../ir/types";
import { createParser, loadLanguage } from "../tree-sitter";
import { lowerPython } from "./lower";
import { emitPython } from "../../emit/python";
import { pythonToolbox } from "./catalog";

export const pythonAdapter: LanguageAdapter = {
  id: "python",
  name: "Python",
  vscodeLanguageIds: ["python"],
  extensions: [".py"],
  emit: emitPython,

  async parse(source: string, options: ParseOptions): Promise<Program> {
    const language = await loadLanguage(options.wasmDir, "tree-sitter-python.wasm");
    const parser = createParser(language);
    try {
      const tree = parser.parse(source);
      if (!tree) {
        return {
          language: "python",
          fileName: options.fileName,
          sprites: [{ name: options.fileName, scripts: [] }],
          toolbox: pythonToolbox(),
          diagnostics: [{ message: "Python parser returned no tree.", severity: "error" }],
          stats: { scripts: 0, blocks: 0, truncated: false },
        };
      }
      return lowerPython(tree.rootNode, {
        fileName: options.fileName,
        maxBlocks: options.maxBlocks ?? 2500,
      });
    } finally {
      parser.delete();
    }
  },
};
