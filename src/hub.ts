import * as vscode from "vscode";
import type { Block, Program } from "./ir/types";
import { defaultToolbox } from "./library/catalog";
import type { HostToEditor, HostToToolbox } from "./protocol";

export interface EditorSession {
  readonly uri: vscode.Uri;
  readonly webview: vscode.Webview;
  post(msg: HostToEditor): void;
}

export class HatblocksHub {
  private readonly editors = new Map<string, EditorSession>();
  private toolbox: vscode.Webview | undefined;
  private dragPayload: Block | undefined;

  registerEditor(session: EditorSession): vscode.Disposable {
    this.editors.set(session.uri.toString(), session);
    return new vscode.Disposable(() => {
      const current = this.editors.get(session.uri.toString());
      if (current === session) {
        this.editors.delete(session.uri.toString());
      }
    });
  }

  setToolbox(webview: vscode.Webview | undefined): void {
    this.toolbox = webview;
  }

  activeEditor(): EditorSession | undefined {
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (uri && this.editors.has(uri.toString())) {
      return this.editors.get(uri.toString());
    }
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const input = tab?.input;
    if (input instanceof vscode.TabInputCustom) {
      return this.editors.get(input.uri.toString());
    }
    return [...this.editors.values()][0];
  }

  beginLibraryDrag(block: Block): void {
    this.dragPayload = block;
    const editor = this.activeEditor();
    editor?.post({ type: "libraryDrag", block });
  }

  takeLibraryDrag(): Block | undefined {
    const block = this.dragPayload;
    this.dragPayload = undefined;
    return block;
  }

  insertIntoActive(block: Block): boolean {
    const editor = this.activeEditor();
    if (!editor) {
      return false;
    }
    editor.post({ type: "insert", block });
    return true;
  }

  postToolbox(msg: HostToToolbox): void {
    void this.toolbox?.postMessage(msg);
  }

  refreshToolbox(program: Program | undefined, blocksMode: boolean, fileName?: string): void {
    const payload =
      program ??
      ({
        language: "c",
        fileName: fileName ?? "",
        sprites: [],
        toolbox: defaultToolbox(),
        diagnostics: [],
        stats: { scripts: 0, blocks: 0, truncated: false },
      } satisfies Program);
    this.postToolbox({ type: "setToolbox", program: payload, blocksMode, fileName });
  }
}
