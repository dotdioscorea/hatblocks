import type { Node } from "web-tree-sitter";
import { lowerCAst } from "../c/lower";
import { cppToolbox } from "./catalog";
import { makeBlock, litEmpty } from "../../ir/builders";
import { chain, createIdFactory } from "../../ir/ids";
import type { Block, Program, SourceSpan } from "../../ir/types";

export function lowerCpp(root: Node, options: { fileName: string; maxBlocks: number }): Program {
  const program = lowerCAst(root, options);
  program.language = "cpp";
  program.toolbox = cppToolbox();
  const id = createIdFactory("cls");
  const extras: Program["sprites"][0]["scripts"] = [];
  for (const child of named(root)) {
    if (child.type === "class_specifier" || child.type === "struct_specifier") {
      extras.push({
        id: id(),
        x: 12,
        y: 16,
        root: lowerClass(child, id),
      });
    }
  }
  if (extras.length) {
    program.sprites[0].scripts = [...extras, ...program.sprites[0].scripts.filter((s) => s.root.opcode !== "cpp.class")];
  }
  program.stats.scripts = program.sprites[0].scripts.length;
  return program;
}

function lowerClass(node: Node, id: () => string): Block {
  const name = node.childForFieldName("name")?.text ?? "T";
  const bodyNode = node.childForFieldName("body");
  const members: Block[] = [];
  if (bodyNode) {
    for (const child of named(bodyNode)) {
      if (child.type === "access_specifier") {
        continue;
      }
      if (child.type === "field_declaration" || child.type === "declaration") {
        const type = collapse(child.childForFieldName("type")?.text ?? "int");
        const decl = child.childForFieldName("declarator") ?? named(child).find((n) => n.type.includes("declarator"));
        const varName = ident(decl) ?? "x";
        members.push(
          makeBlock(id, {
            opcode: "data.set",
            shape: "stack",
            category: "variables",
            line: `[${type} v] ${varName} :: variables`,
            fields: { type, var: varName },
            values: { value: litEmpty() },
            branches: {},
            source: span(child),
          }),
        );
      }
    }
  }
  return makeBlock(id, {
    opcode: "cpp.class",
    shape: "c",
    category: "custom",
    line: `class ${name} {`,
    closer: "} :: custom",
    fields: { name },
    values: {},
    branches: { body: chain(members) },
    source: span(node),
  });
}

function named(node: Node): Node[] {
  return (node.namedChildren ?? []).filter((n): n is Node => n != null && n.isNamed);
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function ident(node: Node | null | undefined): string | undefined {
  if (!node) {
    return undefined;
  }
  if (node.type === "identifier" || node.type === "field_identifier") {
    return node.text;
  }
  return ident(node.childForFieldName("declarator") ?? named(node)[0]);
}

function span(node: Node): SourceSpan {
  return {
    start: { line: node.startPosition.row, column: node.startPosition.column, offset: node.startIndex },
    end: { line: node.endPosition.row, column: node.endPosition.column, offset: node.endIndex },
  };
}
