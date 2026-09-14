import { lowerCAst } from "../c/lower";
import { cppToolbox } from "./catalog";
import type { Program } from "../../ir/types";

export function lowerCpp(root: import("web-tree-sitter").Node, options: { fileName: string; maxBlocks: number }): Program {
  const program = lowerCAst(root, options);
  program.language = "cpp";
  program.toolbox = cppToolbox();
  return program;
}
