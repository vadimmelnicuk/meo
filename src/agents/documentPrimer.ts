import * as vscode from 'vscode';
import { isMarkdownDocumentPath } from '../shared/extensionConfig';
import type { AgentReviewOverrideController } from './reviewOverrides';

const NATIVE_INIT_SETTLE_MS = 50;

type AgentReviewDocumentPrimerDeps = {
  getComparableResourceKey: (uri: vscode.Uri) => string | undefined;
  getOpenTextDocumentForUri: (uri: vscode.Uri) => vscode.TextDocument | undefined;
  overrides: AgentReviewOverrideController;
};

export class AgentReviewDocumentPrimer {
  private readonly primedKeys = new Set<string>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private primingDepth = 0;

  constructor(private readonly deps: AgentReviewDocumentPrimerDeps) {}

  get isPriming(): boolean {
    return this.primingDepth > 0;
  }

  async ensureReady(uri: vscode.Uri, options?: { forceNative?: boolean }): Promise<void> {
    if (!isMarkdownFileUri(uri)) {
      return;
    }

    const key = this.getKey(uri);
    if (!key) {
      return;
    }

    const forceNative = options?.forceNative === true;
    if (!forceNative && this.primedKeys.has(key) && this.deps.getOpenTextDocumentForUri(uri)) {
      return;
    }

    const existing = this.inFlight.get(key);
    if (existing) {
      await existing;
      if (!forceNative || this.primedKeys.has(key)) {
        return;
      }
    }

    const run = this.prime(uri, key, forceNative);
    this.inFlight.set(key, run);
    try {
      await run;
    } finally {
      if (this.inFlight.get(key) === run) {
        this.inFlight.delete(key);
      }
    }
  }

  private async prime(uri: vscode.Uri, key: string, forceNative: boolean): Promise<void> {
    this.primingDepth += 1;
    const shouldPin = forceNative;
    if (shouldPin) {
      this.deps.overrides.pinFile(uri);
    }

    try {
      if (shouldPin) {
        await this.deps.overrides.syncNow();
      }

      try {
        await vscode.workspace.openTextDocument(uri);
      } catch {
        // Cursor may refuse to sync the document to the extension host.
      }

      const needsNative = isCursorHost() && forceNative && !this.hasOpenNativeOrCustomTabForKey(key);
      if (needsNative) {
        await this.initializeViaDefaultEditor(uri, key);
        try {
          await vscode.workspace.openTextDocument(uri);
        } catch {
          // Native open can still leave the file unsyncable; the custom editor
          // can load it from disk instead.
        }
      }

      this.primedKeys.add(key);
    } finally {
      if (shouldPin) {
        this.deps.overrides.unpinFile(uri);
        this.deps.overrides.scheduleSync();
      }
      this.primingDepth -= 1;
    }
  }

  private async initializeViaDefaultEditor(uri: vscode.Uri, key: string): Promise<void> {
    const nativeBefore = this.findNativeTextTabs(key);
    try {
      await vscode.commands.executeCommand('vscode.openWith', uri, 'default', {
        preview: true,
        preserveFocus: true
      });
    } catch {
      return;
    }

    await delay(NATIVE_INIT_SETTLE_MS);

    const opened = this.findNativeTextTabs(key).filter((tab) => !nativeBefore.includes(tab));
    if (opened.length === 0) {
      return;
    }

    try {
      await vscode.window.tabGroups.close(opened, true);
    } catch {
      // Closing the priming tab is best-effort.
    }
  }

  private hasOpenNativeOrCustomTabForKey(key: string): boolean {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (!(input instanceof vscode.TabInputText) && !(input instanceof vscode.TabInputCustom)) {
          continue;
        }
        if (this.deps.getComparableResourceKey(input.uri) === key) {
          return true;
        }
      }
    }

    return false;
  }

  private findNativeTextTabs(key: string): vscode.Tab[] {
    const matches: vscode.Tab[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (!(input instanceof vscode.TabInputText)) {
          continue;
        }
        if (this.deps.getComparableResourceKey(input.uri) === key) {
          matches.push(tab);
        }
      }
    }
    return matches;
  }

  private getKey(uri: vscode.Uri): string | undefined {
    return this.deps.getComparableResourceKey(uri) ?? uri.with({ fragment: '' }).toString();
  }
}

export function isMarkdownFileUri(uri: vscode.Uri): boolean {
  if (uri.scheme !== 'file') {
    return false;
  }

  const targetPath = (uri.path || uri.fsPath || '').toLowerCase();
  return isMarkdownDocumentPath(targetPath);
}

function isCursorHost(): boolean {
  return /cursor/i.test(vscode.env.appName);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
