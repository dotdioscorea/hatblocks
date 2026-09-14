export const VOID_CALLEES = new Set([
  "printf",
  "puts",
  "putchar",
  "scanf",
  "sscanf",
  "fscanf",
  "free",
  "exit",
  "abort",
  "perror",
  "memcpy",
  "memmove",
  "memset",
  "strcpy",
  "strncpy",
  "strcat",
  "strncat",
  "srand",
  "srandom",
  "qsort",
  "assert",
]);

export const IO_SAY = new Set(["printf", "puts", "putchar", "fprintf"]);

export const IO_ASK = new Set(["scanf", "fgets", "gets"]);

export function stripCString(raw: string): string {
  let s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  return s
    .replaceAll("\\n", " ")
    .replaceAll("\\t", " ")
    .replaceAll('\\"', '"')
    .replaceAll("\\'", "'")
    .replaceAll("\\\\", "\\")
    .trim();
}

export function headerName(raw: string): string {
  return raw.replace(/[<>"]/g, "").trim();
}
