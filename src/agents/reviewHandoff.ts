import * as vscode from 'vscode';

export const AGENT_REVIEW_REOPEN_ON_CLOSE_DELAY_MS = 200;
export const AGENT_REVIEW_FILE_OVERRIDE_CLEANUP_DELAY_MS = 350;
export const AGENT_REVIEW_POST_REOPEN_DEDUP_DELAY_MS = 450;

const RECENT_TEXT_DIFF_ACTIVITY_WINDOW_MS = 1500;
const RECENT_MEO_OWNED_FILE_CHANGE_WINDOW_MS = 1000;
const PENDING_MEO_TAB_DEDUP_WINDOW_MS = 1200;

type AgentReviewHandoffDeps = {
  viewType: string;
  getComparableResourceKey: (uri: vscode.Uri) => string | undefined;
  getOpenTextDocumentForUri: (uri: vscode.Uri) => vscode.TextDocument | undefined;
  hasLikelyReviewState: (targetUri: vscode.Uri, targetText?: string) => boolean;
};

export class AgentReviewHandoffController {
  private readonly deferredReopenTargets = new Map<string, vscode.Uri>();
  private deferredReopenFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly recentTextDiffActivityByKey = new Map<string, number>();
  private readonly recentMEOOwnedFileChangeByKey = new Map<string, number>();
  private readonly pendingMEOtabDedupByKey = new Map<string, { uri: vscode.Uri; expiresAt: number }>();

  constructor(private readonly deps: AgentReviewHandoffDeps) {}

  hasPendingDeferredReopens(): boolean {
    return this.deferredReopenTargets.size > 0;
  }

  hasRecentTextDiffActivityForUri(targetUri: vscode.Uri): boolean {
    const key = this.getDeferredReopenKey(targetUri);
    if (!key) {
      return false;
    }

    const expiresAt = this.recentTextDiffActivityByKey.get(key);
    if (!expiresAt) {
      return false;
    }

    if (expiresAt <= Date.now()) {
      this.recentTextDiffActivityByKey.delete(key);
      return false;
    }

    return true;
  }

  hasRecentMEOOwnedFileChangeForUri(targetUri: vscode.Uri): boolean {
    const key = this.getDeferredReopenKey(targetUri);
    if (!key) {
      return false;
    }

    const expiresAt = this.recentMEOOwnedFileChangeByKey.get(key);
    if (!expiresAt) {
      return false;
    }

    if (expiresAt <= Date.now()) {
      this.recentMEOOwnedFileChangeByKey.delete(key);
      return false;
    }

    return true;
  }

