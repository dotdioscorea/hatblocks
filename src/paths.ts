import { join } from "node:path";

export function wasmDirFrom(extensionPath: string): string {
  return join(extensionPath, "wasm");
}
