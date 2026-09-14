import * as vscode from "vscode";
import type { HatblocksHub } from "./hub";
import { blocksModeEnabled, toggleBlocksMode } from "./mode";
import type { ToolboxToHost } from "./protocol";
import { webviewHtml } from "./webviewHtml";
import { cloneBlock } from "./ir/clone";
import { createIdFactory } from "./ir/ids";

export class HatblocksToolboxProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly hub: HatblocksHub,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist")],
    };
    view.webview.html = webviewHtml(view.webview, this.context.extensionUri, "toolbox.js");
    this.hub.setToolbox(view.webview);

    view.webview.onDidReceiveMessage(async (msg: ToolboxToHost) => {
      switch (msg.type) {
        case "ready":
          this.hub.refreshToolbox(undefined, blocksModeEnabled());
          break;
        case "toggleMode":
          await toggleBlocksMode();
          this.hub.refreshToolbox(undefined, blocksModeEnabled());
          break;
        case "dragStart":
          this.hub.beginLibraryDrag(cloneBlock(msg.block, createIdFactory("ins")));
          break;
        case "insert": {
          const block = cloneBlock(msg.block, createIdFactory("ins"));
          const ok = this.hub.insertIntoActive(block);
          if (!ok) {
            void vscode.window.showInformationMessage("Open a supported file in Blocks mode, then drag a part onto the stage.");
          }
          break;
        }
      }
    });

    view.onDidDispose(() => {
      this.hub.setToolbox(undefined);
    });
  }
}


