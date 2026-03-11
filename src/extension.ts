import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as vscode from 'vscode';
import { createGitApiWatcher } from './git/gitApiWatch';
import {
  AGENT_REVIEW_FILE_OVERRIDE_CLEANUP_DELAY_MS,
  AGENT_REVIEW_POST_REOPEN_DEDUP_DELAY_MS,
  AGENT_REVIEW_REOPEN_ON_CLOSE_DELAY_MS,
  AgentReviewHandoffController
} from './agents/reviewHandoff';
import {
  findLikelyAgentReviewState,
  getComparableFileUri,
  isLikelyAgentReviewUri,
  resolveAgentReviewRedirectState
} from './agents/reviewState';
import {
  getComparableResourceKey,
  getOpenTextDocumentForComparableKey,
  getOpenTextDocumentForUri,
  getPreferredCommandUri,
  parseGitUriQuery,
  resolveWorktreeUriFromGitUri
} from './agents/resourceMatching';
import { AgentReviewOverrideController } from './agents/reviewOverrides';
import {
  EXTENSION_CONFIG_SECTION,
  AUTO_SAVE_LEGACY_SETTING_KEY,
  AUTO_SAVE_SETTING_KEY,
  GIT_CHANGES_GUTTER_LEGACY_SETTING_KEY,
  GIT_CHANGES_GUTTER_LEGACY_VISIBLE_SETTING_KEY,
  GIT_CHANGES_GUTTER_LEGACY_VISIBILITY_SETTING_KEY,
  GIT_CHANGES_GUTTER_SETTING_KEY,
  GIT_DIFF_LINE_HIGHLIGHTS_SETTING_KEY,
  LINE_NUMBERS_LEGACY_SETTING_KEY,
  LINE_NUMBERS_LEGACY_VISIBLE_SETTING_KEY,
  LINE_NUMBERS_SETTING_KEY,
  OUTLINE_VISIBLE_KEY,
  VIM_MODE_SETTING_KEY,
  syncEditorAssociations,
  getAutoSaveEnabled,
  getExportEditorFontEnvironment,
  getExportPdfBrowserPath,
  getGitChangesGutterEnabled,
  getGitDiffLineHighlightsEnabled,
  getLineNumbersEnabled,
  getOutlinePosition,
  getOutlineVisible,
  getThemeSettings,
  getVimModeEnabled,
  isMarkdownDocumentPath,
  migrateLegacyToggleSettings,
  resetThemeSettingsToDefault
} from './shared/extensionConfig';
import { createPanelSessionController, type ExportFormat, type PanelSession } from './extension/panelSession';
import { serializeThemeSettings, themePresets, type ThemeSettings, validateThemePayload } from './shared/themeDefaults';
import {
  runWithTimedUiTimeout,
  showTimedErrorMessage,
  showTimedInformationMessage,
  showTimedQuickPick,
  showTimedWarningMessage,
  showTimedWarningMessageWithItems
} from './shared/timedUi';
import type { ExportStyleEnvironment } from './export/runtime';

const VIEW_TYPE = 'markdownEditorOptimized.editor';
const ACTIVE_EDITOR_CONTEXT_KEY = 'markdownEditorOptimized.activeEditor';
const FIND_OPTIONS_STATE_KEY = 'findOptions';
const CUSTOM_THEMES_STATE_KEY = 'customThemes';

type FindOptionsState = {
  wholeWord: boolean;
  caseSensitive: boolean;
};

type ThemeSource = 'built-in' | 'imported';

type ThemeQuickPickItem = vscode.QuickPickItem & {
  theme: ThemeSettings;
  source: ThemeSource;
};

type ImportedThemeQuickPickItem = vscode.QuickPickItem & {
  theme: ThemeSettings;
};

type ExportRuntimeModule = {
  renderExportHtmlDocument: (options: {
    markdownText: string;
    sourceDocumentPath: string;
    outputFilePath: string;
    target: ExportFormat;
    theme: ThemeSettings;
    styleEnvironment?: ExportStyleEnvironment;
    editorFontEnvironment?: {
      editorFontFamily?: string;
      editorFontSizePx?: number;
    };
    mermaidRuntimeSrc: string;
    katexStylesHref: string;
    baseHref: string;
    title: string;
  }) => { htmlDocument: string; hasMermaid: boolean; hasMath: boolean };
  writeFinalizedHtmlExport: (options: {
    htmlDocument: string;
    outputHtmlPath: string;
    browserExecutablePath?: string;
    puppeteerRuntimeModulePath?: string;
    timeoutMs?: number;
    skipHeadlessFinalize?: boolean;
  }) => Promise<void>;
  renderPdfFromHtmlExport: (options: {
    htmlDocument: string;
    outputPdfPath: string;
    browserExecutablePath?: string;
    puppeteerRuntimeModulePath?: string;
    timeoutMs?: number;
  }) => Promise<void>;
};

