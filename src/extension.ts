import * as vscode from 'vscode';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { getGitBlameForLine } from './git/blame';
import { runGit } from './git/cli';
import { GitDocumentState, hashGitBaselinePayload } from './git/documentState';
import { createGitApiWatcher } from './git/gitApiWatch';
import type { GitBaselinePayload, GitBlameLineResult } from './git/types';
import { buildCurrentToBaselineLineMap as buildCurrentToBaselineLineMapShared } from './shared/gitDiffCore';
import {
  defaultThemeColors,
  defaultThemeFonts,
  maxThemeLineHeight,
  minThemeLineHeight,
  themeColorKeys,
  type ThemeColors,
  type ThemeSettings
} from './shared/themeDefaults';
import type { ExportStyleEnvironment } from './export/runtime';

const VIEW_TYPE = 'markdownEditorOptimized.editor';
const EXTENSION_CONFIG_SECTION = 'markdownEditorOptimized';
const ACTIVE_EDITOR_CONTEXT_KEY = 'markdownEditorOptimized.activeEditor';
const AUTO_SAVE_SETTING_KEY = 'autoSave.enabled';
const LINE_NUMBERS_SETTING_KEY = 'lineNumbers.visible';
const GIT_CHANGES_GUTTER_SETTING_KEY = 'gitChanges.visible';
const VIM_MODE_SETTING_KEY = 'vimMode.enabled';
const AUTO_SAVE_LEGACY_SETTING_KEY = 'autoSave.visibility';
const LINE_NUMBERS_LEGACY_ENABLED_SETTING_KEY = 'lineNumbers.enabled';
const LINE_NUMBERS_LEGACY_SETTING_KEY = 'lineNumbers.visibility';
const GIT_CHANGES_GUTTER_LEGACY_VISIBLE_SETTING_KEY = 'gitChanges.visibility';
const GIT_CHANGES_GUTTER_LEGACY_VISIBILITY_SETTING_KEY = 'gitChangesGutter.visibility';
const GIT_CHANGES_GUTTER_LEGACY_SETTING_KEY = 'gitChangesGutter.enabled';
const AUTO_SAVE_KEY = 'autoSaveEnabled';
const LINE_NUMBERS_KEY = 'lineNumbersEnabled';
const GIT_CHANGES_GUTTER_KEY = 'gitChangesGutterEnabled';
const VIM_MODE_KEY = 'vimModeEnabled';
const WIKI_LINK_SCHEME = 'meo-wiki:';
type EditorMode = 'live' | 'source';
type OutlinePosition = 'left' | 'right';

type AutoSaveChangedMessage = {
  type: 'autoSaveChanged';
  enabled: boolean;
};

type LineNumbersChangedMessage = {
  type: 'lineNumbersChanged';
  enabled: boolean;
};

type GitChangesGutterChangedMessage = {
  type: 'gitChangesGutterChanged';
  enabled: boolean;
};

type VimModeChangedMessage = {
  type: 'vimModeChanged';
  enabled: boolean;
};

type InitMessage = {
  type: 'init';
  text: string;
  version: number;
  mode: EditorMode;
  autoSave: boolean;
  lineNumbers: boolean;
  gitChangesGutter: boolean;
  vimMode: boolean;
  outlinePosition: OutlinePosition;
  theme: ThemeSettings;
};

type DocChangedMessage = {
  type: 'docChanged';
  text: string;
  version: number;
};

type AppliedMessage = {
  type: 'applied';
  version: number;
};

type RevealSelectionMessage = {
  type: 'revealSelection';
  anchor: number;
  head: number;
  focus?: boolean;
};

type RevealSelectionPayload = {
  anchor: number;
  head: number;
};

type ApplyChangesMessage = {
  type: 'applyChanges';
  baseVersion: number;
  changes: Array<{ from: number; to: number; insert: string }>;
};

type SetModeMessage = {
  type: 'setMode';
  mode: EditorMode;
};

type OpenLinkMessage = {
  type: 'openLink';
  href: string;
};

type ResolveImageSrcMessage = {
  type: 'resolveImageSrc';
  requestId: string;
  url: string;
};

type ResolveWikiLinksMessage = {
  type: 'resolveWikiLinks';
  requestId: string;
  targets: string[];
};

type SaveDocumentMessage = {
  type: 'saveDocument';
};

type ExportDocumentMessage = {
  type: 'exportDocument';
  format: 'html' | 'pdf';
};

type ExportSnapshotMessage = {
  type: 'exportSnapshot';
  requestId: string;
  text: string;
  environment?: ExportStyleEnvironment;
};

type ExportSnapshotErrorMessage = {
  type: 'exportSnapshotError';
  requestId: string;
  message: string;
};

type SetAutoSaveMessage = {
  type: 'setAutoSave';
  enabled: boolean;
};

type SetLineNumbersMessage = {
  type: 'setLineNumbers';
  visible?: boolean;
  enabled?: boolean;
};

type SetGitChangesGutterMessage = {
  type: 'setGitChangesGutter';
  visible?: boolean;
  enabled?: boolean;
};

type ResolvedImageSrcMessage = {
  type: 'resolvedImageSrc';
  requestId: string;
  resolvedUrl: string;
};

type ResolvedWikiLinksMessage = {
  type: 'resolvedWikiLinks';
  requestId: string;
  results: Array<{ target: string; exists: boolean }>;
};

type ThemeChangedMessage = {
  type: 'themeChanged';
  theme: ThemeSettings;
};

type OutlinePositionChangedMessage = {
  type: 'outlinePositionChanged';
  position: OutlinePosition;
};

type RequestExportSnapshotMessage = {
  type: 'requestExportSnapshot';
  requestId: string;
};

type RequestGitBlameMessage = {
  type: 'requestGitBlame';
  requestId: string;
  lineNumber: number;
  text?: string;
  localEditGeneration: number;
};

type OpenGitRevisionForLineMessage = {
  type: 'openGitRevisionForLine';
  lineNumber: number;
  text?: string;
};

type OpenGitWorktreeForLineMessage = {
  type: 'openGitWorktreeForLine';
  lineNumber: number;
};

type SaveImageFromClipboardMessage = {
  type: 'saveImageFromClipboard';
  requestId: string;
  imageData: string;
  fileName: string;
};

type SavedImagePathMessage = {
  type: 'savedImagePath';
  requestId: string;
  success: boolean;
  path?: string;
  error?: string;
};

type GitBaselineChangedMessage = {
  type: 'gitBaselineChanged';
  version: number;
  payload: GitBaselinePayload;
};

type GitBlameResultMessage = {
  type: 'gitBlameResult';
  requestId: string;
  lineNumber: number;
  localEditGeneration: number;
  result: GitBlameLineResult;
};

type ToggleModeCommandMessage = {
  type: 'toggleMode';
};

type WebviewMessage =
  | ApplyChangesMessage
  | SetModeMessage
  | SetAutoSaveMessage
  | SetLineNumbersMessage
  | SetGitChangesGutterMessage
  | OpenLinkMessage
  | ResolveImageSrcMessage
  | ResolveWikiLinksMessage
  | SaveDocumentMessage
  | ExportDocumentMessage
  | ExportSnapshotMessage
  | ExportSnapshotErrorMessage
  | RequestGitBlameMessage
  | OpenGitRevisionForLineMessage
  | OpenGitWorktreeForLineMessage
  | SaveImageFromClipboardMessage
  | { type: 'ready' };

const ALLOWED_IMAGE_SRC_RE = /^(?:https?:|data:|blob:|vscode-webview-resource:|vscode-resource:)/i;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

type PanelSession = {
  panel: vscode.WebviewPanel;
  document: vscode.TextDocument;
  documentUri: vscode.Uri;
  gitDocumentState: GitDocumentState;
  getMode: () => EditorMode;
  ensureInitDelivered: () => Promise<void>;
  requestExportSnapshot: () => Promise<{ text: string; environment?: ExportStyleEnvironment }>;
  rejectPendingExportSnapshots: (reason: Error) => void;
  refreshGitBaseline: (force?: boolean) => void;
  getGitRepoRoot: () => string | null;
};

