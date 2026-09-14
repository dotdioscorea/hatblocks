import * as vscode from "vscode";
import { HatblocksEditorProvider } from "./editor";
import { HatblocksHub } from "./hub";
import { blocksModeEnabled, convertOpenTabs, setBlocksMode, syncEditorAssociations, toggleBlocksMode } from "./mode";
import { runCDocument } from "./run";
import { HatblocksToolboxProvider } from "./toolboxView";
import { HatblocksInspectorProvider } from "./inspectorView";

export function activate(context: vscode.ExtensionContext): void {
  const hub = new HatblocksHub();
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 80);
  status.command = "hatblocks.toggleMode";
  status.name = "Hatblocks";

  const refreshStatus = (): void => {
    const on = blocksModeEnabled();
    status.text = on ? "$(play) Hatblocks: Blocks" : "$(file-code) Hatblocks: Text";
    status.tooltip = on
      ? "C files open as Scratch-style blocks. Click to switch back to text."
      : "Click to edit C files as Scratch-style blocks.";
    status.show();
    void vscode.commands.executeCommand("setContext", "hatblocks.blocksMode", on);
  };

  refreshStatus();
  if (blocksModeEnabled()) {
    const target = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
    void (async () => {
      await syncEditorAssociations(true, target);
      await convertOpenTabs(true);
    })();
  }

  context.subscriptions.push(
    status,
    HatblocksEditorProvider.register(context, hub),
    vscode.window.registerWebviewViewProvider("hatblocks.toolbox", new HatblocksToolboxProvider(context, hub)),
    vscode.window.registerWebviewViewProvider("hatblocks.inspector", new HatblocksInspectorProvider(context, hub)),
    vscode.commands.registerCommand("hatblocks.toggleMode", async () => {
      const on = await toggleBlocksMode();
      refreshStatus();
      hub.refreshToolbox(undefined, on);
      void vscode.window.showInformationMessage(on ? "Hatblocks: Blocks mode on." : "Hatblocks: Text mode on.");
    }),
    vscode.commands.registerCommand("hatblocks.run", async () => {
      const doc = await activeCDocument();
      if (!doc) {
        void vscode.window.showInformationMessage("Open a C file to run the green flag.");
        return;
      }
      await runCDocument(doc);
    }),
    vscode.commands.registerCommand("hatblocks.exportPng", () => {
      hub.activeEditor()?.post({ type: "requestExport" });
    }),
    vscode.commands.registerCommand("hatblocks.openDemo", async () => {
      const demo = vscode.Uri.joinPath(context.extensionUri, "examples", "fizzbuzz.c");
      const doc = await vscode.workspace.openTextDocument(demo);
      await vscode.window.showTextDocument(doc, { preview: false });
      if (!blocksModeEnabled()) {
        await setBlocksMode(true);
        refreshStatus();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("hatblocks.blocksMode")) {
        refreshStatus();
        hub.refreshToolbox(undefined, blocksModeEnabled());
      }
    }),
  );
}

export function deactivate(): void {}

async function activeCDocument(): Promise<vscode.TextDocument | undefined> {
  const active = vscode.window.activeTextEditor?.document;
  if (active && ["c", "cpp", "python"].includes(active.languageId)) {
    return active;
  }
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (tab instanceof vscode.TabInputCustom) {
    return vscode.workspace.openTextDocument(tab.uri);
  }
  if (tab instanceof vscode.TabInputText) {
    return vscode.workspace.openTextDocument(tab.uri);
  }
  return undefined;
}