let exportRuntimeModulePromise: Promise<ExportRuntimeModule> | null = null;

export function activate(context: vscode.ExtensionContext): void {
  void vscode.commands.executeCommand('setContext', ACTIVE_EDITOR_CONTEXT_KEY, false);
  const useAsDefault = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION).get<boolean>('useAsDefault', true);
  void syncEditorAssociations(useAsDefault);

  const agentReviewHandoff = new AgentReviewHandoffController({
    viewType: VIEW_TYPE,
    getComparableResourceKey,
    getOpenTextDocumentForUri,
    hasLikelyReviewState: (targetUri, targetText) =>
      Boolean(findLikelyAgentReviewState(targetUri, getComparableResourceKey, getOpenTextDocumentForUri, targetText))
  });
  const agentReviewOverrides = new AgentReviewOverrideController(context, {
    getComparableResourceKey,
    getOpenTextDocumentForComparableKey,
    isLikelyAgentReviewUri
  });
  void agentReviewOverrides.syncNow();

  const provider = new MarkdownWebviewProvider(context, agentReviewHandoff);
  void provider.initializeGitWatcher();

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      supportsMultipleEditorsPerDocument: false,
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`${EXTENSION_CONFIG_SECTION}.useAsDefault`)) {
        const shouldUseAsDefault = vscode.workspace
          .getConfiguration(EXTENSION_CONFIG_SECTION)
          .get<boolean>('useAsDefault', true);
        void syncEditorAssociations(shouldUseAsDefault);
      }

      void provider.handleConfigurationChanged(event);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (!isLikelyAgentReviewUri(document.uri)) {
        return;
      }
      void agentReviewOverrides.syncNow();
      void provider.redirectOpenEditorsForCopilotReview(document.uri);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (!isLikelyAgentReviewUri(document.uri)) {
        return;
      }
      agentReviewOverrides.scheduleSync(AGENT_REVIEW_FILE_OVERRIDE_CLEANUP_DELAY_MS);
      agentReviewHandoff.scheduleFlushDeferredReopens(AGENT_REVIEW_REOPEN_ON_CLOSE_DELAY_MS);
      const targetUri = getComparableFileUri(document.uri, getComparableResourceKey);
      if (targetUri) {
        agentReviewHandoff.notePendingMEOtabDedup(targetUri);
        agentReviewHandoff.scheduleMEOtabDedup(targetUri, AGENT_REVIEW_POST_REOPEN_DEDUP_DELAY_MS);
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (isLikelyAgentReviewUri(event.document.uri)) {
        agentReviewOverrides.scheduleSync();
      }
      if (!agentReviewHandoff.hasRecentMEOOwnedFileChangeForUri(event.document.uri)) {
        void provider.redirectOpenEditorsForCopilotReview(event.document.uri);
      }
      if (!agentReviewHandoff.shouldReevaluateDeferredReopen(event.document.uri, isLikelyAgentReviewUri(event.document.uri))) {
        return;
      }
      agentReviewHandoff.scheduleFlushDeferredReopens();
    })
  );

  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs((event) => {
      agentReviewHandoff.noteRecentTextDiffActivity(event.opened);
      agentReviewHandoff.noteRecentTextDiffActivity(event.changed);
      void agentReviewHandoff.flushPendingMEOtabDedups();
      if (!agentReviewHandoff.hasPendingDeferredReopens()) {
        return;
      }
      agentReviewHandoff.scheduleFlushDeferredReopens();
    })
  );

  void migrateLegacyToggleSettings(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownEditorOptimized.open', async (uriLike?: unknown) => {
      const targetUri = getPreferredCommandUri(uriLike);
      if (!targetUri) {
        return;
      }
      const targetPath = (targetUri.path || targetUri.fsPath || '').toLowerCase();
      if (!isMarkdownDocumentPath(targetPath)) {
        return;
      }
      const pendingReview = findLikelyAgentReviewState(
        targetUri,
        getComparableResourceKey,
        getOpenTextDocumentForUri,
        getOpenTextDocumentForUri(targetUri)?.getText()
      );
      if (pendingReview) {
        agentReviewHandoff.scheduleDeferredReopen(targetUri);
        return;
      }
      await vscode.commands.executeCommand('vscode.openWith', targetUri, VIEW_TYPE);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownEditorOptimized.setDefaultEditor', async () => {
      await syncEditorAssociations(true);
      void showTimedInformationMessage('Markdown Editor Optimized is now set as the default editor for Markdown files.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownEditorOptimized.resetThemeToDefault', async () => {
      await resetThemeSettingsToDefault();
      provider.notifyThemeChanged();
      void showTimedInformationMessage('Markdown Editor Optimized theme was reset to default.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownEditorOptimized.selectTheme', async () => {
      const themeItems = buildThemeQuickPickItems(context);
      const selectedTheme = await showTimedQuickPick(
        themeItems,
        { title: 'Select Theme', placeHolder: 'Select & apply a theme preset.' },
        0
      );

      if (!selectedTheme) {
        return;
      }

      const config = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION);
      try {
        await config.update('theme', serializeThemeSettings(selectedTheme.theme), vscode.ConfigurationTarget.Global);
      } catch {
        void showTimedErrorMessage('Failed to apply theme preset.');
        return;
      }

      provider.notifyThemeChanged();
      const sourceSuffix = selectedTheme.source === 'imported' ? ' (imported)' : '';
      void showTimedInformationMessage(`Selected theme: ${selectedTheme.theme.name}${sourceSuffix}`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownEditorOptimized.importTheme', async () => {
      const openFiles = await vscode.window.showOpenDialog({
        title: 'Import Theme JSON',
        filters: { 'Theme JSON': ['json'] },
        canSelectMany: false
      });

      if (!openFiles?.length) {
        return;
      }

      const fileUri = openFiles[0];
      try {
        const fileContent = await vscode.workspace.fs.readFile(fileUri);
        const payload = JSON.parse(new TextDecoder().decode(fileContent));
        const validated = validateThemePayload(payload);
        if (!validated.success) {
          void showTimedErrorMessage(
            `Invalid theme file: ${validated.errors[0] || 'payload does not match schema.'}`
          );
          return;
        }

        const config = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION);
        await config.update('theme', serializeThemeSettings(validated.theme), vscode.ConfigurationTarget.Global);
        await upsertImportedTheme(context, validated.theme);
        provider.notifyThemeChanged();
        void showTimedInformationMessage(`Imported theme: ${validated.theme.name}`);
      } catch (error) {
        void showTimedErrorMessage(`Failed to import theme: ${error instanceof Error ? error.message : String(error)}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownEditorOptimized.exportTheme', async () => {
      const uri = await vscode.window.showSaveDialog({
        title: 'Export Theme JSON',
        filters: { 'Theme JSON': ['json'] },
        defaultUri: vscode.Uri.file('meo-theme.json'),
        saveLabel: 'Export Theme'
      });

      if (!uri) {
        return;
      }

      const theme = serializeThemeSettings(getThemeSettings());
      try {
        await vscode.workspace.fs.writeFile(
          uri,
          new TextEncoder().encode(`${JSON.stringify(theme, null, 2)}\n`)
        );
        void showTimedInformationMessage(`Theme exported to ${uri.fsPath}`);
      } catch (error) {
        void showTimedErrorMessage(`Failed to export theme: ${error instanceof Error ? error.message : String(error)}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownEditorOptimized.deleteImportedTheme', async () => {
      const importedThemes = getImportedThemes(context);
      if (!importedThemes.length) {
        void showTimedInformationMessage('No imported themes to delete.');
        return;
      }

      const selected = await showTimedQuickPick(
        importedThemes.map((theme) => ({
          label: theme.name,
          description: theme.id,
          theme
        } satisfies ImportedThemeQuickPickItem)),
        {
          title: 'Delete Imported Theme',
          placeHolder: 'Select an imported theme to delete'
        }
      );
      if (!selected) {
        return;
      }

      const confirm = await showTimedWarningMessageWithItems(
        `Delete imported theme "${selected.theme.name}"?`,
        { modal: true },
        ['Delete'] as const
      );
      if (confirm !== 'Delete') {
        return;
      }

      const deleted = await deleteImportedThemeById(context, selected.theme.id);
      if (!deleted) {
        void showTimedWarningMessage(`Could not find imported theme "${selected.theme.name}" to delete.`);
        return;
      }

      const currentTheme = getThemeSettings();
      const deletingActiveTheme = normalizeThemeId(currentTheme.id) === normalizeThemeId(selected.theme.id);
      const collidesWithBuiltIn = isBuiltInThemeId(selected.theme.id);
      if (deletingActiveTheme && !collidesWithBuiltIn) {
        const config = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION);
        await config.update('theme', serializeThemeSettings(themePresets[0] as ThemeSettings), vscode.ConfigurationTarget.Global);
        provider.notifyThemeChanged();
        void showTimedInformationMessage(`Deleted imported theme: ${selected.theme.name}. Active theme reset to ${themePresets[0].name}.`);
        return;
      }

      void showTimedInformationMessage(`Deleted imported theme: ${selected.theme.name}`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownEditorOptimized.toggleMode', async () => {
      await provider.toggleActiveEditorMode();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownEditorOptimized.exportHtml', async () => {
      await provider.exportActiveDocument('html');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownEditorOptimized.exportPdf', async () => {
      await provider.exportActiveDocument('pdf');
    })
  );
}

class MarkdownWebviewProvider implements vscode.CustomTextEditorProvider {
  private readonly activePanels = new Set<vscode.WebviewPanel>();
  private readonly panelSessions = new Map<vscode.WebviewPanel, PanelSession>();
  private lastActivePanel: vscode.WebviewPanel | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly agentReviewHandoff: AgentReviewHandoffController
  ) {}

  async initializeGitWatcher(): Promise<void> {
    const watcher = await createGitApiWatcher((repoRootFsPath) => {
      for (const session of this.panelSessions.values()) {
        if (session.getGitRepoRoot() !== repoRootFsPath) {
          continue;
        }
        session.refreshGitBaseline({ forceReload: true });
      }
    });
    if (watcher) {
      this.context.subscriptions.push(watcher);
    }
  }

  async exportActiveDocument(format: ExportFormat): Promise<void> {
    const session = this.getActiveSession();
    if (!session) {
      void showTimedWarningMessage('Open a Markdown file in Markdown Editor Optimized before exporting.');
      return;
    }

    await this.exportSessionDocument(session, format);
  }

  async redirectOpenEditorsForCopilotReview(triggerUri: vscode.Uri): Promise<void> {
    const reviewState = resolveAgentReviewRedirectState(
      triggerUri,
      getComparableResourceKey,
      getOpenTextDocumentForUri
    );
    if (!reviewState) {
      return;
    }

    const reviewKey = getComparableResourceKey(reviewState.uri);
    if (!reviewKey) {
      return;
    }

    for (const session of Array.from(this.panelSessions.values())) {
      if (getComparableResourceKey(session.documentUri) !== reviewKey) {
        continue;
      }

      if (this.agentReviewHandoff.hasRecentTextDiffActivityForUri(session.documentUri)) {
        continue;
      }

      if (this.agentReviewHandoff.hasOpenTextDiffTabForUri(session.documentUri)) {
        continue;
      }

      if (reviewState.text === session.document.getText()) {
        continue;
      }

      this.agentReviewHandoff.scheduleDeferredReopen(session.documentUri);
      await this.redirectCopilotReviewToNativeEditor(session.document, session.panel);
    }
  }

  async handleConfigurationChanged(event: vscode.ConfigurationChangeEvent): Promise<void> {
    if (
      event.affectsConfiguration(`${EXTENSION_CONFIG_SECTION}.${AUTO_SAVE_SETTING_KEY}`) ||
      event.affectsConfiguration(`${EXTENSION_CONFIG_SECTION}.${AUTO_SAVE_LEGACY_SETTING_KEY}`)
    ) {
      this.broadcast({ type: 'autoSaveChanged', enabled: getAutoSaveEnabled(this.context) });
    }

    if (
      event.affectsConfiguration(`${EXTENSION_CONFIG_SECTION}.${LINE_NUMBERS_SETTING_KEY}`) ||
      event.affectsConfiguration(`${EXTENSION_CONFIG_SECTION}.${LINE_NUMBERS_LEGACY_SETTING_KEY}`) ||
      event.affectsConfiguration(`${EXTENSION_CONFIG_SECTION}.${LINE_NUMBERS_LEGACY_VISIBLE_SETTING_KEY}`)
    ) {
      this.broadcast({ type: 'lineNumbersChanged', enabled: getLineNumbersEnabled(this.context) });
    }

    if (
      event.affectsConfiguration(`${EXTENSION_CONFIG_SECTION}.${GIT_CHANGES_GUTTER_SETTING_KEY}`) ||
      event.affectsConfiguration(`${EXTENSION_CONFIG_SECTION}.${GIT_CHANGES_GUTTER_LEGACY_VISIBLE_SETTING_KEY}`) ||
      event.affectsConfiguration(`${EXTENSION_CONFIG_SECTION}.${GIT_CHANGES_GUTTER_LEGACY_VISIBILITY_SETTING_KEY}`) ||
      event.affectsConfiguration(`${EXTENSION_CONFIG_SECTION}.${GIT_CHANGES_GUTTER_LEGACY_SETTING_KEY}`)
    ) {
      this.broadcast({ type: 'gitChangesGutterChanged', enabled: getGitChangesGutterEnabled(this.context) });
    }

    if (event.affectsConfiguration(`${EXTENSION_CONFIG_SECTION}.${GIT_DIFF_LINE_HIGHLIGHTS_SETTING_KEY}`)) {
      this.broadcast({ type: 'gitDiffLineHighlightsChanged', enabled: getGitDiffLineHighlightsEnabled() });
    }

    if (event.affectsConfiguration(`${EXTENSION_CONFIG_SECTION}.${VIM_MODE_SETTING_KEY}`)) {
      this.broadcast({ type: 'vimModeChanged', enabled: getVimModeEnabled(this.context) });
    }

    if (event.affectsConfiguration(`${EXTENSION_CONFIG_SECTION}.outline.position`)) {
      this.broadcast({ type: 'outlinePositionChanged', position: getOutlinePosition() });
    }

    if (
      event.affectsConfiguration(`${EXTENSION_CONFIG_SECTION}.theme`)
    ) {
      this.broadcast({ type: 'themeChanged', theme: getThemeSettings() });
    }
  }

  notifyThemeChanged(): void {
    this.broadcast({ type: 'themeChanged', theme: getThemeSettings() });
  }

  async toggleActiveEditorMode(): Promise<void> {
    const session = this.getActiveSession();
    if (!session) {
      return;
    }

    this.lastActivePanel = session.panel;
    await session.ensureInitDelivered();
    await session.panel.webview.postMessage({ type: 'toggleMode' });
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const pendingReview = findLikelyAgentReviewState(
      document.uri,
      getComparableResourceKey,
      getOpenTextDocumentForUri,
      document.getText()
    );
    if (pendingReview) {
      this.agentReviewHandoff.scheduleDeferredReopen(document.uri);
      await this.redirectCopilotReviewToNativeEditor(document, panel, true);
      return;
    }

    if (await this.redirectGitResourceToNativeEditor(document, panel)) {
      return;
      return;
    }

    this.activePanels.add(panel);

    const documentUri = resolveWorktreeUri(document);
    const distRoot = vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist');
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: collectLocalResourceRoots(distRoot, documentUri)
    };
    panel.webview.html = this.getWebviewHtml(panel.webview);

    const controller = createPanelSessionController({
      panel,
      document,
      documentUri,
      context: this.context,
      agentReviewHandoff: this.agentReviewHandoff,
      onExportDocument: (session, format) => this.exportSessionDocument(session, format),
      getFindOptions: () => this.getFindOptions(),
      setFindOptions: (options) => this.setFindOptions(options),
      setOutlineVisible: (visible) => this.setOutlineVisible(visible),
      onPanelActivated: (activePanel) => {
        this.lastActivePanel = activePanel;
      },
      onPanelViewStateChanged: () => {
        this.updateActiveEditorContext();
      },
      onPanelDisposed: (disposedPanel) => {
        this.activePanels.delete(disposedPanel);
        this.panelSessions.delete(disposedPanel);
        if (this.lastActivePanel === disposedPanel) {
          this.lastActivePanel = null;
        }
        this.updateActiveEditorContext();
      }
    });

    this.panelSessions.set(panel, controller.session);
    if (panel.active) {
      this.lastActivePanel = panel;
    }
    this.updateActiveEditorContext();
  }

  private broadcast(message: Record<string, unknown>): void {
    for (const panel of this.activePanels) {
      void panel.webview.postMessage(message);
    }
  }

  private getFindOptions(): FindOptionsState {
    const stored = this.context.globalState.get<Partial<FindOptionsState> | undefined>(FIND_OPTIONS_STATE_KEY);
    return {
      wholeWord: stored?.wholeWord === true,
      caseSensitive: stored?.caseSensitive === true
    };
  }

  private async setFindOptions(options: FindOptionsState): Promise<void> {
    const nextOptions: FindOptionsState = {
      wholeWord: options.wholeWord === true,
      caseSensitive: options.caseSensitive === true
    };
    const currentOptions = this.getFindOptions();
    if (
      currentOptions.wholeWord === nextOptions.wholeWord &&
      currentOptions.caseSensitive === nextOptions.caseSensitive
    ) {
      return;
    }

    await this.context.globalState.update(FIND_OPTIONS_STATE_KEY, nextOptions);
    this.broadcast({ type: 'findOptionsChanged', findOptions: nextOptions });
  }

  private async setOutlineVisible(visible: boolean): Promise<void> {
    const nextVisible = visible === true;
    if (getOutlineVisible(this.context) === nextVisible) {
      return;
    }

    await this.context.globalState.update(OUTLINE_VISIBLE_KEY, nextVisible);
    this.broadcast({ type: 'outlineVisibilityChanged', visible: nextVisible });
  }

  private updateActiveEditorContext(): void {
    const hasActiveMEOEditor = Array.from(this.panelSessions.keys()).some((panel) => panel.active);
    void vscode.commands.executeCommand('setContext', ACTIVE_EDITOR_CONTEXT_KEY, hasActiveMEOEditor);
  }

  private getActiveSession(): PanelSession | null {
    if (this.lastActivePanel && this.panelSessions.has(this.lastActivePanel)) {
      return this.panelSessions.get(this.lastActivePanel) ?? null;
    }

    for (const panel of this.activePanels) {
      if (panel.active && this.panelSessions.has(panel)) {
        this.lastActivePanel = panel;
        return this.panelSessions.get(panel) ?? null;
      }
    }

    const first = this.panelSessions.values().next();
    return first.done ? null : first.value;
  }

  private async exportSessionDocument(session: PanelSession, format: ExportFormat): Promise<void> {
    this.lastActivePanel = session.panel;

    if (session.documentUri.scheme !== 'file') {
      void showTimedWarningMessage('Export is only supported for local Markdown files in the current version.');
      return;
    }

    const saveUri = await this.promptExportTargetUri(session.documentUri, format);
    if (!saveUri) {
      return;
    }

    try {
      await runWithTimedUiTimeout(() =>
        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            cancellable: false,
            title: format === 'html' ? 'Exporting Markdown to HTML' : 'Exporting Markdown to PDF'
          },
          async (progress) => {
            progress.report({ message: 'Collecting editor content…' });
            const snapshot = await session.requestExportSnapshot();

            progress.report({ message: 'Rendering export document…' });
            const exportRuntime = await loadExportRuntimeModule(this.context.extensionUri);
            const exportRender = await this.buildExportHtmlDocument(exportRuntime, {
              markdownText: snapshot.text,
              sourceDocumentUri: session.documentUri,
              outputFileUri: saveUri,
              target: format,
              styleEnvironment: snapshot.environment
            });

            const browserExecutablePath = getExportPdfBrowserPath();
            const puppeteerRuntimeModulePath = vscode.Uri.joinPath(
              this.context.extensionUri,
              'dist',
              'puppeteer-runtime.js'
            ).fsPath;
            progress.report({ message: format === 'html' ? 'Finalizing HTML…' : 'Rendering PDF in headless browser…' });

            if (format === 'html') {
              await exportRuntime.writeFinalizedHtmlExport({
                htmlDocument: exportRender.htmlDocument,
                outputHtmlPath: saveUri.fsPath,
                browserExecutablePath,
                puppeteerRuntimeModulePath,
                skipHeadlessFinalize: !exportRender.hasMermaid
              });
              return;
            }

            await exportRuntime.renderPdfFromHtmlExport({
              htmlDocument: exportRender.htmlDocument,
              outputPdfPath: saveUri.fsPath,
              browserExecutablePath,
              puppeteerRuntimeModulePath
            });
          }
        )
      );

      void vscode.window.setStatusBarMessage(
        `${format.toUpperCase()} export completed: ${saveUri.fsPath}`,
        5000
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Export failed';
      void showTimedErrorMessage(`${format.toUpperCase()} export failed: ${message}`);
    }
  }

  private async promptExportTargetUri(documentUri: vscode.Uri, format: ExportFormat): Promise<vscode.Uri | undefined> {
    const defaultUri = vscode.Uri.file(replaceFileExtension(documentUri.fsPath, format === 'html' ? '.html' : '.pdf'));
    return vscode.window.showSaveDialog({
      defaultUri,
      filters: format === 'html'
        ? { HTML: ['html', 'htm'] }
        : { PDF: ['pdf'] },
      saveLabel: format === 'html' ? 'Export HTML' : 'Export PDF'
    });
  }

  private async buildExportHtmlDocument(
    exportRuntime: ExportRuntimeModule,
    params: {
      markdownText: string;
      sourceDocumentUri: vscode.Uri;
      outputFileUri: vscode.Uri;
      target: ExportFormat;
      styleEnvironment?: ExportStyleEnvironment;
    }
  ): Promise<{ htmlDocument: string; hasMermaid: boolean; hasMath: boolean }> {
    const mermaidRuntimeSrc = pathToFileURL(
      vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist', 'mermaid.min.js').fsPath
    ).toString();
    const katexStylesHref = pathToFileURL(
      vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist', 'katex', 'katex.min.css').fsPath
    ).toString();
    const baseHref = pathToFileURL(`${path.dirname(params.outputFileUri.fsPath)}${path.sep}`).toString();
    return exportRuntime.renderExportHtmlDocument({
      markdownText: params.markdownText,
      sourceDocumentPath: params.sourceDocumentUri.fsPath,
      outputFilePath: params.outputFileUri.fsPath,
      target: params.target,
      theme: getThemeSettings(),
      styleEnvironment: params.styleEnvironment,
      editorFontEnvironment: getExportEditorFontEnvironment(),
      mermaidRuntimeSrc,
      katexStylesHref,
      baseHref,
      title: path.basename(params.outputFileUri.fsPath)
    });
  }

  private async redirectGitResourceToNativeEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel
  ): Promise<boolean> {
    if (document.uri.scheme !== 'git') {
      return false;
    }

    const viewColumn = panel.viewColumn ?? vscode.ViewColumn.Active;
    const editorOptions = {
      preserveFocus: false,
      preview: true,
      override: 'default'
    };
    const existingDiff = findDiffContextForGitUri(document.uri);

    if (existingDiff) {
      await vscode.commands.executeCommand(
        '_workbench.diff',
        existingDiff.original,
        existingDiff.modified,
        existingDiff.title,
        [viewColumn, editorOptions]
      );
      panel.dispose();
      return true;
    }

    const ref = getGitUriRef(document.uri);
    if (isWorkingTreeOrIndexRef(ref)) {
      const targetUri = resolveWorktreeUri(document);
      const title = getNativeWorkingTreeTitle(document.uri, targetUri);

      await vscode.commands.executeCommand(
        '_workbench.diff',
        document.uri,
        targetUri,
        title,
        [viewColumn, editorOptions]
      );
      panel.dispose();
      return true;
    }

    return false;
  }

  private async redirectCopilotReviewToNativeEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    preserveFocus = false
  ): Promise<void> {
    const viewColumn = panel.viewColumn ?? vscode.ViewColumn.Active;
    await vscode.commands.executeCommand(
      'vscode.openWith',
      document.uri,
      'default',
      {
        viewColumn,
        preserveFocus,
        preview: true
      }
    );
    panel.dispose();
  }

  private getWebviewHtml(webview: vscode.Webview): string {
    const scriptUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist', 'index.js'))
      .toString();
    const styleUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist', 'index.css'))
      .toString();
    const katexStyleUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist', 'katex', 'katex.min.css'))
      .toString();
    const mermaidRuntimeUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist', 'mermaid.min.js'))
      .toString();
    const nonce = getNonce();
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} https:`,
      `font-src ${webview.cspSource}`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource} 'nonce-${nonce}'`
    ].join('; ');

    return `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta http-equiv="Content-Security-Policy" content="${csp};" />
        <title>Markdown Editor Optimized</title>
        <style>${getWebviewPreloadShellCss()}</style>
        <link href="${katexStyleUri}" rel="stylesheet" />
        <link href="${styleUri}" rel="stylesheet" />
      </head>
      <body data-meo-mermaid-src="${mermaidRuntimeUri}">
        <div id="app" class="editor-root">
          ${getWebviewPreloadShellMarkup()}
        </div>
        <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
      </body>
    </html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i += 1) {
    nonce += chars[Math.floor(Math.random() * chars.length)];
  }
  return nonce;
}

function getWebviewPreloadShellCss(): string {
  return `
      html, body {
        margin: 0;
        padding: 0;
        height: 100%;
      }
      body {
        background: var(--vscode-editor-background);
      }
      #app {
        min-height: 100%;
        display: flex;
        flex-direction: column;
      }
      #app > .mode-toolbar.meo-preload-toolbar {
        min-height: 40px;
        box-sizing: border-box;
        background: var(--vscode-sideBar-background);
      }
      #app > .editor-wrapper.meo-preload-editor-shell {
        flex: 1;
        min-height: 0;
        display: flex;
      }
      #app > .editor-wrapper.meo-preload-editor-shell > .editor-host {
        flex: 1;
        min-width: 0;
        min-height: 0;
        background: var(--vscode-editor-background);
      }
    `;
}

function getWebviewPreloadShellMarkup(): string {
  return `
          <div class="mode-toolbar meo-preload-toolbar" role="presentation" aria-hidden="true"></div>
          <div class="editor-wrapper meo-preload-editor-shell" role="presentation" aria-hidden="true">
            <div class="editor-host"></div>
          </div>
        `;
}

async function loadExportRuntimeModule(extensionUri: vscode.Uri): Promise<ExportRuntimeModule> {
  if (!exportRuntimeModulePromise) {
    const runtimePath = vscode.Uri.joinPath(extensionUri, 'dist', 'export-runtime.js').fsPath;
    const runtimeUrl = pathToFileURL(runtimePath).toString();
    exportRuntimeModulePromise = import(runtimeUrl)
      .then((mod: unknown) => unwrapExportRuntimeModule(mod))
      .catch((error) => {
        exportRuntimeModulePromise = null;
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to load export runtime (${runtimePath}). Run the extension build to regenerate it. ${message}`);
      });
  }

  return exportRuntimeModulePromise;
}