type ExportRuntimeModule = {
  renderExportHtmlDocument: (options: {
    markdownText: string;
    sourceDocumentPath: string;
    outputFilePath: string;
    target: 'html' | 'pdf';
    theme: ThemeSettings;
    styleEnvironment?: ExportStyleEnvironment;
    editorFontEnvironment?: {
      editorFontFamily?: string;
      editorFontSizePx?: number;
    };
    mermaidRuntimeSrc: string;
    baseHref: string;
    title: string;
  }) => { htmlDocument: string; hasMermaid: boolean };
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

  const provider = new MarkdownWebviewProvider(context);
  void provider.initializeGitWatcher();

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      supportsMultipleEditorsPerDocument: false,
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('markdownEditorOptimized.useAsDefault')) {
        const shouldUseAsDefault = vscode.workspace
          .getConfiguration('markdownEditorOptimized')
          .get<boolean>('useAsDefault', true);
        void syncEditorAssociations(shouldUseAsDefault);
      }

      void provider.handleConfigurationChanged(event);
    })
  );

  void migrateLegacyToggleSettings(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownEditorOptimized.open', async (uriLike?: unknown) => {
      let targetUri = coerceCommandUri(uriLike);
      if (!targetUri) {
        const active = vscode.window.activeTextEditor;
        if (!active) {
          return;
        }
        targetUri = active.document.uri;
      }
      const targetPath = (targetUri.path || targetUri.fsPath || '').toLowerCase();
      if (!targetPath.endsWith('.md') && !targetPath.endsWith('.markdown')) {
        return;
      }
      await vscode.commands.executeCommand('vscode.openWith', targetUri, VIEW_TYPE);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownEditorOptimized.setDefaultEditor', async () => {
      await updateEditorAssociations();
      void vscode.window.showInformationMessage('Markdown Editor Optimized is now set as the default editor for Markdown files.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownEditorOptimized.resetThemeToDefaults', async () => {
      await resetThemeSettingsToDefaults();
      provider.notifyThemeChanged();
      void vscode.window.showInformationMessage('Markdown Editor Optimized theme and font settings were reset to defaults.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownEditorOptimized.toggleMode', async () => {
      await provider.toggleActiveEditorMode();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownEditorOptimized.exportHtml', async () => {
      await provider.exportActiveDocumentAsHtml();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownEditorOptimized.exportPdf', async () => {
      await provider.exportActiveDocumentAsPdf();
    })
  );
}

class MarkdownWebviewProvider implements vscode.CustomTextEditorProvider {
  private readonly activePanels = new Set<vscode.WebviewPanel>();
  private readonly panelSessions = new Map<vscode.WebviewPanel, PanelSession>();
  private lastActivePanel: vscode.WebviewPanel | null = null;
  private exportSnapshotRequestCounter = 0;
  constructor(private readonly context: vscode.ExtensionContext) {}

  async initializeGitWatcher(): Promise<void> {
    const watcher = await createGitApiWatcher((repoRootFsPath) => {
      for (const session of this.panelSessions.values()) {
        if (session.getGitRepoRoot() !== repoRootFsPath) {
          continue;
        }
        session.refreshGitBaseline(false);
      }
    });
    if (watcher) {
      this.context.subscriptions.push(watcher);
    }
  }

  async exportActiveDocumentAsHtml(): Promise<void> {
    await this.exportActiveDocument('html');
  }

  async exportActiveDocumentAsPdf(): Promise<void> {
    await this.exportActiveDocument('pdf');
  }

  private broadcastAutoSaveChanged(enabled: boolean): void {
    const message: AutoSaveChangedMessage = { type: 'autoSaveChanged', enabled };
    for (const panel of this.activePanels) {
      void panel.webview.postMessage(message);
    }
  }

  private broadcastLineNumbersChanged(enabled: boolean): void {
    const message: LineNumbersChangedMessage = { type: 'lineNumbersChanged', enabled };
    for (const panel of this.activePanels) {
      void panel.webview.postMessage(message);
    }
  }

  private broadcastGitChangesGutterChanged(enabled: boolean): void {
    const message: GitChangesGutterChangedMessage = { type: 'gitChangesGutterChanged', enabled };
    for (const panel of this.activePanels) {
      void panel.webview.postMessage(message);
    }
  }

  private broadcastVimModeChanged(enabled: boolean): void {
    const message: VimModeChangedMessage = { type: 'vimModeChanged', enabled };
    for (const panel of this.activePanels) {
      void panel.webview.postMessage(message);
    }
  }

  private broadcastThemeChanged(theme: ThemeSettings): void {
    const message: ThemeChangedMessage = { type: 'themeChanged', theme };
    for (const panel of this.activePanels) {
      void panel.webview.postMessage(message);
    }
  }

  private broadcastOutlinePositionChanged(position: OutlinePosition): void {
    const message: OutlinePositionChangedMessage = { type: 'outlinePositionChanged', position };
    for (const panel of this.activePanels) {
      void panel.webview.postMessage(message);
    }
  }

  async handleConfigurationChanged(event: vscode.ConfigurationChangeEvent): Promise<void> {
    if (
      event.affectsConfiguration(`markdownEditorOptimized.${AUTO_SAVE_SETTING_KEY}`) ||
      event.affectsConfiguration(`markdownEditorOptimized.${AUTO_SAVE_LEGACY_SETTING_KEY}`)
    ) {
      this.broadcastAutoSaveChanged(getAutoSaveEnabled(this.context));
    }

    if (
      event.affectsConfiguration(`markdownEditorOptimized.${LINE_NUMBERS_SETTING_KEY}`) ||
      event.affectsConfiguration(`markdownEditorOptimized.${LINE_NUMBERS_LEGACY_ENABLED_SETTING_KEY}`) ||
      event.affectsConfiguration(`markdownEditorOptimized.${LINE_NUMBERS_LEGACY_SETTING_KEY}`)
    ) {
      this.broadcastLineNumbersChanged(getLineNumbersEnabled(this.context));
    }

    if (
      event.affectsConfiguration(`markdownEditorOptimized.${GIT_CHANGES_GUTTER_SETTING_KEY}`) ||
      event.affectsConfiguration(`markdownEditorOptimized.${GIT_CHANGES_GUTTER_LEGACY_VISIBLE_SETTING_KEY}`) ||
      event.affectsConfiguration(`markdownEditorOptimized.${GIT_CHANGES_GUTTER_LEGACY_VISIBILITY_SETTING_KEY}`) ||
      event.affectsConfiguration(`markdownEditorOptimized.${GIT_CHANGES_GUTTER_LEGACY_SETTING_KEY}`)
    ) {
      this.broadcastGitChangesGutterChanged(getGitChangesGutterEnabled(this.context));
    }

    if (event.affectsConfiguration(`markdownEditorOptimized.${VIM_MODE_SETTING_KEY}`)) {
      this.broadcastVimModeChanged(getVimModeEnabled(this.context));
    }

    if (event.affectsConfiguration('markdownEditorOptimized.outline.position')) {
      this.broadcastOutlinePositionChanged(getOutlinePosition());
    }

    if (
      event.affectsConfiguration('markdownEditorOptimized.theme') ||
      event.affectsConfiguration('markdownEditorOptimized.fonts')
    ) {
      this.broadcastThemeChanged(getThemeSettings());
    }
  }

  notifyThemeChanged(): void {
    this.broadcastThemeChanged(getThemeSettings());
  }

  private updateActiveEditorContext(): void {
    const hasActiveMEOEditor = Array.from(this.panelSessions.keys()).some((panel) => panel.active);
    void vscode.commands.executeCommand('setContext', ACTIVE_EDITOR_CONTEXT_KEY, hasActiveMEOEditor);
  }

  async toggleActiveEditorMode(): Promise<void> {
    const session = this.getActiveSessionForExport();
    if (!session) {
      return;
    }

    this.lastActivePanel = session.panel;
    await session.ensureInitDelivered();
    const message: ToggleModeCommandMessage = { type: 'toggleMode' };
    await session.panel.webview.postMessage(message);
  }

  private getActiveSessionForExport(): PanelSession | null {
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

  private nextExportSnapshotRequestId(): string {
    this.exportSnapshotRequestCounter += 1;
    return `export-${this.exportSnapshotRequestCounter}`;
  }

  private async exportActiveDocument(format: 'html' | 'pdf'): Promise<void> {
    const session = this.getActiveSessionForExport();
    if (!session) {
      void vscode.window.showWarningMessage('Open a Markdown file in Markdown Editor Optimized before exporting.');
      return;
    }

    await this.exportSessionDocument(session, format);
  }

  private async exportSessionDocument(session: PanelSession, format: 'html' | 'pdf'): Promise<void> {
    this.lastActivePanel = session.panel;

    if (session.documentUri.scheme !== 'file') {
      void vscode.window.showWarningMessage('Export is only supported for local Markdown files in the current version.');
      return;
    }

    const saveUri = await this.promptExportTargetUri(session.documentUri, format);
    if (!saveUri) {
      return;
    }

    try {
      await vscode.window.withProgress(
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
          } else {
            await exportRuntime.renderPdfFromHtmlExport({
              htmlDocument: exportRender.htmlDocument,
              outputPdfPath: saveUri.fsPath,
              browserExecutablePath,
              puppeteerRuntimeModulePath
            });
          }
        }
      );

      void vscode.window.setStatusBarMessage(
        `${format.toUpperCase()} export completed: ${saveUri.fsPath}`,
        5000
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Export failed';
      void vscode.window.showErrorMessage(`${format.toUpperCase()} export failed: ${message}`);
    }
  }

  private async promptExportTargetUri(documentUri: vscode.Uri, format: 'html' | 'pdf'): Promise<vscode.Uri | undefined> {
    const defaultUri = vscode.Uri.file(replaceFileExtension(documentUri.fsPath, format === 'html' ? '.html' : '.pdf'));
    return vscode.window.showSaveDialog({
      defaultUri,
      filters: format === 'html'
        ? { HTML: ['html', 'htm'] }
        : { PDF: ['pdf'] },
      saveLabel: format === 'html' ? 'Export HTML' : 'Export PDF'
    });
  }

  private async buildExportHtmlDocument(exportRuntime: ExportRuntimeModule, params: {
    markdownText: string;
    sourceDocumentUri: vscode.Uri;
    outputFileUri: vscode.Uri;
    target: 'html' | 'pdf';
    styleEnvironment?: ExportStyleEnvironment;
  }): Promise<{ htmlDocument: string; hasMermaid: boolean }> {
    const mermaidRuntimeSrc = pathToFileURL(
      vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist', 'mermaid.min.js').fsPath
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
      baseHref,
      title: path.basename(params.outputFileUri.fsPath)
    });
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const redirectedToNativeEditor = await this.redirectGitResourceToNativeEditor(document, panel);
    if (redirectedToNativeEditor) {
      return;
    }

    this.activePanels.add(panel);

    const documentUri = resolveWorktreeUri(document);
    const distRoot = vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist');
    const localRoots = collectLocalResourceRoots(distRoot, documentUri);
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: localRoots
    };

    panel.webview.html = this.getWebviewHtml(panel.webview);

    let mode: EditorMode = 'live';
    let applyQueue: Promise<void> = Promise.resolve();
    let initDelivered = false;
    let isApplyingOwnChange = false;
    let gitRefreshRunning = false;
    let gitRefreshPending = false;
    let gitRefreshPendingForcePost = false;
    let lastSentRevealSelectionKey: string | null = null;
    let pendingRevealSelection: RevealSelectionPayload | null = null;
    const gitDocumentState = new GitDocumentState(documentUri.fsPath);
    const pendingExportSnapshots = new Map<string, {
      resolve: (value: { text: string; environment?: ExportStyleEnvironment }) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }>();

    const enqueue = (task: () => Promise<void>): Promise<void> => {
      applyQueue = applyQueue.then(task, task);
      return applyQueue;
    };

    const sendInit = async (): Promise<boolean> => {
      const autoSave = getAutoSaveEnabled(this.context);
      const lineNumbers = getLineNumbersEnabled(this.context);
      const gitChangesGutter = getGitChangesGutterEnabled(this.context);
      const vimMode = getVimModeEnabled(this.context);
      const message: InitMessage = {
        type: 'init',
        text: document.getText(),
        version: document.version,
        mode,
        autoSave,
        lineNumbers,
        gitChangesGutter,
        vimMode,
        outlinePosition: getOutlinePosition(),
        theme: getThemeSettings()
      };
      return panel.webview.postMessage(message);
    };

    const sendDocChanged = async (): Promise<boolean> => {
      const message: DocChangedMessage = {
        type: 'docChanged',
        text: document.getText(),
        version: document.version
      };
      return panel.webview.postMessage(message);
    };

    const sendApplied = async (version: number): Promise<boolean> => {
      const message: AppliedMessage = {
        type: 'applied',
        version
      };
      return panel.webview.postMessage(message);
    };

    const sendGitBaselineChanged = async (force = false): Promise<boolean> => {
      if (!initDelivered) {
        return false;
      }

      const payload = await gitDocumentState.resolveBaseline({ includeText: true, force: true });
      gitDocumentState.noteBaselinePayload(payload);
      const payloadHash = hashGitBaselinePayload(payload);
      if (!force && payloadHash === gitDocumentState.getLastSentBaselineHash()) {
        return true;
      }

      const message: GitBaselineChangedMessage = {
        type: 'gitBaselineChanged',
        version: document.version,
        payload
      };
      const posted = await panel.webview.postMessage(message);
      if (posted) {
        gitDocumentState.setLastSentBaselineHash(payloadHash);
      }
      return posted;
    };

    const parseRevealOffsetFromUriFragment = (uri: vscode.Uri): number | null => {
      const fragment = uri.fragment?.trim() ?? '';
      if (!fragment) {
        return null;
      }

      const match = /^(?:L)?(\d+)(?:(?:,|:|C)(\d+))?$/i.exec(fragment);
      if (!match) {
        return null;
      }

      const lineNumber = Number.parseInt(match[1], 10);
      if (!Number.isFinite(lineNumber) || lineNumber < 1) {
        return null;
      }
      const clampedLine = Math.min(lineNumber, document.lineCount);
      const line = document.lineAt(clampedLine - 1);

      const oneBasedColumn = match[2] ? Number.parseInt(match[2], 10) : 1;
      const zeroBasedColumn = Number.isFinite(oneBasedColumn) && oneBasedColumn > 0 ? oneBasedColumn - 1 : 0;
      const targetCharacter = Math.min(line.range.end.character, Math.max(0, zeroBasedColumn));
      return document.offsetAt(new vscode.Position(clampedLine - 1, targetCharacter));
    };

    const ensureInitDelivered = async (): Promise<void> => {
      if (initDelivered) {
        return;
      }
      const posted = await sendInit();
      if (posted) {
        initDelivered = true;
      }
    };

    const requestExportSnapshot = async (): Promise<{ text: string; environment?: ExportStyleEnvironment }> => {
      await ensureInitDelivered();
      const requestId = this.nextExportSnapshotRequestId();

      const response = new Promise<{ text: string; environment?: ExportStyleEnvironment }>((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingExportSnapshots.delete(requestId);
          reject(new Error('Timed out waiting for export snapshot from the editor.'));
        }, 20000);

        pendingExportSnapshots.set(requestId, { resolve, reject, timer });
      });

      const message: RequestExportSnapshotMessage = {
        type: 'requestExportSnapshot',
        requestId
      };
      const posted = await panel.webview.postMessage(message);
      if (!posted) {
        const pending = pendingExportSnapshots.get(requestId);
        if (pending) {
          clearTimeout(pending.timer);
          pendingExportSnapshots.delete(requestId);
          pending.reject(new Error('The editor webview is not ready to export.'));
        }
      }

      return response;
    };

    const rejectPendingExportSnapshots = (error: Error): void => {
      for (const [requestId, pending] of pendingExportSnapshots) {
        clearTimeout(pending.timer);
        pendingExportSnapshots.delete(requestId);
        pending.reject(error);
      }
    };

    const runPendingGitRefreshes = async (): Promise<void> => {
      if (gitRefreshRunning) {
        return;
      }
      gitRefreshRunning = true;
      try {
        while (gitRefreshPending) {
          const nextForcePost = gitRefreshPendingForcePost;
          gitRefreshPending = false;
          gitRefreshPendingForcePost = false;
          try {
            await ensureInitDelivered();
            await sendGitBaselineChanged(nextForcePost);
          } catch {
            // Keep refresh coalescing alive across transient git/webview failures.
          }
        }
      } finally {
        gitRefreshRunning = false;
        if (gitRefreshPending) {
          void runPendingGitRefreshes();
        }
      }
    };

    const refreshGitBaseline = (force = false): void => {
      gitRefreshPending = true;
      gitRefreshPendingForcePost = gitRefreshPendingForcePost || force;
      void runPendingGitRefreshes();
    };

    const isTextEditorForDocument = (textEditor: vscode.TextEditor | undefined): textEditor is vscode.TextEditor => {
      if (!textEditor) {
        return false;
      }
      return resolveWorktreeUri(textEditor.document).toString() === documentUri.toString();
    };

    const revealSelectionForTextEditor = (textEditor: vscode.TextEditor): RevealSelectionPayload => {
      const anchor = textEditor.document.offsetAt(textEditor.selection.start);
      const head = textEditor.document.offsetAt(textEditor.selection.end);
      return { anchor, head };
    };

    const getRevealSelectionKey = (selection: RevealSelectionPayload): string => {
      return `${selection.anchor}:${selection.head}`;
    };

    const postRevealSelection = async (selection: RevealSelectionPayload): Promise<void> => {
      await ensureInitDelivered();
      const message: RevealSelectionMessage = {
        type: 'revealSelection',
        anchor: selection.anchor,
        head: selection.head
      };
      const posted = await panel.webview.postMessage(message);
      if (posted) {
        lastSentRevealSelectionKey = getRevealSelectionKey(selection);
        pendingRevealSelection = null;
      } else {
        pendingRevealSelection = selection;
      }
    };

    const flushPendingRevealSelection = async (): Promise<void> => {
      if (pendingRevealSelection === null) {
        return;
      }
      const selection = pendingRevealSelection;
      await postRevealSelection(selection);
    };

    const sendRevealSelectionForEditor = async (textEditor: vscode.TextEditor | undefined): Promise<void> => {
      if (!isTextEditorForDocument(textEditor)) {
        return;
      }

      const selection = revealSelectionForTextEditor(textEditor);
      if (lastSentRevealSelectionKey === getRevealSelectionKey(selection)) {
        return;
      }
      await postRevealSelection(selection);
    };

    const findEditorForDocumentReveal = (): vscode.TextEditor | undefined => {
      const active = vscode.window.activeTextEditor;
      if (isTextEditorForDocument(active)) {
        return active;
      }
      return vscode.window.visibleTextEditors.find((editor) => isTextEditorForDocument(editor));
    };

    const initialRevealEditor = findEditorForDocumentReveal();
    if (initialRevealEditor) {
      pendingRevealSelection = revealSelectionForTextEditor(initialRevealEditor);
    } else {
      const initialOffset = parseRevealOffsetFromUriFragment(document.uri);
      pendingRevealSelection = initialOffset === null ? null : { anchor: initialOffset, head: initialOffset };
    }

    const session: PanelSession = {
      panel,
      document,
      documentUri,
      gitDocumentState,
      getMode: () => mode,
      ensureInitDelivered,
      requestExportSnapshot,
      rejectPendingExportSnapshots,
      refreshGitBaseline,
      getGitRepoRoot: () => gitDocumentState.getRepoRoot()
    };
    this.panelSessions.set(panel, session);
    if (panel.active) {
      this.lastActivePanel = panel;
    }
    this.updateActiveEditorContext();

    const messageSubscription = panel.webview.onDidReceiveMessage(async (raw: WebviewMessage) => {
      switch (raw.type) {
        case 'ready':
          await ensureInitDelivered();
          refreshGitBaseline(true);
          await flushPendingRevealSelection();
          return;
        case 'setMode':
          mode = raw.mode;
          return;
        case 'setAutoSave':
          await vscode.workspace
            .getConfiguration(EXTENSION_CONFIG_SECTION)
            .update(AUTO_SAVE_SETTING_KEY, raw.enabled, vscode.ConfigurationTarget.Global);
          return;
        case 'setLineNumbers':
          {
            const visible = raw.visible ?? raw.enabled;
            if (typeof visible !== 'boolean') {
              return;
            }
            await vscode.workspace
              .getConfiguration(EXTENSION_CONFIG_SECTION)
              .update(LINE_NUMBERS_SETTING_KEY, visible, vscode.ConfigurationTarget.Global);
          }
          return;
        case 'setGitChangesGutter':
          {
            const visible = raw.visible ?? raw.enabled;
            if (typeof visible !== 'boolean') {
              return;
            }
            await vscode.workspace
              .getConfiguration(EXTENSION_CONFIG_SECTION)
              .update(GIT_CHANGES_GUTTER_SETTING_KEY, visible, vscode.ConfigurationTarget.Global);
          }
          return;
        case 'exportDocument':
          await this.exportSessionDocument(session, raw.format);
          return;
        case 'openLink':
          await openLink(raw.href, documentUri);
          return;
        case 'resolveImageSrc': {
          const resolvedUrl = resolveWebviewImageSrc(raw.url, documentUri, panel.webview);
          const response: ResolvedImageSrcMessage = {
            type: 'resolvedImageSrc',
            requestId: raw.requestId,
            resolvedUrl
          };
          await panel.webview.postMessage(response);
          return;
        }
        case 'resolveWikiLinks': {
          const results = await resolveWikiLinkTargets(raw.targets, documentUri);
          const response: ResolvedWikiLinksMessage = {
            type: 'resolvedWikiLinks',
            requestId: raw.requestId,
            results
          };
          await panel.webview.postMessage(response);
          return;
        }
        case 'exportSnapshot': {
          const pending = pendingExportSnapshots.get(raw.requestId);
          if (!pending) {
            return;
          }
          clearTimeout(pending.timer);
          pendingExportSnapshots.delete(raw.requestId);
          pending.resolve({
            text: raw.text,
            environment: raw.environment
          });
          return;
        }
        case 'exportSnapshotError': {
          const pending = pendingExportSnapshots.get(raw.requestId);
          if (!pending) {
            return;
          }
          clearTimeout(pending.timer);
          pendingExportSnapshots.delete(raw.requestId);
          pending.reject(new Error(raw.message || 'Failed to collect export snapshot.'));
          return;
        }
        case 'requestGitBlame': {
          const payload = await getGitBlameResponseForRequest(documentUri, raw, document.getText(), gitDocumentState);
          const response: GitBlameResultMessage = {
            type: 'gitBlameResult',
            requestId: raw.requestId,
            lineNumber: raw.lineNumber,
            localEditGeneration: raw.localEditGeneration,
            result: payload
          };
          await panel.webview.postMessage(response);
          return;
        }
        case 'openGitRevisionForLine': {
          await openGitRevisionForLine(documentUri, raw, document.getText(), gitDocumentState);
          return;
        }
        case 'openGitWorktreeForLine': {
          await openGitWorktreeForLine(documentUri, raw);
          return;
        }
        case 'applyChanges':
          isApplyingOwnChange = true;
          await enqueue(() => applyDocumentChanges(document, raw, sendDocChanged, sendApplied));
          isApplyingOwnChange = false;
          return;
        case 'saveDocument':
          isApplyingOwnChange = true;
          await enqueue(async () => {
            await document.save();
          });
          isApplyingOwnChange = false;
          refreshGitBaseline(false);
          return;
        case 'saveImageFromClipboard': {
          const response: SavedImagePathMessage = await handleSaveImageFromClipboard(raw, documentUri);
          await panel.webview.postMessage(response);
          return;
        }
      }
    });

    const documentChangeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== document.uri.toString()) {
        return;
      }

      if (isApplyingOwnChange) {
        return;
      }

      void enqueue(async () => {
        await sendDocChanged();
      });
    });

    const documentSaveSubscription = vscode.workspace.onDidSaveTextDocument((savedDocument) => {
      if (savedDocument.uri.toString() !== document.uri.toString()) {
        return;
      }
      refreshGitBaseline(false);
    });

    const textEditorSelectionSubscription = vscode.window.onDidChangeTextEditorSelection((event) => {
      if (!isTextEditorForDocument(event.textEditor)) {
        return;
      }
      void sendRevealSelectionForEditor(event.textEditor);
    });

    const activeTextEditorSubscription = vscode.window.onDidChangeActiveTextEditor((textEditor) => {
      if (!isTextEditorForDocument(textEditor)) {
        return;
      }
      void sendRevealSelectionForEditor(textEditor);
    });

    const visibleTextEditorsSubscription = vscode.window.onDidChangeVisibleTextEditors(() => {
      void sendRevealSelectionForEditor(findEditorForDocumentReveal());
    });

    void ensureInitDelivered();
    refreshGitBaseline(true);
    void sendRevealSelectionForEditor(findEditorForDocumentReveal());

    const viewStateSubscription = panel.onDidChangeViewState((event) => {
      if (event.webviewPanel.active) {
        this.lastActivePanel = event.webviewPanel;
        refreshGitBaseline(false);
        void flushPendingRevealSelection();
        void sendRevealSelectionForEditor(findEditorForDocumentReveal());
      }
      this.updateActiveEditorContext();
    });

    panel.onDidDispose(() => {
      this.activePanels.delete(panel);
      this.panelSessions.delete(panel);
      if (this.lastActivePanel === panel) {
        this.lastActivePanel = null;
      }
      rejectPendingExportSnapshots(new Error('The editor was closed before export completed.'));
      messageSubscription.dispose();
      documentChangeSubscription.dispose();
      documentSaveSubscription.dispose();
      textEditorSelectionSubscription.dispose();
      activeTextEditorSubscription.dispose();
      visibleTextEditorsSubscription.dispose();
      viewStateSubscription.dispose();
      this.updateActiveEditorContext();
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

  private getWebviewHtml(webview: vscode.Webview): string {
    const scriptUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist', 'index.js'))
      .toString();
    const styleUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist', 'index.css'))
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
        <link href="${styleUri}" rel="stylesheet" />
      </head>
      <body data-meo-mermaid-src="${mermaidRuntimeUri}">
        <div id="app" class="editor-root">
        </div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
    </html>`;
  }
}

async function applyDocumentChanges(
  document: vscode.TextDocument,
  message: ApplyChangesMessage,
  sendDocChanged: () => Promise<boolean>,
  sendApplied: (version: number) => Promise<boolean>
): Promise<void> {
  if (message.baseVersion !== document.version) {
    await sendDocChanged();
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  const sortedChanges = [...message.changes].sort((a, b) => b.from - a.from);

  for (const change of sortedChanges) {
    const range = new vscode.Range(
      document.positionAt(change.from),
      document.positionAt(change.to)
    );
    edit.replace(document.uri, range, change.insert);
  }

  const applied = await vscode.workspace.applyEdit(edit);

  if (!applied) {
    await sendDocChanged();
    return;
  }

  await sendApplied(document.version);
}

// The shared mapper now scales via anchors/heuristics and only uses exact LCS on
// bounded chunks, so these are chunk limits rather than global failure caps.
const MAX_BLAME_LINE_MAP_EXACT_CHUNK_LINES = 6000;
const MAX_BLAME_LINE_MAP_EXACT_CHUNK_CELLS = 4_000_000;
const MAX_BLAME_SNAPSHOT_TEXT_CHARS = 500 * 1024;
const blameLineMapCache = new Map<string, Int32Array | null>();

function hashBlameLineMapKey(baseline: GitBaselinePayload, currentText: string): string {
  const hash = createHash('sha1');
  hash.update(baseline.repoRoot ?? '');
  hash.update('\n');
  hash.update(baseline.gitPath ?? '');
  hash.update('\n');
  hash.update(baseline.headOid ?? '');
  hash.update('\n');
  hash.update(currentText);
  return hash.digest('hex');
}

function getMappedBaselineLineForRequest(
  baseline: GitBaselinePayload,
  currentText: string,
  currentLineNumber: number
): number | null {
  if (typeof baseline.baseText !== 'string' || !currentText) {
    return null;
  }

  const normalizedLine = Math.max(1, Math.floor(currentLineNumber));
  const cacheKey = hashBlameLineMapKey(baseline, currentText);
  let mapping = blameLineMapCache.get(cacheKey);
  if (mapping === undefined) {
    mapping = buildCurrentToBaselineLineMapShared(baseline.baseText, currentText, {
      maxLines: MAX_BLAME_LINE_MAP_EXACT_CHUNK_LINES,
      maxCells: MAX_BLAME_LINE_MAP_EXACT_CHUNK_CELLS
    });
    blameLineMapCache.set(cacheKey, mapping);
    if (blameLineMapCache.size > 6) {
      const oldestKey = blameLineMapCache.keys().next().value;
      if (typeof oldestKey === 'string') {
        blameLineMapCache.delete(oldestKey);
      }
    }
  }

  if (!mapping || normalizedLine >= mapping.length) {
    return null;
  }

  const mapped = mapping[normalizedLine];
  return mapped > 0 ? mapped : null;
}

async function getGitBlameResponseForRequest(
  documentUri: vscode.Uri,
  request: RequestGitBlameMessage,
  currentDocumentText?: string,
  gitDocumentState?: GitDocumentState
): Promise<GitBlameLineResult> {
  const resolved = await resolveGitBlameForRequest(documentUri, request, currentDocumentText, gitDocumentState);
  return resolved.result;
}

async function getHeadBlameForLineFallback(
  baseline: GitBaselinePayload | null | undefined,
  lineNumber: number
): Promise<GitBlameLineResult | null> {
  if (!baseline?.repoRoot || !baseline.gitPath) {
    return null;
  }

  const result = await getGitBlameForLine({
    repoRoot: baseline.repoRoot,
    gitPath: baseline.gitPath,
    lineNumber,
    revision: baseline.headOid || 'HEAD'
  });
  return result.kind === 'commit' ? result : null;
}

type ResolvedGitBlameRequest = {
  baseline: GitBaselinePayload | null;
  result: GitBlameLineResult;
};

function normalizeTrailingEofVisualLineForGitBlame(
  requestedLineNumber: number,
  text?: string
): number {
  const normalized = Math.max(1, Math.floor(requestedLineNumber));
  if (typeof text !== 'string' || !text.endsWith('\n')) {
    return normalized;
  }

  const lineCount = text.split('\n').length;
  if (normalized !== lineCount) {
    return normalized;
  }

  // CodeMirror exposes a final empty line when the document ends with a newline,
  // but Git blame addresses the last real line instead.
  return Math.max(1, normalized - 1);
}

function isTrailingEofVisualLineRequest(
  requestedLineNumber: number,
  text?: string
): boolean {
  if (typeof text !== 'string' || !text.endsWith('\n')) {
    return false;
  }
  const normalized = Math.max(1, Math.floor(requestedLineNumber));
  const lineCount = text.split('\n').length;
  return normalized === lineCount;
}

async function resolveGitBlameForRequest(
  documentUri: vscode.Uri,
  request: Pick<RequestGitBlameMessage, 'lineNumber' | 'text'>,
  currentDocumentText?: string,
  gitDocumentState?: GitDocumentState
): Promise<ResolvedGitBlameRequest> {
  if (documentUri.scheme !== 'file') {
    return {
      baseline: null,
      result: { kind: 'unavailable', reason: 'not-repo' }
    };
  }

  const state = gitDocumentState ?? new GitDocumentState(documentUri.fsPath);
  let baseline = await state.resolveBaseline({ includeText: false });
  if (!baseline.available || !baseline.repoRoot || !baseline.gitPath) {
    return {
      baseline,
      result: {
        kind: 'unavailable',
        reason: baseline.reason === 'git-unavailable' ? 'git-unavailable' : 'not-repo'
      }
    };
  }

  if (!baseline.tracked) {
    return {
      baseline,
      result: { kind: 'unavailable', reason: 'untracked' }
    };
  }

  const snapshotText = typeof request.text === 'string'
    ? request.text
    : typeof currentDocumentText === 'string' && currentDocumentText.length <= MAX_BLAME_SNAPSHOT_TEXT_CHARS
      ? currentDocumentText
      : undefined;
  const lineResolutionText = typeof request.text === 'string' ? request.text : currentDocumentText;
  const normalizedRequestedLineNumber = Math.max(1, Math.floor(request.lineNumber));
  const lineNumberForBlame = normalizeTrailingEofVisualLineForGitBlame(
    request.lineNumber,
    lineResolutionText
  );

  const snapshotBlame = await getGitBlameForLine({
    repoRoot: baseline.repoRoot,
    gitPath: baseline.gitPath,
    lineNumber: lineNumberForBlame,
    contentsText: snapshotText
  });

  if (snapshotBlame.kind !== 'uncommitted') {
    return {
      baseline,
      result: snapshotBlame
    };
  }

  // Prefer showing the last committed author when a snapshot-based blame reports an
  // uncommitted line. This matches the "last Git history" expectation for gutter hover.
  const mappingText = typeof request.text === 'string' ? request.text : currentDocumentText;
  if (typeof mappingText === 'string' && typeof baseline.baseText !== 'string') {
    baseline = await state.resolveBaseline({ includeText: true });
  }
  const lineNumberForHistoricalMapping = isTrailingEofVisualLineRequest(request.lineNumber, lineResolutionText)
    ? normalizedRequestedLineNumber
    : lineNumberForBlame;
  const historicalLineNumber = (
    typeof mappingText === 'string'
      ? getMappedBaselineLineForRequest(baseline, mappingText, lineNumberForHistoricalMapping)
      : null
  );
  if (!historicalLineNumber) {
    // No reliable baseline mapping means this is most likely a newly inserted line
    // (or a line in a diff shape we couldn't map safely). Preserve "uncommitted".
    // Best-effort fallback to same-line HEAD blame helps modified lines in ambiguous
    // regions still show previous commit metadata. Added lines are handled in the
    // webview gutter hover and kept as uncommitted there.
    const directHeadBlame = await getHeadBlameForLineFallback(baseline, lineNumberForBlame);
    if (directHeadBlame) {
      return {
        baseline,
        result: directHeadBlame
      };
    }
    return {
      baseline,
      result: snapshotBlame
    };
  }
  const historicalBlame = await getGitBlameForLine({
    repoRoot: baseline.repoRoot,
    gitPath: baseline.gitPath,
    lineNumber: historicalLineNumber,
    revision: baseline.headOid || 'HEAD'
  });

  return {
    baseline,
    result: historicalBlame.kind === 'commit' ? historicalBlame : snapshotBlame
  };
}

async function openGitRevisionForLine(
  documentUri: vscode.Uri,
  request: OpenGitRevisionForLineMessage,
  currentDocumentText?: string,
  gitDocumentState?: GitDocumentState
): Promise<void> {
  const { baseline, result } = await resolveGitBlameForRequest(documentUri, {
    lineNumber: request.lineNumber,
    text: request.text
  }, currentDocumentText, gitDocumentState);

  let blame = result;
  const lineNumberForOpenFallback = normalizeTrailingEofVisualLineForGitBlame(
    request.lineNumber,
    typeof request.text === 'string' ? request.text : currentDocumentText
  );
  if (blame.kind !== 'commit') {
    // For modified lines, snapshot blame can report "uncommitted" and the diff-based
    // mapper may fail in ambiguous regions. Best-effort fallback to the same line in HEAD
    // so clicking the gutter can still open the previous version.
    const directHeadBlame = await getHeadBlameForLineFallback(baseline, lineNumberForOpenFallback);
    if (directHeadBlame) {
      blame = directHeadBlame;
    }
  }

  if (blame.kind !== 'commit') {
    return;
  }
  const worktreeUri = documentUri.scheme === 'file' ? documentUri : resolveWorktreeUriFromGitUri(documentUri);
  if (!worktreeUri || worktreeUri.scheme !== 'file') {
    return;
  }

  const gitPathAtCommit = blame.gitPathAtCommit || baseline?.gitPath;
  const repoRoot = baseline?.repoRoot;
  const commitFileFsPath = gitPathAtCommit && repoRoot ? path.join(repoRoot, ...gitPathAtCommit.split('/')) : worktreeUri.fsPath;
  const gitUriBase = vscode.Uri.file(commitFileFsPath);
  const gitRevisionUri = gitUriBase.with({
    scheme: 'git',
    query: JSON.stringify({
      path: commitFileFsPath,
      ref: blame.commit
    })
  });

  const targetLineNumber = blame.originalLineNumber ?? request.lineNumber;
  const line = Math.max(0, Math.floor(targetLineNumber) - 1);
  try {
    const gitDoc = await vscode.workspace.openTextDocument(gitRevisionUri);
    await vscode.window.showTextDocument(gitDoc, {
      preview: false,
      selection: new vscode.Range(line, 0, line, 0)
    });
    return;
  } catch {
    // Fall back to CLI snapshot content when the built-in git content provider
    // cannot resolve the commit/path combination (for example, rename history).
  }

  if (!repoRoot || !gitPathAtCommit) {
    return;
  }

  try {
    const result = await runGit(['show', `${blame.commit}:${gitPathAtCommit}`], {
      cwd: repoRoot,
      maxBytes: 2 * 1024 * 1024
    });
    const snapshotText = result.stdout.toString('utf8');
    const tempDoc = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: snapshotText
    });
    await vscode.window.showTextDocument(tempDoc, {
      preview: false,
      selection: new vscode.Range(line, 0, line, 0)
    });
  } catch {
    void vscode.window.showWarningMessage(`Unable to open commit ${blame.shortCommit} for this line.`);
  }
}

async function openGitWorktreeForLine(
  documentUri: vscode.Uri,
  request: OpenGitWorktreeForLineMessage
): Promise<void> {
  const worktreeUri = documentUri.scheme === 'file' ? documentUri : resolveWorktreeUriFromGitUri(documentUri);
  if (!worktreeUri || worktreeUri.scheme !== 'file') {
    return;
  }

  const gitDocumentState = new GitDocumentState(worktreeUri.fsPath);
  const baseline = await gitDocumentState.resolveBaseline({ includeText: false });
  if (!baseline.available || !baseline.repoRoot || !baseline.gitPath || !baseline.tracked) {
    const line = Math.max(0, Math.floor(request.lineNumber) - 1);
    const worktreeDoc = await vscode.workspace.openTextDocument(worktreeUri);
    await vscode.window.showTextDocument(worktreeDoc, {
      preview: false,
      selection: new vscode.Range(line, 0, line, 0)
    });
    return;
  }

  const commitBlame = await getHeadBlameForLineFallback(baseline, request.lineNumber);
  if (!commitBlame) {
    const line = Math.max(0, Math.floor(request.lineNumber) - 1);
    const worktreeDoc = await vscode.workspace.openTextDocument(worktreeUri);
    await vscode.window.showTextDocument(worktreeDoc, {
      preview: false,
      selection: new vscode.Range(line, 0, line, 0)
    });
    return;
  }

  const gitPathAtCommit = commitBlame.gitPathAtCommit || baseline.gitPath;
  const commitFileFsPath = gitPathAtCommit
    ? path.join(baseline.repoRoot, ...gitPathAtCommit.split('/'))
    : worktreeUri.fsPath;
  const leftUriBase = vscode.Uri.file(commitFileFsPath);
  const leftUri = leftUriBase.with({
    scheme: 'git',
    query: JSON.stringify({
      path: commitFileFsPath,
      ref: commitBlame.commit
    })
  });
  const rightUri = worktreeUri;
  const title = `${path.basename(worktreeUri.fsPath)} (${commitBlame.shortCommit} ↔ Working Tree)`;
  const line = Math.max(0, Math.floor(request.lineNumber) - 1);

  await vscode.commands.executeCommand(
    'vscode.diff',
    leftUri,
    rightUri,
    title,
    {
      preview: false,
      selection: new vscode.Range(line, 0, line, 0)
    }
  );
}

async function openExternalLink(rawHref: string): Promise<void> {
  try {
    const href = normalizeExternalHref(rawHref);
    if (!href) {
      return;
    }
    const uri = vscode.Uri.parse(href, true);
    await vscode.env.openExternal(uri);
  } catch {
    // Ignore invalid URIs emitted by the webview.
  }
}

async function openLink(rawHref: string, documentUri: vscode.Uri): Promise<void> {
  if (await openWikiLink(rawHref, documentUri)) {
    return;
  }
  if (await openLocalLink(rawHref, documentUri)) {
    return;
  }
  await openExternalLink(rawHref);
}

async function openLocalLink(rawHref: string, documentUri: vscode.Uri): Promise<boolean> {
  const targetUri = await resolveLocalLinkTargetUri(rawHref, documentUri);
  if (!targetUri) {
    return false;
  }

  await vscode.commands.executeCommand('vscode.open', targetUri, {
    preview: false
  });
  return true;
}

async function openWikiLink(rawHref: string, documentUri: vscode.Uri): Promise<boolean> {
  if (!rawHref.toLowerCase().startsWith(WIKI_LINK_SCHEME)) {
    return false;
  }

  const decoded = safeDecodeURIComponent(rawHref.slice(WIKI_LINK_SCHEME.length)).trim();
  if (!decoded) {
    return true;
  }

  const target = decoded.split('#', 1)[0]?.trim() ?? '';
  if (!target) {
    return true;
  }

  const targetUri = await resolveWikiLinkTargetUri(target, documentUri);
  if (!targetUri) {
    return true;
  }

  const targetDoc = await vscode.workspace.openTextDocument(targetUri);
  await vscode.window.showTextDocument(targetDoc, { preview: false });
  return true;
}

async function resolveWikiLinkTargets(
  targets: string[],
  documentUri: vscode.Uri
): Promise<Array<{ target: string; exists: boolean }>> {
  const uniqueTargets = Array.from(new Set(targets
    .map((target) => normalizeWikiTarget(target))
    .filter((target) => target.length > 0)));

  const resolved = await Promise.all(uniqueTargets.map(async (target) => {
    const targetUri = await resolveWikiLinkTargetUri(target, documentUri);
    return { target, exists: Boolean(targetUri) };
  }));

  return resolved;
}

function normalizeWikiTarget(target: string): string {
  const normalized = target.split('#', 1)[0]?.trim() ?? '';
  if (!normalized || SCHEME_RE.test(normalized)) {
    return '';
  }
  return normalized;
}

async function resolveWikiLinkTargetUri(target: string, documentUri: vscode.Uri): Promise<vscode.Uri | null> {
  const normalized = target.replace(/\\/g, path.sep);
  const basePath = path.isAbsolute(normalized)
    ? normalized
    : path.resolve(path.dirname(documentUri.fsPath), normalized);
  const ext = path.extname(normalized);
  const candidates = ext
    ? [basePath]
    : [`${basePath}.md`, `${basePath}.markdown`, basePath];

  for (const candidate of candidates) {
    const uri = vscode.Uri.file(candidate);
    if (await uriExists(uri)) {
      return uri;
    }
  }
  return null;
}

async function resolveLocalLinkTargetUri(rawHref: string, documentUri: vscode.Uri): Promise<vscode.Uri | null> {
  const trimmed = rawHref.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const [targetPath = ''] = trimmed.split(/[?#]/, 1);
  if (!targetPath) {
    return null;
  }

  if (/^file:/i.test(targetPath)) {
    try {
      const fileUri = vscode.Uri.parse(targetPath, true);
      return (await uriExists(fileUri)) ? fileUri : null;
    } catch {
      return null;
    }
  }

  if (SCHEME_RE.test(targetPath)) {
    return null;
  }

  const decodedPath = safeDecodeURIComponent(targetPath).replace(/\\/g, path.sep);
  const basePath = path.isAbsolute(decodedPath)
    ? decodedPath
    : path.resolve(path.dirname(documentUri.fsPath), decodedPath);
  const ext = path.extname(decodedPath);
  const candidates = ext
    ? [basePath]
    : [basePath, `${basePath}.md`, `${basePath}.markdown`];

  for (const candidate of candidates) {
    const uri = vscode.Uri.file(candidate);
    if (await uriExists(uri)) {
      return uri;
    }
  }

  return null;
}

async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars[Math.floor(Math.random() * chars.length)];
  }
  return nonce;
}

async function loadExportRuntimeModule(extensionUri: vscode.Uri): Promise<ExportRuntimeModule> {
  if (!exportRuntimeModulePromise) {
    const runtimePath = vscode.Uri.joinPath(extensionUri, 'dist', 'export-runtime.js').fsPath;
    const runtimeUrl = pathToFileURL(runtimePath).toString();
    exportRuntimeModulePromise = import(runtimeUrl)
      .then((mod: any) => unwrapExportRuntimeModule(mod))
      .catch((error) => {
        exportRuntimeModulePromise = null;
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to load export runtime (${runtimePath}). Run the extension build to regenerate it. ${message}`);
      });
  }

  return exportRuntimeModulePromise;
}

