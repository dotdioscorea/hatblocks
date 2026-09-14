import * as vscode from "vscode";
import type { HatblocksHub } from "./hub";
import { activeSupportedFile, type HatblocksMode } from "./mode";
import type { ToolboxToHost } from "./protocol";
import { webviewHtml } from "./webviewHtml";
import { cloneBlock } from "./ir/clone";
import { createIdFactory } from "./ir/ids";

export class HatblocksToolboxProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly hub: HatblocksHub,
    private readonly mode: HatblocksMode,
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
        case "ready": {
          const file = activeSupportedFile();
          this.hub.refreshForActive(file?.isBlocks ?? false);
          break;
        }
        case "toggleMode":
          await this.mode.toggleActive();
          this.hub.refreshForActive(activeSupportedFile()?.isBlocks ?? false);
          break;
        case "dragStart":
          this.hub.beginLibraryDrag(cloneBlock(msg.block, createIdFactory("ins")));
          break;
        case "insert": {
          const block = cloneBlock(msg.block, createIdFactory("ins"));
          const ok = this.hub.insertIntoActive(block);
          if (!ok) {
            void vscode.window.showInformationMessage("Open this file in Blocks mode, then drag a part onto the stage.");
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