function unwrapExportRuntimeModule(mod: unknown): ExportRuntimeModule {
  let current: unknown = mod;
  for (let i = 0; i < 5; i += 1) {
    const candidate = current as Partial<ExportRuntimeModule> | undefined;
    if (
      candidate &&
      typeof candidate.renderExportHtmlDocument === 'function' &&
      typeof candidate.writeFinalizedHtmlExport === 'function' &&
      typeof candidate.renderPdfFromHtmlExport === 'function'
    ) {
      return candidate as ExportRuntimeModule;
    }

    if (!current || typeof current !== 'object' || !('default' in current)) {
      break;
    }
    current = (current as { default?: unknown }).default;
  }

  throw new Error('Loaded export runtime does not expose the expected export functions.');
}

function collectLocalResourceRoots(distRoot: vscode.Uri, documentUri: vscode.Uri): vscode.Uri[] {
  const roots = new Map<string, vscode.Uri>();
  roots.set(distRoot.toString(), distRoot);

  const documentDir = vscode.Uri.file(path.dirname(documentUri.fsPath));
  roots.set(documentDir.toString(), documentDir);

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    roots.set(folder.uri.toString(), folder.uri);
  }

  return Array.from(roots.values());
}

function replaceFileExtension(filePath: string, ext: '.html' | '.pdf'): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}${ext}`);
}

function resolveWorktreeUri(document: vscode.TextDocument): vscode.Uri {
  if (document.uri.scheme === 'file') {
    return document.uri;
  }

  return resolveWorktreeUriFromGitUri(document.uri) ?? document.uri;
}

function findDiffContextForGitUri(uri: vscode.Uri): { original: vscode.Uri; modified: vscode.Uri; title: string } | undefined {
  const target = uri.toString();

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (!(input instanceof vscode.TabInputTextDiff)) {
        continue;
      }

      const original = input.original;
      const modified = input.modified;
      if (original.toString() !== target && modified.toString() !== target) {
        continue;
      }

      return {
        original,
        modified,
        title: tab.label
      };
    }
  }

  return undefined;
}

function getGitUriRef(uri: vscode.Uri): string | undefined {
  const query = parseGitUriQuery(uri.query);
  return typeof query?.ref === 'string' ? query.ref : undefined;
}

function isWorkingTreeOrIndexRef(ref: string | undefined): boolean {
  return ref === '~' || ref === 'HEAD' || ref === '';
}

function getNativeWorkingTreeTitle(gitUri: vscode.Uri, fileUri: vscode.Uri): string {
  const fileName = vscode.workspace.asRelativePath(fileUri, false) || fileUri.path;
  const ref = getGitUriRef(gitUri);

  if (ref === '~') {
    return `${fileName} (Working Tree)`;
  }

  if (ref === 'HEAD' || ref === '') {
    return `${fileName} (Index)`;
  }

  return fileName;
}

function buildThemeQuickPickItems(context: vscode.ExtensionContext): ThemeQuickPickItem[] {
  const builtInItems: ThemeQuickPickItem[] = themePresets.map((theme) => ({
    label: theme.name,
    description: theme.id,
    detail: 'Built-in',
    theme,
    source: 'built-in'
  }));
  const importedItems: ThemeQuickPickItem[] = getImportedThemes(context).map((theme) => ({
    label: theme.name,
    description: theme.id,
    detail: 'Imported',
    theme,
    source: 'imported'
  }));

  return [...builtInItems, ...importedItems];
}

function getImportedThemes(context: vscode.ExtensionContext): ThemeSettings[] {
  const raw = context.globalState.get<unknown>(CUSTOM_THEMES_STATE_KEY);
  if (!Array.isArray(raw)) {
    return [];
  }

  const themesById = new Map<string, ThemeSettings>();
  for (const item of raw) {
    const validated = validateThemePayload(item);
    if (!validated.success) {
      continue;
    }
    themesById.set(normalizeThemeId(validated.theme.id), validated.theme);
  }

  return Array.from(themesById.values())
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function upsertImportedTheme(context: vscode.ExtensionContext, theme: ThemeSettings): Promise<void> {
  const importedThemes = getImportedThemes(context);
  const existingIndex = importedThemes.findIndex((item) => normalizeThemeId(item.id) === normalizeThemeId(theme.id));
  if (existingIndex >= 0) {
    importedThemes[existingIndex] = theme;
  } else {
    importedThemes.push(theme);
  }

  importedThemes.sort((a, b) => a.name.localeCompare(b.name));
  await context.globalState.update(
    CUSTOM_THEMES_STATE_KEY,
    importedThemes.map((item) => serializeThemeSettings(item))
  );
}

async function deleteImportedThemeById(context: vscode.ExtensionContext, themeId: string): Promise<boolean> {
  const normalizedThemeId = normalizeThemeId(themeId);
  const importedThemes = getImportedThemes(context);
  const nextImportedThemes = importedThemes.filter((item) => normalizeThemeId(item.id) !== normalizedThemeId);

  if (nextImportedThemes.length === importedThemes.length) {
    return false;
  }

  await context.globalState.update(
    CUSTOM_THEMES_STATE_KEY,
    nextImportedThemes.map((item) => serializeThemeSettings(item))
  );
  return true;
}

function isBuiltInThemeId(themeId: string): boolean {
  const normalizedThemeId = normalizeThemeId(themeId);
  return themePresets.some((item) => normalizeThemeId(item.id) === normalizedThemeId);
}

function normalizeThemeId(id: string): string {
  return id.trim().toLowerCase();
}

export function deactivate(): void {}