  hasOpenTextDiffTabForUri(targetUri: vscode.Uri): boolean {
    const targetKey = this.deps.getComparableResourceKey(targetUri);
    if (!targetKey) {
      return false;
    }

    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (!(input instanceof vscode.TabInputTextDiff)) {
          continue;
        }

        if (
          this.deps.getComparableResourceKey(input.original) === targetKey ||
          this.deps.getComparableResourceKey(input.modified) === targetKey
        ) {
          return true;
        }
      }
    }

    return false;
  }

  noteRecentTextDiffActivity(tabs: readonly vscode.Tab[]): void {
    for (const tab of tabs) {
      const input = tab.input;
      if (!(input instanceof vscode.TabInputTextDiff)) {
        continue;
      }
      this.noteRecentTextDiffActivityForUri(input.original);
      this.noteRecentTextDiffActivityForUri(input.modified);
    }
  }

  noteRecentMEOOwnedFileChangeForUri(targetUri: vscode.Uri): void {
    const key = this.getDeferredReopenKey(targetUri);
    if (!key) {
      return;
    }

    this.recentMEOOwnedFileChangeByKey.set(key, Date.now() + RECENT_MEO_OWNED_FILE_CHANGE_WINDOW_MS);
  }

  notePendingMEOtabDedup(targetUri: vscode.Uri): void {
    const key = this.getDeferredReopenKey(targetUri);
    if (!key) {
      return;
    }

    this.pendingMEOtabDedupByKey.set(key, {
      uri: targetUri,
      expiresAt: Date.now() + PENDING_MEO_TAB_DEDUP_WINDOW_MS
    });
  }

  scheduleMEOtabDedup(targetUri: vscode.Uri, delayMs: number): void {
    setTimeout(() => {
      void this.deduplicateMEOtabs(targetUri);
    }, delayMs);
  }

  async flushPendingMEOtabDedups(): Promise<void> {
    const now = Date.now();

    for (const [key, entry] of Array.from(this.pendingMEOtabDedupByKey.entries())) {
      if (entry.expiresAt <= now) {
        this.pendingMEOtabDedupByKey.delete(key);
        continue;
      }

      await this.deduplicateMEOtabs(entry.uri);
    }
  }

  scheduleDeferredReopen(targetUri: vscode.Uri): void {
    const key = this.getDeferredReopenKey(targetUri);
    if (!key) {
      return;
    }

    this.deferredReopenTargets.set(key, targetUri);
  }

  shouldReevaluateDeferredReopen(changedUri: vscode.Uri, isAgentVirtualUri: boolean): boolean {
    if (this.deferredReopenTargets.size === 0) {
      return false;
    }

    if (isAgentVirtualUri) {
      return true;
    }

    const changedKey = this.getDeferredReopenKey(changedUri);
    if (!changedKey) {
      return false;
    }

    return this.deferredReopenTargets.has(changedKey);
  }

  scheduleFlushDeferredReopens(delayMs = 50): void {
    if (this.deferredReopenFlushTimer) {
      clearTimeout(this.deferredReopenFlushTimer);
    }

    this.deferredReopenFlushTimer = setTimeout(() => {
      void this.flushDeferredReopens();
    }, delayMs);
  }

  async flushDeferredReopens(): Promise<void> {
    this.deferredReopenFlushTimer = null;
    let retryDelayMs: number | null = null;

    for (const [key, targetUri] of Array.from(this.deferredReopenTargets.entries())) {
      if (this.deps.hasLikelyReviewState(targetUri, this.deps.getOpenTextDocumentForUri(targetUri)?.getText())) {
        continue;
      }

      if (this.hasOpenMEOEditorForUri(targetUri)) {
        this.deferredReopenTargets.delete(key);
        continue;
      }

      if (this.hasOpenTextDiffTabForUri(targetUri)) {
        continue;
      }

      const recentTextDiffRetryDelayMs = this.getRecentTextDiffRetryDelayForUri(targetUri);
      if (recentTextDiffRetryDelayMs > 0) {
        retryDelayMs = retryDelayMs === null
          ? recentTextDiffRetryDelayMs
          : Math.min(retryDelayMs, recentTextDiffRetryDelayMs);
        continue;
      }

      this.deferredReopenTargets.delete(key);
      await this.reopenNativeTabInMEO(targetUri);
    }

    if (retryDelayMs !== null) {
      this.scheduleFlushDeferredReopens(Math.max(50, retryDelayMs + 25));
    }
  }

  private getDeferredReopenKey(targetUri: vscode.Uri): string | undefined {
    return this.deps.getComparableResourceKey(targetUri) ?? targetUri.with({ fragment: '' }).toString();
  }

  private noteRecentTextDiffActivityForUri(targetUri: vscode.Uri): void {
    const key = this.getDeferredReopenKey(targetUri);
    if (!key) {
      return;
    }

    this.recentTextDiffActivityByKey.set(key, Date.now() + RECENT_TEXT_DIFF_ACTIVITY_WINDOW_MS);
  }

  private getRecentTextDiffRetryDelayForUri(targetUri: vscode.Uri): number {
    const key = this.getDeferredReopenKey(targetUri);
    if (!key) {
      return 0;
    }

    const expiresAt = this.recentTextDiffActivityByKey.get(key);
    if (!expiresAt) {
      return 0;
    }

    const remainingMs = expiresAt - Date.now();
    if (remainingMs <= 0) {
      this.recentTextDiffActivityByKey.delete(key);
      return 0;
    }

    return remainingMs;
  }

  private hasOpenNativeTextTabForUri(targetUri: vscode.Uri): boolean {
    return this.findOpenNativeTextTabsForUri(targetUri).length > 0;
  }

  private findOpenNativeTextTabsForUri(targetUri: vscode.Uri): vscode.Tab[] {
    const targetKey = this.deps.getComparableResourceKey(targetUri);
    if (!targetKey) {
      return [];
    }

    const matches: vscode.Tab[] = [];

    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (!(input instanceof vscode.TabInputText)) {
          continue;
        }
        if (this.deps.getComparableResourceKey(input.uri) === targetKey) {
          matches.push(tab);
        }
      }
    }

    return matches;
  }

  private hasOpenMEOEditorForUri(targetUri: vscode.Uri): boolean {
    return this.findOpenMEOEditorTabsForUri(targetUri).length > 0;
  }

  private findOpenMEOEditorTabsForUri(targetUri: vscode.Uri): vscode.Tab[] {
    const targetKey = this.deps.getComparableResourceKey(targetUri);
    if (!targetKey) {
      return [];
    }

    const matches: vscode.Tab[] = [];

    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (!(input instanceof vscode.TabInputCustom) || input.viewType !== this.deps.viewType) {
          continue;
        }
        if (this.deps.getComparableResourceKey(input.uri) === targetKey) {
          matches.push(tab);
        }
      }
    }

    return matches;
  }

  private findPreferredMEOEditorTabForUri(targetUri: vscode.Uri): vscode.Tab | undefined {
    const tabs = this.findOpenMEOEditorTabsForUri(targetUri);
    return tabs.find((tab) => tab.isActive) ?? tabs[0];
  }

  private async reopenNativeTabInMEO(targetUri: vscode.Uri): Promise<void> {
    const nativeTabsBeforeOpen = this.findOpenNativeTextTabsForUri(targetUri);
    const primaryNativeTab = nativeTabsBeforeOpen.find((tab) => tab.isActive) ?? nativeTabsBeforeOpen[0];
    const openWithOptions = primaryNativeTab
      ? {
          viewColumn: primaryNativeTab.group.viewColumn,
          preserveFocus: false,
          preview: true
        }
      : undefined;

    await vscode.commands.executeCommand(
      'vscode.openWith',
      targetUri,
      this.deps.viewType,
      openWithOptions
    );

    const remainingNativeTabs = this.findOpenNativeTextTabsForUri(targetUri);
    if (remainingNativeTabs.length > 0) {
      await vscode.window.tabGroups.close(remainingNativeTabs, true);
    }

    await this.deduplicateMEOtabs(targetUri);
  }

  private async deduplicateMEOtabs(targetUri: vscode.Uri): Promise<void> {
    if (this.hasOpenNativeTextTabForUri(targetUri)) {
      return;
    }

    const preferredMEOtab = this.findPreferredMEOEditorTabForUri(targetUri);
    if (!preferredMEOtab) {
      return;
    }

    const duplicateMEOtabs = this.findOpenMEOEditorTabsForUri(targetUri).filter((tab) => tab !== preferredMEOtab);
    if (duplicateMEOtabs.length === 0) {
      return;
    }

    await vscode.window.tabGroups.close(duplicateMEOtabs, true);
  }
}
