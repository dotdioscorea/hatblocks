import * as vscode from "vscode";
import { adapterFor } from "./languages/registry";

export const EDITOR_VIEW_TYPE = "hatblocks.editor";

const ASSOCIATIONS = ["*.c", "*.h", "*.cpp", "*.cc", "*.cxx", "*.hpp", "*.hh", "*.py"] as const;
const STATE_KEY = "hatblocks.blockUris";

export function isSupportedUri(uri: vscode.Uri): boolean {
  const name = uri.fsPath.toLowerCase();
  return ASSOCIATIONS.some((pat) => name.endsWith(pat.slice(1)));
}

export function isSupportedDocument(doc: { languageId: string; fileName: string }): boolean {
  return Boolean(adapterFor(doc));
}

export function uriOfTab(tab: vscode.Tab | undefined): vscode.Uri | undefined {
  const input = tab?.input;
  if (input instanceof vscode.TabInputText) {
    return input.uri;
  }
  if (input instanceof vscode.TabInputCustom) {
    return input.uri;
  }
  return undefined;
}

export function isBlocksTab(tab: vscode.Tab | undefined): boolean {
  const input = tab?.input;
  return input instanceof vscode.TabInputCustom && input.viewType === EDITOR_VIEW_TYPE;
}

export interface ActiveFile {
  uri: vscode.Uri;
  isBlocks: boolean;
  viewColumn: vscode.ViewColumn | undefined;
  preview: boolean;
  fileName: string;
}

export function activeSupportedFile(): ActiveFile | undefined {
  const group = vscode.window.tabGroups.activeTabGroup;
  const tab = group.activeTab;
  const uri = uriOfTab(tab);
  if (!uri || !isSupportedUri(uri)) {
    return undefined;
  }
  return {
    uri,
    isBlocks: isBlocksTab(tab),
    viewColumn: group.viewColumn,
    preview: tab?.isPreview ?? false,
    fileName: uri.fsPath.split(/[\\/]/).pop() ?? uri.fsPath,
  };
}

/** Per-file blocks/text. Never writes workbench.editorAssociations. */
export class HatblocksMode {
  private readonly switching = new Set<string>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  wantsBlocks(uri: vscode.Uri): boolean {
    return this.saved().has(uri.toString());
  }

  async remember(uri: vscode.Uri, on: boolean): Promise<void> {
    const set = this.saved();
    const key = uri.toString();
    if (on) {
      set.add(key);
    } else {
      set.delete(key);
    }
    await this.context.workspaceState.update(STATE_KEY, [...set]);
  }

  async toggleActive(): Promise<boolean | undefined> {
    const file = activeSupportedFile();
    if (!file) {
      void vscode.window.showInformationMessage("Open a C, C++, or Python file to toggle blocks.");
      return undefined;
    }
    const next = !file.isBlocks;
    await this.remember(file.uri, next);
    await this.reopen(file.uri, next, {
      viewColumn: file.viewColumn,
      preview: file.preview,
      preserveFocus: false,
    });
    return next;
  }

  async reopen(
    uri: vscode.Uri,
    blocks: boolean,
    opts: { viewColumn?: vscode.ViewColumn; preview?: boolean; preserveFocus?: boolean } = {},
  ): Promise<void> {
    const key = uri.toString();
    if (this.switching.has(key)) {
      return;
    }
    this.switching.add(key);
    try {
      const viewType = blocks ? EDITOR_VIEW_TYPE : "default";
      const column = opts.viewColumn ?? vscode.ViewColumn.Active;
      await vscode.commands.executeCommand("vscode.openWith", uri, viewType, {
        viewColumn: column,
        preview: opts.preview ?? false,
        preserveFocus: opts.preserveFocus ?? false,
      });
      await this.closeOtherRepresentations(uri, blocks);
      const still = activeSupportedFile();
      if (still?.uri.toString() !== key || still.isBlocks !== blocks) {
        await vscode.commands.executeCommand("vscode.openWith", uri, viewType, {
          viewColumn: column,
          preview: false,
          preserveFocus: opts.preserveFocus ?? false,
        });
      }
    } finally {
      this.switching.delete(key);
    }
  }

  /** If this file was last viewed as blocks but VS Code opened the text editor, flip only this tab. */
  async maybeRestore(uri: vscode.Uri): Promise<void> {
    if (!isSupportedUri(uri) || !this.wantsBlocks(uri) || this.switching.size > 0) {
      return;
    }
    const file = activeSupportedFile();
    if (!file || file.uri.toString() !== uri.toString() || file.isBlocks) {
      return;
    }
    await this.reopen(uri, true, {
      viewColumn: file.viewColumn,
      preview: file.preview,
      preserveFocus: false,
    });
  }

  /**
   * Old builds forced every *.c/*.py tab through editorAssociations.
   * Strip those so files open as text unless this file was toggled.
   */
  async clearLegacyGlobalMode(): Promise<void> {
    const wb = vscode.workspace.getConfiguration("workbench");
    const inspect = wb.inspect<Record<string, string>>("editorAssociations");
    const targets: Array<[vscode.ConfigurationTarget, Record<string, string> | undefined]> = [
      [vscode.ConfigurationTarget.Workspace, inspect?.workspaceValue],
      [vscode.ConfigurationTarget.Global, inspect?.globalValue],
    ];
    for (const [target, value] of targets) {
      if (!value) {
        continue;
      }
      const next = { ...value };
      let changed = false;
      for (const pattern of ASSOCIATIONS) {
        if (next[pattern] === EDITOR_VIEW_TYPE) {
          delete next[pattern];
          changed = true;
        }
      }
      if (changed) {
        await wb.update("editorAssociations", Object.keys(next).length ? next : undefined, target);
      }
    }
    const hat = vscode.workspace.getConfiguration("hatblocks");
    if (hat.inspect<boolean>("blocksMode")?.workspaceValue !== undefined) {
      await hat.update("blocksMode", undefined, vscode.ConfigurationTarget.Workspace);
    }
  }

  private async closeOtherRepresentations(uri: vscode.Uri, blocks: boolean): Promise<void> {
    const key = uri.toString();
    const leftovers: vscode.Tab[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (uriOfTab(tab)?.toString() !== key) {
          continue;
        }
        if (tab === group.activeTab && isBlocksTab(tab) === blocks) {
          continue;
        }
        const isBlocks = isBlocksTab(tab);
        const isText = tab.input instanceof vscode.TabInputText;
        if (blocks && isText) {
          leftovers.push(tab);
        }
        if (!blocks && isBlocks) {
          leftovers.push(tab);
        }
      }
    }
    if (leftovers.length) {
      await vscode.window.tabGroups.close(leftovers, true);
    }
  }

  private saved(): Set<string> {
    return new Set(this.context.workspaceState.get<string[]>(STATE_KEY, []));
  }
}