function unwrapExportRuntimeModule(mod: any): ExportRuntimeModule {
  let current = mod;
  for (let i = 0; i < 5; i += 1) {
    if (
      current &&
      typeof current.renderExportHtmlDocument === 'function' &&
      typeof current.writeFinalizedHtmlExport === 'function' &&
      typeof current.renderPdfFromHtmlExport === 'function'
    ) {
      return current as ExportRuntimeModule;
    }
    if (!current || typeof current !== 'object' || !('default' in current)) {
      break;
    }
    current = current.default;
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

function resolveWebviewImageSrc(rawUrl: string, documentUri: vscode.Uri, webview: vscode.Webview): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return '';
  }

  if (ALLOWED_IMAGE_SRC_RE.test(trimmed)) {
    return trimmed;
  }

  if (SCHEME_RE.test(trimmed) && !/^file:/i.test(trimmed)) {
    return trimmed;
  }

  const [pathPart = ''] = trimmed.split(/[?#]/, 1);
  let filePath = '';
  if (/^file:/i.test(trimmed)) {
    try {
      filePath = vscode.Uri.parse(pathPart, true).fsPath;
    } catch {
      filePath = '';
    }
  } else if (path.isAbsolute(pathPart)) {
    filePath = pathPart;
  } else {
    const decoded = safeDecodeURIComponent(pathPart);
    filePath = path.resolve(path.dirname(documentUri.fsPath), decoded);
  }

  if (!filePath) {
    return trimmed;
  }

  return webview.asWebviewUri(vscode.Uri.file(filePath)).toString();
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeExternalHref(rawHref: string): string {
  const trimmed = rawHref.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return '';
  }
  if (/^\/\//.test(trimmed)) {
    return `https:${trimmed}`;
  }
  if (SCHEME_RE.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function resolveWorktreeUriFromGitUri(uri: vscode.Uri): vscode.Uri | undefined {
  if (uri.scheme !== 'git') {
    return undefined;
  }

  const query = parseGitUriQuery(uri.query);
  if (query?.path && typeof query.path === 'string') {
    return vscode.Uri.file(query.path);
  }

  return uri.path ? vscode.Uri.file(uri.path) : undefined;
}

function resolveWorktreeUri(document: vscode.TextDocument): vscode.Uri {
  if (document.uri.scheme === 'file') {
    return document.uri;
  }

  return resolveWorktreeUriFromGitUri(document.uri) ?? document.uri;
}

function coerceCommandUri(value: unknown): vscode.Uri | undefined {
  if (value instanceof vscode.Uri) {
    return value;
  }

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidateRecords = [value as Record<string, unknown>];
  const directDocument = (value as { document?: unknown }).document;
  if (directDocument && typeof directDocument === 'object') {
    candidateRecords.push(directDocument as Record<string, unknown>);
  }

  for (const record of candidateRecords) {
    const nested = record.uri;
    if (nested instanceof vscode.Uri) {
      return nested;
    }
    const resource = record.resource;
    if (resource instanceof vscode.Uri) {
      return resource;
    }
    const resourceUri = record.resourceUri;
    if (resourceUri instanceof vscode.Uri) {
      return resourceUri;
    }

    const fromRaw = uriFromUnknown(record);
    if (fromRaw) {
      return fromRaw;
    }
    if (nested && typeof nested === 'object') {
      const fromNested = uriFromUnknown(nested);
      if (fromNested) {
        return fromNested;
      }
    }
    if (resource && typeof resource === 'object') {
      const fromResource = uriFromUnknown(resource);
      if (fromResource) {
        return fromResource;
      }
    }
    if (resourceUri && typeof resourceUri === 'object') {
      const fromResource = uriFromUnknown(resourceUri);
      if (fromResource) {
        return fromResource;
      }
    }
  }

  return undefined;
}

function uriFromUnknown(value: unknown): vscode.Uri | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<vscode.Uri> & {
    scheme?: unknown;
    path?: unknown;
    query?: unknown;
    fragment?: unknown;
    authority?: unknown;
  };

  if (typeof candidate.scheme !== 'string' || typeof candidate.path !== 'string') {
    return undefined;
  }

  try {
    return vscode.Uri.from({
      scheme: candidate.scheme,
      authority: typeof candidate.authority === 'string' ? candidate.authority : '',
      path: candidate.path,
      query: typeof candidate.query === 'string' ? candidate.query : '',
      fragment: typeof candidate.fragment === 'string' ? candidate.fragment : ''
    });
  } catch {
    return undefined;
  }
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

function parseGitUriQuery(query: string): { path?: unknown; ref?: unknown } | undefined {
  if (!query) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(query);
    return typeof parsed === 'object' && parsed !== null ? (parsed as { path?: unknown; ref?: unknown }) : undefined;
  } catch {
    try {
      const parsed = JSON.parse(decodeURIComponent(query));
      return typeof parsed === 'object' && parsed !== null ? (parsed as { path?: unknown; ref?: unknown }) : undefined;
    } catch {
      return undefined;
    }
  }
}

function getThemeSettings(): ThemeSettings {
  const config = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION);
  const colors = {} as ThemeColors;

  for (const key of themeColorKeys) {
    colors[key] = readThemeColor(config, `theme.${key}`, defaultThemeColors[key]);
  }

  return {
    colors,
    fonts: {
      live: readThemeFont(config, 'fonts.live', defaultThemeFonts.live),
      source: readThemeFont(config, 'fonts.source', defaultThemeFonts.source),
      fontSize: readThemeFontSize(config, 'fonts.fontSize', defaultThemeFonts.fontSize),
      liveLineHeight: readThemeLineHeight(config, 'fonts.liveLineHeight', defaultThemeFonts.liveLineHeight),
      sourceLineHeight: readThemeLineHeight(config, 'fonts.sourceLineHeight', defaultThemeFonts.sourceLineHeight)
    }
  };
}

function getAutoSaveEnabled(context: vscode.ExtensionContext): boolean {
  return getToggleSettingValue(context, AUTO_SAVE_SETTING_KEY, AUTO_SAVE_KEY, [AUTO_SAVE_LEGACY_SETTING_KEY]);
}

function getLineNumbersEnabled(context: vscode.ExtensionContext): boolean {
  return getToggleSettingValue(context, LINE_NUMBERS_SETTING_KEY, LINE_NUMBERS_KEY, [
    LINE_NUMBERS_LEGACY_ENABLED_SETTING_KEY,
    LINE_NUMBERS_LEGACY_SETTING_KEY
  ]);
}

function getGitChangesGutterEnabled(context: vscode.ExtensionContext): boolean {
  return getToggleSettingValue(context, GIT_CHANGES_GUTTER_SETTING_KEY, GIT_CHANGES_GUTTER_KEY, [
    GIT_CHANGES_GUTTER_LEGACY_VISIBLE_SETTING_KEY,
    GIT_CHANGES_GUTTER_LEGACY_VISIBILITY_SETTING_KEY,
    GIT_CHANGES_GUTTER_LEGACY_SETTING_KEY
  ]);
}

function getVimModeEnabled(context: vscode.ExtensionContext): boolean {
  return getToggleSettingValue(context, VIM_MODE_SETTING_KEY, VIM_MODE_KEY, [], false);
}

function getToggleSettingValue(
  context: vscode.ExtensionContext,
  settingKey: string,
  legacyStateKey: string,
  legacySettingKeys: readonly string[] = [],
  fallbackDefault = true
): boolean {
  const config = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION);
  if (hasExplicitConfigurationValue<boolean>(config, settingKey)) {
    return config.get<boolean>(settingKey, fallbackDefault);
  }
  for (const legacySettingKey of legacySettingKeys) {
    if (hasExplicitConfigurationValue<boolean>(config, legacySettingKey)) {
      return config.get<boolean>(legacySettingKey, fallbackDefault);
    }
  }
  return context.globalState.get<boolean>(legacyStateKey, fallbackDefault);
}

function getOutlinePosition(): OutlinePosition {
  const value = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION).get<string>('outline.position', 'right');
  return value === 'left' ? 'left' : 'right';
}

