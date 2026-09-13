import * as vscode from "vscode";
import { emitDocument, parseDocument } from "./parse";
import type { HatblocksHub } from "./hub";
import { EDITOR_VIEW_TYPE } from "./mode";
import type { EditorToHost } from "./protocol";
import { runCDocument } from "./run";
import { webviewHtml } from "./webviewHtml";
import { blocksModeEnabled } from "./mode";

export class HatblocksEditorProvider implements vscode.CustomTextEditorProvider {
  static register(context: vscode.ExtensionContext, hub: HatblocksHub): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      EDITOR_VIEW_TYPE,
      new HatblocksEditorProvider(context, hub),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      },
    );
  }

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly hub: HatblocksHub,
  ) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "dist"),
        vscode.Uri.joinPath(this.context.extensionUri, "media"),
      ],
    };
    panel.webview.html = webviewHtml(panel.webview, this.context.extensionUri, "editor.js");

    let applying = false;
    let ready = false;

    const session = {
      uri: document.uri,
      webview: panel.webview,
      post: (msg: { type: string }) => {
        void panel.webview.postMessage(msg);
      },
    };
    const disposeEditor = this.hub.registerEditor(session);

    const sendProgram = async (): Promise<void> => {
      const program = await parseDocument(this.context, document);
      panel.webview.postMessage({ type: "setProgram", program });
      this.hub.refreshToolbox(program, blocksModeEnabled(), document.fileName);
    };

    const subs = [
      panel.webview.onDidReceiveMessage(async (msg: EditorToHost) => {
        switch (msg.type) {
          case "ready":
            ready = true;
            await sendProgram();
            break;
          case "programChanged": {
            const text = emitDocument(document, msg.program);
            if (text === undefined || text === document.getText()) {
              break;
            }
            applying = true;
            const edit = new vscode.WorkspaceEdit();
            const full = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
            edit.replace(document.uri, full, text);
            await vscode.workspace.applyEdit(edit);
            applying = false;
            this.hub.refreshToolbox(msg.program, blocksModeEnabled(), document.fileName);
            break;
          }
          case "run":
            await runCDocument(document);
            break;
          case "exportPng":
            await savePng(msg.dataUrl, document);
            break;
          case "reveal":
            break;
        }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() !== document.uri.toString()) {
          return;
        }
        if (applying || !ready) {
          return;
        }
        void sendProgram();
      }),
      panel.onDidChangeViewState((e) => {
        if (e.webviewPanel.active) {
          void vscode.commands.executeCommand("setContext", "hatblocks.editorFocus", true);
        }
      }),
      panel.onDidDispose(() => {
        disposeEditor.dispose();
      }),
    ];

    panel.onDidDispose(() => {
      for (const s of subs) {
        s.dispose();
      }
    });
  }
}

async function savePng(dataUrl: string, document: vscode.TextDocument): Promise<void> {
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!match) {
    return;
  }
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(`${document.fileName}.png`),
    filters: { PNG: ["png"] },
  });
  if (!uri) {
    return;
  }
  await vscode.workspace.fs.writeFile(uri, Buffer.from(match[1], "base64"));
}
