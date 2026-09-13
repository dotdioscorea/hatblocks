import { join } from "node:path";
import { Parser, Language } from "web-tree-sitter";

let initOnce: Promise<void> | undefined;
const languages = new Map<string, Promise<Language>>();

export async function initTreeSitter(wasmDir: string): Promise<void> {
  if (!initOnce) {
    initOnce = Parser.init({
      locateFile: (scriptName: string) => join(wasmDir, scriptName),
    } as { locateFile: (scriptName: string) => string });
  }
  await initOnce;
}

export async function loadLanguage(wasmDir: string, filename: string): Promise<Language> {
  await initTreeSitter(wasmDir);
  const path = join(wasmDir, filename);
  let pending = languages.get(path);
  if (!pending) {
    pending = Language.load(path);
    languages.set(path, pending);
  }
  return pending;
}

export function createParser(language: Language): Parser {
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}
