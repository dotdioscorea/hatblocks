import * as vscode from "vscode";
import { HatblocksEditorProvider } from "./editor";
import { HatblocksHub } from "./hub";
import { HatblocksMode, activeSupportedFile, EDITOR_VIEW_TYPE } from "./mode";
import { runCDocument } from "./run";
import { HatblocksToolboxProvider } from "./toolboxView";
import { HatblocksInspectorProvider } from "./inspectorView";

export function activate(context: vscode.ExtensionContext): void {
  const hub = new HatblocksHub();
  const mode = new HatblocksMode(context);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 80);
  status.command = "hatblocks.toggleMode";
  status.name = "Hatblocks";

  const refreshChrome = (): void => {
    const file = activeSupportedFile();
    const on = file?.isBlocks ?? false;
    if (!file) {
      status.text = "$(file-code) Hatblocks";
      status.tooltip = "Open a C, C++, or Python file, then toggle this file to blocks.";
    } else if (on) {
      status.text = `$(play) Hatblocks: Blocks`;
      status.tooltip = `${file.fileName} is blocks. Click to edit this file as text.`;
    } else {
      status.text = `$(file-code) Hatblocks: Text`;
      status.tooltip = `${file.fileName} is text. Click to edit this file as blocks.`;
    }
    status.show();
    void vscode.commands.executeCommand("setContext", "hatblocks.blocksMode", on);
    hub.refreshForActive(on);
  };

  context.subscriptions.push(
    status,
    HatblocksEditorProvider.register(context, hub, mode),
    vscode.window.registerWebviewViewProvider("hatblocks.toolbox", new HatblocksToolboxProvider(context, hub, mode)),
    vscode.window.registerWebviewViewProvider("hatblocks.inspector", new HatblocksInspectorProvider(context, hub)),
    vscode.commands.registerCommand("hatblocks.toggleMode", async () => {
      await mode.toggleActive();
      refreshChrome();
    }),
    vscode.commands.registerCommand("hatblocks.run", async () => {
      const doc = await activeCDocument();
      if (!doc) {
        void vscode.window.showInformationMessage("Open a C, C++, or Python file to run the green flag.");
        return;
      }
      await runCDocument(doc);
    }),
    vscode.commands.registerCommand("hatblocks.exportPng", () => {
      hub.activeEditor()?.post({ type: "requestExport" });
    }),
    vscode.commands.registerCommand("hatblocks.openDemo", async () => {
      const demo = vscode.Uri.joinPath(context.extensionUri, "examples", "fizzbuzz.c");
      await vscode.commands.executeCommand("vscode.open", demo, { preview: false });
      await mode.remember(demo, true);
      await mode.reopen(demo, true, { preview: false });
      refreshChrome();
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        void mode.maybeRestore(editor.document.uri).then(() => refreshChrome());
        return;
      }
      refreshChrome();
    }),
    vscode.window.tabGroups.onDidChangeTabs(() => {
      refreshChrome();
    }),
    vscode.window.tabGroups.onDidChangeTabGroups(() => {
      refreshChrome();
    }),
  );

  void (async () => {
    await mode.clearLegacyGlobalMode();
    const file = activeSupportedFile();
    if (file && !file.isBlocks) {
      await mode.maybeRestore(file.uri);
    }
    refreshChrome();
  })();
}

export function deactivate(): void {}

async function activeCDocument(): Promise<vscode.TextDocument | undefined> {
  const file = activeSupportedFile();
  if (file) {
    return vscode.workspace.openTextDocument(file.uri);
  }
  const active = vscode.window.activeTextEditor?.document;
  if (active && ["c", "cpp", "python"].includes(active.languageId)) {
    return active;
  }
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (tab instanceof vscode.TabInputCustom && tab.viewType === EDITOR_VIEW_TYPE) {
    return vscode.workspace.openTextDocument(tab.uri);
  }
  if (tab instanceof vscode.TabInputText) {
    return vscode.workspace.openTextDocument(tab.uri);
  }
  return undefined;
}
