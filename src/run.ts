import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";

export async function runCDocument(document: vscode.TextDocument): Promise<void> {
  if (document.isDirty) {
    await document.save();
  }
  const src = quote(document.uri.fsPath);
  const term = vscode.window.createTerminal({ name: "Hatblocks" });
  term.show(true);
  if (document.languageId === "python" || document.fileName.endsWith(".py")) {
    term.sendText(`python3 ${src}`);
    return;
  }
  const isCpp =
    document.languageId === "cpp" ||
    /\.(cpp|cc|cxx|hpp|hh)$/i.test(document.fileName);
  const compiler = await findCompiler(isCpp);
  if (!compiler) {
    void vscode.window.showErrorMessage(
      isCpp ? "Hatblocks needs clang++ or g++ on PATH." : "Hatblocks needs clang or gcc on PATH.",
    );
    return;
  }
  const out = quote(join(tmpdir(), `hatblocks-${hash(document.uri.fsPath)}`));
  const std = isCpp ? "-std=c++17" : "-std=c11";
  term.sendText(`${quote(compiler)} ${std} -O0 -o ${out} ${src} && ${out}`);
}

async function findCompiler(cpp: boolean): Promise<string | undefined> {
  const cmds = cpp ? ["clang++", "g++"] : ["clang", "gcc", "cc"];
  for (const cmd of cmds) {
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
