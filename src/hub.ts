import * as vscode from "vscode";
import type { Block, Program } from "./ir/types";
import { defaultToolbox } from "./library/catalog";
import type { HostToEditor, HostToInspector, HostToToolbox, InspectorMutation, InspectorState } from "./protocol";

export interface EditorSession {
  readonly uri: vscode.Uri;
  readonly webview: vscode.Webview;
  post(msg: HostToEditor): void;
}

export class HatblocksHub {
  private readonly editors = new Map<string, EditorSession>();
  private toolbox: vscode.Webview | undefined;
  private inspector: vscode.Webview | undefined;
  private dragPayload: Block | undefined;
  private selection: InspectorState = { language: "c", block: null };

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

  setInspector(webview: vscode.Webview | undefined): void {
    this.inspector = webview;
    if (webview) {
      this.refreshInspector();
    }
  }

  private readonly programs = new Map<string, Program>();

  setProgram(uri: vscode.Uri, program: Program): void {
    this.programs.set(uri.toString(), program);
  }

  activeEditor(): EditorSession | undefined {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const input = tab?.input;
    if (input instanceof vscode.TabInputCustom) {
      return this.editors.get(input.uri.toString());
    }
    if (input instanceof vscode.TabInputText) {
      return this.editors.get(input.uri.toString());
    }
    return undefined;
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

  refreshForActive(blocksMode: boolean): void {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const input = tab?.input;
    const uri =
      input instanceof vscode.TabInputCustom
        ? input.uri
        : input instanceof vscode.TabInputText
          ? input.uri
          : undefined;
    const program = uri ? this.programs.get(uri.toString()) : undefined;
    const fileName = uri?.fsPath.split(/[\\/]/).pop();
    this.refreshToolbox(program, blocksMode, fileName);
  }

  setSelection(state: InspectorState): void {
    this.selection = state;
    this.refreshInspector();
  }

  refreshInspector(): void {
    const msg: HostToInspector = { type: "setSelection", state: this.selection };
    void this.inspector?.postMessage(msg);
  }

  applyMutation(mutation: InspectorMutation): void {
    this.activeEditor()?.post({ type: "applyMutation", mutation });
  }
}
