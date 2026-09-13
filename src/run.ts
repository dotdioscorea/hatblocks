import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";

export async function runCDocument(document: vscode.TextDocument): Promise<void> {
  if (document.isDirty) {
    await document.save();
  }
  const compiler = await findCompiler();
  if (!compiler) {
    void vscode.window.showErrorMessage("Hatblocks needs clang or gcc on PATH to run the green flag.");
    return;
  }
  const out = join(tmpdir(), `hatblocks-${hash(document.uri.fsPath)}`);
  const quotedSrc = quote(document.uri.fsPath);
  const quotedOut = quote(out);
  const term = vscode.window.createTerminal({ name: "Hatblocks" });
  term.show(true);
  term.sendText(`${quote(compiler)} -std=c11 -O0 -o ${quotedOut} ${quotedSrc} && ${quotedOut}`);
}

async function findCompiler(): Promise<string | undefined> {
  for (const cmd of ["clang", "gcc", "cc"]) {
    if (await existsOnPath(cmd)) {
      return cmd;
    }
  }
  return undefined;
}

function existsOnPath(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("which", [cmd]);
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function hash(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16);
}
