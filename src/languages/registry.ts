import type { LanguageAdapter } from "./types";
import { matchesDocument } from "./types";
import { cAdapter } from "./c/adapter";

const adapters: LanguageAdapter[] = [cAdapter];

export function registerLanguage(adapter: LanguageAdapter): void {
  const exists = adapters.some((a) => a.id === adapter.id);
  if (!exists) {
    adapters.push(adapter);
  }
}

export function allLanguages(): LanguageAdapter[] {
  return [...adapters];
}

export function adapterFor(doc: { languageId: string; fileName: string }): LanguageAdapter | undefined {
  return adapters.find((a) => matchesDocument(a, doc));
}
