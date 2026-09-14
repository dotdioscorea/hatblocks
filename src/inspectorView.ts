import * as vscode from "vscode";
import type { HatblocksHub } from "./hub";
import type { InspectorToHost } from "./protocol";
import { webviewHtml } from "./webviewHtml";

export class HatblocksInspectorProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly hub: HatblocksHub,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist")],
    };
    view.webview.html = webviewHtml(view.webview, this.context.extensionUri, "inspector.js");
    this.hub.setInspector(view.webview);

    view.webview.onDidReceiveMessage((msg: InspectorToHost) => {
      switch (msg.type) {
        case "ready":
          this.hub.refreshInspector();
          break;
        case "mutate":
          this.hub.applyMutation(msg.mutation);
          break;
      }
    });

    view.onDidDispose(() => {
      this.hub.setInspector(undefined);
    });
  }
}
