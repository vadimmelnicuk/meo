import * as path from 'node:path';
import * as vscode from 'vscode';

const REVIEW_FILE_OVERRIDE_STATE_KEY = 'copilotReviewNativeFileOverrides';

type AgentReviewOverrideDeps = {
  getComparableResourceKey: (uri: vscode.Uri) => string | undefined;
  getOpenTextDocumentForComparableKey: (targetKey: string) => vscode.TextDocument | undefined;
  isLikelyAgentReviewUri: (uri: vscode.Uri) => boolean;
};

export class AgentReviewOverrideController {
  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly deps: AgentReviewOverrideDeps
  ) {}

  scheduleSync(delayMs = 50): void {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
    }

    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      void this.syncNow();
    }, delayMs);
  }

  async syncNow(): Promise<void> {
    const config = vscode.workspace.getConfiguration('workbench');
    const current = {
      ...(config.get<Record<string, string>>('editorAssociations') || {})
    };
    const previousKeys = new Set(this.context.workspaceState.get<string[]>(REVIEW_FILE_OVERRIDE_STATE_KEY, []));
    const nextKeys = this.collectOverrideKeys();
    const changed = this.applyOverrideAssociations(current, previousKeys, nextKeys);

    if (changed) {
      await config.update('editorAssociations', current, this.getConfigurationTarget());
    }

    const previousList = this.getSortedValues(previousKeys);
    const nextList = this.getSortedValues(nextKeys);
    if (this.haveSameValues(previousList, nextList)) {
      return;
    }

    await this.context.workspaceState.update(REVIEW_FILE_OVERRIDE_STATE_KEY, nextList);
  }

  private collectOverrideKeys(): Set<string> {
    const keys = new Set<string>();

    for (const document of vscode.workspace.textDocuments) {
      if (!this.deps.isLikelyAgentReviewUri(document.uri)) {
        continue;
      }

      const targetKey = this.deps.getComparableResourceKey(document.uri);
      if (!targetKey) {
        continue;
      }

      const openTargetDocument = this.deps.getOpenTextDocumentForComparableKey(targetKey);
      if (openTargetDocument && openTargetDocument.getText() === document.getText()) {
        continue;
      }

      for (const key of this.getOverridePatterns(targetKey)) {
        keys.add(key);
      }
    }

    return keys;
  }

  private getOverridePatterns(targetKey: string): string[] {
    const keys = new Set<string>([targetKey]);
    const posixKey = targetKey.split(path.sep).join(path.posix.sep);
    keys.add(posixKey);

    for (const workspaceFolder of vscode.workspace.workspaceFolders ?? []) {
      const workspaceRoot = path.normalize(workspaceFolder.uri.fsPath);
      const relativePath = path.relative(workspaceRoot, targetKey);
      if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        continue;
      }

      const relativePosixPath = relativePath.split(path.sep).join(path.posix.sep);
      keys.add(relativePosixPath);
      keys.add(`**/${relativePosixPath}`);
    }

    return Array.from(keys);
  }

  private applyOverrideAssociations(
    associations: Record<string, string>,
    previousKeys: ReadonlySet<string>,
    nextKeys: ReadonlySet<string>
  ): boolean {
    let changed = false;

    for (const key of previousKeys) {
      if (nextKeys.has(key) || !(key in associations)) {
        continue;
      }
      delete associations[key];
      changed = true;
    }

    for (const key of nextKeys) {
      if (associations[key] === 'default') {
        continue;
      }
      associations[key] = 'default';
      changed = true;
    }

    return changed;
  }

  private getConfigurationTarget(): vscode.ConfigurationTarget.Global | vscode.ConfigurationTarget.Workspace {
    return vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
  }

  private getSortedValues(values: ReadonlySet<string>): string[] {
    return Array.from(values).sort();
  }

  private haveSameValues(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }
}
