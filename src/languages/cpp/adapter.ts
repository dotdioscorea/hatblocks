import type { LanguageAdapter } from "../types";
import type { ParseOptions, Program } from "../../ir/types";
import { createParser, loadLanguage } from "../tree-sitter";
import { lowerCpp } from "./lower";
import { emitC } from "../../emit/c";
import { cppToolbox } from "./catalog";

export const cppAdapter: LanguageAdapter = {
  id: "cpp",
  name: "C++",
  vscodeLanguageIds: ["cpp"],
  extensions: [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx"],
  emit: emitCpp,

  async parse(source: string, options: ParseOptions): Promise<Program> {
    const language = await loadLanguage(options.wasmDir, "tree-sitter-cpp.wasm");
    const parser = createParser(language);
    try {
      const tree = parser.parse(source);
      if (!tree) {
        return {
          language: "cpp",
          fileName: options.fileName,
          sprites: [{ name: options.fileName, scripts: [] }],
          toolbox: cppToolbox(),
          diagnostics: [{ message: "C++ parser returned no tree.", severity: "error" }],
          stats: { scripts: 0, blocks: 0, truncated: false },
        };
      }
      return lowerCpp(tree.rootNode, {
        fileName: options.fileName,
        maxBlocks: options.maxBlocks ?? 2500,
      });
    } finally {
      parser.delete();
    }
  },
};

function emitCpp(program: Program): string {
  const c = emitC(program);
  const classes = program.sprites.flatMap((s) => s.scripts).filter((s) => s.root.opcode === "cpp.class");
  if (!classes.length) {
    return c.replace(/#include <stdio.h>/g, "#include <iostream>");
  }
  const extra = classes
    .map((s) => {
      const name = s.root.fields.name || "T";
      return `class ${name} {\npublic:\n};\n`;
    })
    .join("\n");
  return `${extra}\n${c}`;
}
