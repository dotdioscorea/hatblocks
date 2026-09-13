import type { Node } from "web-tree-sitter";
import { lowerCAst } from "../c/lower";
import { cppToolbox } from "./catalog";
import { makeBlock } from "../../ir/builders";
import { createIdFactory } from "../../ir/ids";
import type { Program } from "../../ir/types";

export function lowerCpp(root: Node, options: { fileName: string; maxBlocks: number }): Program {
  const program = lowerCAst(root, options);
  program.language = "cpp";
  program.toolbox = cppToolbox();
  const id = createIdFactory("cls");
  for (const child of (root.namedChildren ?? []).filter((n): n is Node => n != null && n.isNamed)) {
    if (child.type === "class_specifier" || child.type === "struct_specifier") {
      const name = child.childForFieldName("name")?.text ?? "T";
      const block = makeBlock(id, {
        opcode: "cpp.class",
        shape: "c",
        category: "custom",
        line: "class [{name} v] {",
        closer: "} :: custom",
        fields: { name },
        values: {},
        branches: {},
        source: {
          start: { line: child.startPosition.row, column: child.startPosition.column, offset: child.startIndex },
          end: { line: child.endPosition.row, column: child.endPosition.column, offset: child.endIndex },
        },
      });
      program.sprites[0].scripts.push({
        id: id(),
        x: 12,
        y: 16 + program.sprites[0].scripts.length * 28,
        root: block,
      });
    }
  }
  program.stats.scripts = program.sprites[0].scripts.length;
  return program;
}
