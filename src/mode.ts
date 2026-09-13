import * as vscode from "vscode";
import { adapterFor } from "./languages/registry";

export const EDITOR_VIEW_TYPE = "hatblocks.editor";

const ASSOCIATIONS = ["*.c", "*.h"] as const;

export function isSupportedUri(uri: vscode.Uri): boolean {
  const name = uri.fsPath.toLowerCase();
  return name.endsWith(".c") || name.endsWith(".h");
}

export function isSupportedDocument(doc: { languageId: string; fileName: string }): boolean {
  return Boolean(adapterFor(doc));
}

export function blocksModeEnabled(): boolean {
  return vscode.workspace.getConfiguration("hatblocks").get<boolean>("blocksMode", false);
}

export async function setBlocksMode(on: boolean): Promise<void> {
  const config = vscode.workspace.getConfiguration("hatblocks");
  const target = vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  await config.update("blocksMode", on, target);
  await syncEditorAssociations(on, target);
  await vscode.commands.executeCommand("setContext", "hatblocks.blocksMode", on);
  await convertOpenTabs(on);
}

export async function toggleBlocksMode(): Promise<boolean> {
  const next = !blocksModeEnabled();
  await setBlocksMode(next);
  return next;
}

export async function syncEditorAssociations(on: boolean, target: vscode.ConfigurationTarget): Promise<void> {
  const wb = vscode.workspace.getConfiguration("workbench");
  const inspect = wb.inspect<Record<string, string>>("editorAssociations");
  const base =
    target === vscode.ConfigurationTarget.Workspace
      ? { ...(inspect?.workspaceValue ?? inspect?.globalValue ?? {}) }
      : { ...(inspect?.globalValue ?? {}) };
  const next = { ...base };
  for (const pattern of ASSOCIATIONS) {
    if (on) {
      next[pattern] = EDITOR_VIEW_TYPE;
    } else if (next[pattern] === EDITOR_VIEW_TYPE) {
      delete next[pattern];
    }
  }
  await wb.update("editorAssociations", next, target);
}

export async function convertOpenTabs(on: boolean): Promise<void> {
  const viewType = on ? EDITOR_VIEW_TYPE : "default";
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const uri = uriOfTab(tab);
      if (!uri || !isSupportedUri(uri)) {
        continue;
      }
      const isBlocks = tab.input instanceof vscode.TabInputCustom && tab.input.viewType === EDITOR_VIEW_TYPE;
      const isText = tab.input instanceof vscode.TabInputText;
      if (on && !isBlocks) {
        await vscode.commands.executeCommand("vscode.openWith", uri, EDITOR_VIEW_TYPE, {
          viewColumn: group.viewColumn,
          preserveFocus: true,
          preview: tab.isPreview,
        });
      } else if (!on && (isBlocks || (!isText && isSupportedUri(uri)))) {
        await vscode.commands.executeCommand("vscode.openWith", uri, "default", {
          viewColumn: group.viewColumn,
          preserveFocus: true,
          preview: tab.isPreview,
        });
      }
    }
  }
}

function uriOfTab(tab: vscode.Tab): vscode.Uri | undefined {
  const input = tab.input;
  if (input instanceof vscode.TabInputText) {
    return input.uri;
  }
  if (input instanceof vscode.TabInputCustom) {
    return input.uri;
  }
  return undefined;
}
