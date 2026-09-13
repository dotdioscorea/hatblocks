import type { ParseOptions, Program } from "../ir/types";

export interface LanguageAdapter {
  readonly id: string;
  readonly name: string;
  readonly vscodeLanguageIds: string[];
  readonly extensions: string[];
  parse(source: string, options: ParseOptions): Promise<Program>;
  emit?(program: Program): string;
}

export function matchesDocument(
  adapter: LanguageAdapter,
  doc: { languageId: string; fileName: string },
): boolean {
  if (adapter.vscodeLanguageIds.includes(doc.languageId)) {
    return true;
  }
  const lower = doc.fileName.toLowerCase();
  return adapter.extensions.some((ext) => lower.endsWith(ext));
}