function getExportPdfBrowserPath(): string | undefined {
  const configured = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION).get<string>('export.pdf.browserPath', '');
  const trimmed = `${configured ?? ''}`.trim();
  return trimmed || undefined;
}

function getExportEditorFontEnvironment(): { editorFontFamily?: string; editorFontSizePx?: number } {
  const editorConfig = vscode.workspace.getConfiguration('editor');
  const fontFamily = `${editorConfig.get<string>('fontFamily', '') ?? ''}`.trim() || undefined;
  const fontSize = editorConfig.get<number>('fontSize');
  return {
    editorFontFamily: fontFamily,
    editorFontSizePx: typeof fontSize === 'number' && Number.isFinite(fontSize) ? fontSize : undefined
  };
}

function replaceFileExtension(filePath: string, ext: '.html' | '.pdf'): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}${ext}`);
}

async function migrateLegacyToggleSettings(context: vscode.ExtensionContext): Promise<void> {
  await migrateLegacyToggleSetting(context, AUTO_SAVE_SETTING_KEY, AUTO_SAVE_KEY);
  await migrateLegacyToggleSetting(context, LINE_NUMBERS_SETTING_KEY, LINE_NUMBERS_KEY);
  await migrateLegacyToggleSetting(context, GIT_CHANGES_GUTTER_SETTING_KEY, GIT_CHANGES_GUTTER_KEY);
}

async function migrateLegacyToggleSetting(
  context: vscode.ExtensionContext,
  settingKey: string,
  legacyStateKey: string
): Promise<void> {
  const legacyValue = context.globalState.get<boolean | undefined>(legacyStateKey);
  if (typeof legacyValue !== 'boolean') {
    return;
  }

  const config = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION);
  if (hasExplicitConfigurationValue<boolean>(config, settingKey)) {
    return;
  }

  if (legacyValue === true) {
    return;
  }

  try {
    await config.update(settingKey, legacyValue, vscode.ConfigurationTarget.Global);
  } catch {
    // Ignore configuration write failures to avoid breaking editor startup.
  }
}

function hasExplicitConfigurationValue<T>(config: vscode.WorkspaceConfiguration, key: string): boolean {
  const inspected = config.inspect<T>(key);
  if (!inspected) {
    return false;
  }

  const languageScoped = inspected as typeof inspected & {
    globalLanguageValue?: T;
    workspaceLanguageValue?: T;
    workspaceFolderLanguageValue?: T;
  };

  return (
    inspected.globalValue !== undefined ||
    inspected.workspaceValue !== undefined ||
    inspected.workspaceFolderValue !== undefined ||
    languageScoped.globalLanguageValue !== undefined ||
    languageScoped.workspaceLanguageValue !== undefined ||
    languageScoped.workspaceFolderLanguageValue !== undefined
  );
}

function readThemeColor(config: vscode.WorkspaceConfiguration, key: string, fallback: string): string {
  const value = config.get<string>(key, fallback);
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim();
  return normalized || fallback;
}

function readThemeFont(config: vscode.WorkspaceConfiguration, key: string, fallback: string): string {
  const value = config.get<string>(key, fallback);
  if (typeof value !== 'string') {
    return fallback;
  }
  return value.trim() || fallback;
}

function readThemeFontSize(config: vscode.WorkspaceConfiguration, key: string, fallback: number | null): number | null {
  const value = config.get<number | null>(key, fallback);
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function readThemeLineHeight(config: vscode.WorkspaceConfiguration, key: string, fallback: number): number {
  const value = config.get<number>(key, fallback);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(maxThemeLineHeight, Math.max(minThemeLineHeight, value));
}

async function resetThemeSettingsToDefaults(): Promise<void> {
  const section = 'markdownEditorOptimized';
  const config = vscode.workspace.getConfiguration(section);
  const keys = [
    ...themeColorKeys.map((key) => `theme.${key}`),
    'fonts.live',
    'fonts.source',
    'fonts.fontSize',
    'fonts.liveLineHeight',
    'fonts.sourceLineHeight'
  ];

  await clearThemeKeysForTarget(config, keys, vscode.ConfigurationTarget.Global);
  await clearThemeKeysForTarget(config, keys, vscode.ConfigurationTarget.Workspace);
  await clearThemeKeysForTarget(config, keys, vscode.ConfigurationTarget.WorkspaceFolder);
}

async function clearThemeKeysForTarget(
  config: vscode.WorkspaceConfiguration,
  keys: string[],
  target: vscode.ConfigurationTarget
): Promise<void> {
  for (const key of keys) {
    if (!hasThemeKeyValueAtTarget(config, key, target)) {
      continue;
    }
    await config.update(key, undefined, target);
  }
}

function hasThemeKeyValueAtTarget(
  config: vscode.WorkspaceConfiguration,
  key: string,
  target: vscode.ConfigurationTarget
): boolean {
  const inspected = config.inspect(key);
  if (!inspected) {
    return false;
  }
  if (target === vscode.ConfigurationTarget.Global) {
    return inspected.globalValue !== undefined;
  }
  if (target === vscode.ConfigurationTarget.Workspace) {
    return inspected.workspaceValue !== undefined;
  }
  if (target === vscode.ConfigurationTarget.WorkspaceFolder) {
    return inspected.workspaceFolderValue !== undefined;
  }
  return false;
}

async function handleSaveImageFromClipboard(
  message: SaveImageFromClipboardMessage,
  documentUri: vscode.Uri
): Promise<SavedImagePathMessage> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return {
      type: 'savedImagePath',
      requestId: message.requestId,
      success: false,
      error: 'No workspace folder open'
    };
  }

  const workspaceRoot = (vscode.workspace.getWorkspaceFolder(documentUri) ?? workspaceFolders[0]).uri;
  const config = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION);
  const imageFolder = config.get<string>('imageFolder', 'assets');

  try {
    const base64Data = message.imageData.replace(/^data:image\/[^;]+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');

    const assetsFolderUri = vscode.Uri.joinPath(workspaceRoot, imageFolder);

    try {
      await vscode.workspace.fs.stat(assetsFolderUri);
    } catch {
      await vscode.workspace.fs.createDirectory(assetsFolderUri);
    }

    const filePath = vscode.Uri.joinPath(assetsFolderUri, message.fileName);
    await vscode.workspace.fs.writeFile(filePath, imageBuffer);

    const relativePath = path.relative(path.dirname(documentUri.fsPath), filePath.fsPath).replace(/\\/g, '/');

    return {
      type: 'savedImagePath',
      requestId: message.requestId,
      success: true,
      path: relativePath
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to save image';
    return {
      type: 'savedImagePath',
      requestId: message.requestId,
      success: false,
      error: errorMessage
    };
  }
}

export function deactivate(): void {}

async function syncEditorAssociations(useAsDefault: boolean): Promise<void> {
  const config = vscode.workspace.getConfiguration('workbench');
  const associations = { ...(config.get<Record<string, string>>('editorAssociations') || {}) };
  const markdownAssociation = useAsDefault ? VIEW_TYPE : 'default';
  const next = {
    ...associations,
    '*.md': markdownAssociation,
    '*.markdown': markdownAssociation,
    'git:/**/*.md': 'default',
    'git:/**/*.markdown': 'default',
    'git:**/*.md': 'default',
    'git:**/*.markdown': 'default'
  };

  if (JSON.stringify(associations) === JSON.stringify(next)) {
    return;
  }

  await config.update('editorAssociations', next, vscode.ConfigurationTarget.Global);
}

async function updateEditorAssociations(): Promise<void> {
  await syncEditorAssociations(true);
}
