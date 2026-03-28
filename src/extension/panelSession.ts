import * as path from 'node:path';
import * as vscode from 'vscode';
import type { AgentReviewHandoffController } from '../agents/reviewHandoff';
import {
  EXTENSION_CONFIG_SECTION,
  LINE_NUMBERS_SETTING_KEY,
  GIT_CHANGES_GUTTER_SETTING_KEY,
  getLineNumbersEnabled,
  getGitChangesGutterEnabled,
  getGitDiffLineHighlightsEnabled,
  getOutlinePosition,
  getOutlineVisible,
  getRememberPositionLines,
  getThemeSettings,
  getVimModeEnabled
} from '../shared/extensionConfig';
import { openLink, resolveLocalLinkTargets, resolveWebviewImageSrc, resolveWikiLinkTargets } from '../shared/documentLinks';
import { GitDocumentState, hashGitBaselinePayload } from '../git/documentState';
import { openGitRevisionForLine, openGitWorktreeForLine, resolveGitBlameForRequest } from '../git/blameActions';
import type { GitBaselinePayload, GitBlameLineResult } from '../git/types';
import type { ExportStyleEnvironment } from '../export/runtime';
import type { ThemeSettings } from '../shared/themeDefaults';
import type { OutlinePosition } from '../shared/extensionConfig';

export type EditorMode = 'live' | 'source';
export type ExportFormat = 'html' | 'pdf';

type FindOptions = {
  wholeWord: boolean;
  caseSensitive: boolean;
};

type InitMessage = {
  type: 'init';
  text: string;
  version: number;
  mode: EditorMode;
  lineNumbers: boolean;
  gitChangesGutter: boolean;
  gitDiffLineHighlights: boolean;
  vimMode: boolean;
  findOptions: FindOptions;
  outlinePosition: OutlinePosition;
  outlineVisible: boolean;
  theme: ThemeSettings;
  restoreTopLine?: number;
  restoreTopLineOffset?: number;
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

type FocusEditorMessage = {
  type: 'focusEditor';
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

type DraftChangedMessage = {
  type: 'draftChanged';
  text: string | null;
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

type ResolveLocalLinksMessage = {
  type: 'resolveLocalLinks';
  requestId: string;
  targets: string[];
};

type SaveDocumentMessage = {
  type: 'saveDocument';
};

type ExportDocumentMessage = {
  type: 'exportDocument';
  format: ExportFormat;
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

type SetOutlineVisibleMessage = {
  type: 'setOutlineVisible';
  visible: boolean;
};

type SetFindOptionsMessage = {
  type: 'setFindOptions';
  wholeWord?: boolean;
  caseSensitive?: boolean;
  findOptions?: Partial<FindOptions>;
};

type ViewPositionChangedMessage = {
  type: 'viewPositionChanged';
  topLine: number;
  topLineOffset?: number;
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

type ResolvedLocalLinksMessage = {
  type: 'resolvedLocalLinks';
  requestId: string;
  results: Array<{ target: string; exists: boolean }>;
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
  text?: string;
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

type WebviewMessage =
  | ApplyChangesMessage
  | DraftChangedMessage
  | SetModeMessage
  | SetLineNumbersMessage
  | SetGitChangesGutterMessage
  | SetOutlineVisibleMessage
  | SetFindOptionsMessage
  | ViewPositionChangedMessage
  | OpenLinkMessage
  | ResolveImageSrcMessage
  | ResolveWikiLinksMessage
  | ResolveLocalLinksMessage
  | SaveDocumentMessage
  | ExportDocumentMessage
  | ExportSnapshotMessage
  | ExportSnapshotErrorMessage
  | RequestGitBlameMessage
  | OpenGitRevisionForLineMessage
  | OpenGitWorktreeForLineMessage
  | SaveImageFromClipboardMessage
  | { type: 'ready' };

type RefreshGitBaselineOptions = {
  forcePost?: boolean;
  forceReload?: boolean;
};

type PendingExportSnapshot = {
  resolve: (value: { text: string; environment?: ExportStyleEnvironment }) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type RememberedViewPosition = {
  line: number;
  lineOffset: number;
  updatedAt: number;
};

const REMEMBERED_VIEW_POSITIONS_STATE_KEY = 'rememberedViewPositionsByDocument';
const MAX_REMEMBERED_VIEW_POSITIONS = 300;
const REMEMBERED_EOF_NEAR_THRESHOLD_LINES = 10;
const REMEMBERED_EOF_BACKOFF_LINES = 10;

type PanelSessionControllerParams = {
  panel: vscode.WebviewPanel;
  document: vscode.TextDocument;
  documentUri: vscode.Uri;
  context: vscode.ExtensionContext;
  agentReviewHandoff: AgentReviewHandoffController;
  onExportDocument: (session: PanelSession, format: ExportFormat) => Promise<void>;
  getFindOptions: () => FindOptions;
  setFindOptions: (options: FindOptions) => Promise<void>;
  setOutlineVisible: (visible: boolean) => Promise<void>;
  onPanelActivated: (panel: vscode.WebviewPanel) => void;
  onPanelViewStateChanged: () => void;
  onPanelDisposed: (panel: vscode.WebviewPanel) => void;
};

export type PanelSession = {
  panel: vscode.WebviewPanel;
  document: vscode.TextDocument;
  documentUri: vscode.Uri;
  gitDocumentState: GitDocumentState;
  getMode: () => EditorMode;
  ensureInitDelivered: () => Promise<void>;
  requestExportSnapshot: () => Promise<{ text: string; environment?: ExportStyleEnvironment }>;
  rejectPendingExportSnapshots: (reason: Error) => void;
  refreshGitBaseline: (options?: RefreshGitBaselineOptions) => void;
  getGitRepoRoot: () => string | null;
};

export type PanelSessionController = {
  session: PanelSession;
  handleMessage: (raw: WebviewMessage) => Promise<void>;
  dispose: () => void;
};

export function createPanelSessionController(params: PanelSessionControllerParams): PanelSessionController {
  const {
    panel,
    document,
    documentUri,
    context,
    agentReviewHandoff,
    onExportDocument,
    getFindOptions,
    setFindOptions,
    setOutlineVisible,
    onPanelActivated,
    onPanelViewStateChanged,
    onPanelDisposed
  } = params;

  const documentKey = document.uri.toString();
  let mode: EditorMode = 'live';
  let applyQueue: Promise<void> = Promise.resolve();
  let webviewReady = false;
  let initDelivered = false;
  let isApplyingOwnChange = false;
  let gitRefreshRunning = false;
  let gitRefreshPending = false;
  let gitRefreshPendingForcePost = false;
  let gitRefreshPendingForceReload = false;
  let lastSentRevealSelectionKey: string | null = null;
  let pendingRevealSelection: RevealSelectionPayload | null = null;
  let pendingRestoreTopLine: number | null = null;
  let pendingRestoreTopLineOffset = 0;
  let pendingDraftText: string | null = null;
  let lastSavedRememberedLine: number | null = null;
  let lastSavedRememberedLineOffset = 0;
  let disposed = false;
  const workspaceRoot = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
  const gitDocumentState = new GitDocumentState(documentUri.fsPath, workspaceRoot);
  const pendingExportSnapshots = new Map<string, PendingExportSnapshot>();

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    applyQueue = applyQueue.then(task, task);
    return applyQueue;
  };

  const reportBackgroundError = (contextLabel: string, error: unknown): void => {
    if (disposed) {
      return;
    }
    console.error(`[MEO panelSession] ${contextLabel}`, error);
  };

  const runBackground = (promise: Promise<unknown>, contextLabel: string): void => {
    void promise.catch((error) => {
      reportBackgroundError(contextLabel, error);
    });
  };

  const postToWebview = async (message: Record<string, unknown>): Promise<boolean> => {
    if (disposed) {
      return false;
    }
    try {
      return await panel.webview.postMessage(message);
    } catch {
      return false;
    }
  };

  const applyPendingDraftIfNeeded = async (): Promise<boolean> => {
    const draftText = pendingDraftText;
    pendingDraftText = null;
    if (draftText === null) {
      return false;
    }

    const currentText = document.getText();
    const normalizedCurrent = currentText.replace(/\r\n/g, '\n');
    const normalizedDraft = draftText.replace(/\r\n/g, '\n');
    if (normalizedCurrent === normalizedDraft) {
      return false;
    }

    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(currentText.length));
    agentReviewHandoff.noteRecentMEOOwnedFileChangeForUri(document.uri);
    edit.replace(document.uri, fullRange, draftText);
    return vscode.workspace.applyEdit(edit);
  };

  const clearRememberedViewPosition = async (): Promise<void> => {
    const rememberedPositions = getRememberedViewPositionMap(context.workspaceState);
    if (!(documentKey in rememberedPositions)) {
      return;
    }
    delete rememberedPositions[documentKey];
    await context.workspaceState.update(REMEMBERED_VIEW_POSITIONS_STATE_KEY, rememberedPositions);
    lastSavedRememberedLine = null;
    lastSavedRememberedLineOffset = 0;
  };

  const saveRememberedViewPosition = async (topLine: number, topLineOffset: number | undefined): Promise<void> => {
    const minLines = getRememberPositionLines();
    if (document.lineCount < minLines) {
      await clearRememberedViewPosition();
      return;
    }

    const normalizedRemembered = normalizeRememberedTopLine(topLine, topLineOffset, document.lineCount);
    const clampedLine = normalizedRemembered.line;
    const normalizedOffset = normalizedRemembered.lineOffset;
    if (lastSavedRememberedLine === clampedLine && lastSavedRememberedLineOffset === normalizedOffset) {
      return;
    }

    const rememberedPositions = getRememberedViewPositionMap(context.workspaceState);
    const existing = rememberedPositions[documentKey];
    if (existing?.line === clampedLine && existing.lineOffset === normalizedOffset) {
      lastSavedRememberedLine = clampedLine;
      lastSavedRememberedLineOffset = normalizedOffset;
      return;
    }

    rememberedPositions[documentKey] = {
      line: clampedLine,
      lineOffset: normalizedOffset,
      updatedAt: Date.now()
    };

    await context.workspaceState.update(
      REMEMBERED_VIEW_POSITIONS_STATE_KEY,
      pruneRememberedViewPositionMap(rememberedPositions)
    );
    lastSavedRememberedLine = clampedLine;
    lastSavedRememberedLineOffset = normalizedOffset;
  };

  const sendInit = async (): Promise<boolean> => {
    const message: InitMessage = {
      type: 'init',
      text: document.getText(),
      version: document.version,
      mode,
      lineNumbers: getLineNumbersEnabled(context),
      gitChangesGutter: getGitChangesGutterEnabled(context),
      gitDiffLineHighlights: getGitDiffLineHighlightsEnabled(),
      vimMode: getVimModeEnabled(context),
      findOptions: getFindOptions(),
      outlinePosition: getOutlinePosition(),
      outlineVisible: getOutlineVisible(context),
      theme: getThemeSettings(),
      restoreTopLine: pendingRestoreTopLine ?? undefined,
      restoreTopLineOffset: pendingRestoreTopLine === null ? undefined : pendingRestoreTopLineOffset
    };
    return postToWebview(message);
  };

  const sendDocChanged = async (): Promise<boolean> => {
    const message: DocChangedMessage = {
      type: 'docChanged',
      text: document.getText(),
      version: document.version
    };
    return postToWebview(message);
  };

  const sendApplied = async (version: number): Promise<boolean> => {
    const message: AppliedMessage = {
      type: 'applied',
      version
    };
    return postToWebview(message);
  };

  const sendGitBaselineChanged = async (options: RefreshGitBaselineOptions = {}): Promise<boolean> => {
    if (!initDelivered) {
      return false;
    }

    const payload = await gitDocumentState.resolveBaseline({
      includeText: true,
      force: options.forceReload === true
    });
    gitDocumentState.noteBaselinePayload(payload);
    const payloadHash = hashGitBaselinePayload(payload);
    if (!options.forcePost && payloadHash === gitDocumentState.getLastSentBaselineHash()) {
      return true;
    }

    const message: GitBaselineChangedMessage = {
      type: 'gitBaselineChanged',
      version: document.version,
      payload
    };
    const posted = await postToWebview(message);
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
    if (disposed || initDelivered || !webviewReady) {
      return;
    }
    const posted = await sendInit();
    if (posted) {
      initDelivered = true;
    }
  };

  const requestExportSnapshot = async (): Promise<{ text: string; environment?: ExportStyleEnvironment }> => {
    await ensureInitDelivered();
    if (disposed) {
      throw new Error('The editor was closed before export completed.');
    }
    const requestId = `export-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

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
    const posted = await postToWebview(message);
    if (!posted) {
      rejectPendingExportSnapshot(requestId, new Error('The editor webview is not ready to export.'));
    }

    return response;
  };

  const rejectPendingExportSnapshot = (requestId: string, error: Error): void => {
    const pending = pendingExportSnapshots.get(requestId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    pendingExportSnapshots.delete(requestId);
    pending.reject(error);
  };

  const resolvePendingExportSnapshot = (
    requestId: string,
    value: { text: string; environment?: ExportStyleEnvironment }
  ): void => {
    const pending = pendingExportSnapshots.get(requestId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    pendingExportSnapshots.delete(requestId);
    pending.resolve(value);
  };

  const rejectPendingExportSnapshots = (error: Error): void => {
    for (const requestId of pendingExportSnapshots.keys()) {
      rejectPendingExportSnapshot(requestId, error);
    }
  };

  const runPendingGitRefreshes = async (): Promise<void> => {
    if (gitRefreshRunning || !webviewReady) {
      return;
    }
    gitRefreshRunning = true;
    try {
      while (gitRefreshPending) {
        const nextOptions: RefreshGitBaselineOptions = {
          forcePost: gitRefreshPendingForcePost,
          forceReload: gitRefreshPendingForceReload
        };
        gitRefreshPending = false;
        gitRefreshPendingForcePost = false;
        gitRefreshPendingForceReload = false;
        try {
          await ensureInitDelivered();
          if (!initDelivered) {
            gitRefreshPending = true;
            gitRefreshPendingForcePost = gitRefreshPendingForcePost || nextOptions.forcePost === true;
            gitRefreshPendingForceReload = gitRefreshPendingForceReload || nextOptions.forceReload === true;
            return;
          }
          await sendGitBaselineChanged(nextOptions);
        } catch {
          // Keep refresh coalescing alive across transient git/webview failures.
        }
      }
    } finally {
      gitRefreshRunning = false;
      if (gitRefreshPending) {
        runBackground(runPendingGitRefreshes(), 'runPendingGitRefreshes.retry');
      }
    }
  };

  const refreshGitBaseline = (options: RefreshGitBaselineOptions = {}): void => {
    if (options.forceReload) {
      gitDocumentState.invalidate();
    }
    gitRefreshPending = true;
    gitRefreshPendingForcePost = gitRefreshPendingForcePost || options.forcePost === true;
    gitRefreshPendingForceReload = gitRefreshPendingForceReload || options.forceReload === true;
    runBackground(runPendingGitRefreshes(), 'runPendingGitRefreshes');
  };

  const isTextEditorForDocument = (textEditor: vscode.TextEditor | undefined): textEditor is vscode.TextEditor => {
    if (!textEditor) {
      return false;
    }
    return textEditor.document.uri.toString() === documentKey;
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
    if (!webviewReady) {
      pendingRevealSelection = selection;
      return;
    }
    await ensureInitDelivered();
    if (!initDelivered) {
      pendingRevealSelection = selection;
      return;
    }
    const message: RevealSelectionMessage = {
      type: 'revealSelection',
      anchor: selection.anchor,
      head: selection.head
    };
    const posted = await postToWebview(message);
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
    await postRevealSelection(pendingRevealSelection);
  };

  const postFocusEditor = async (): Promise<void> => {
    if (!webviewReady) {
      return;
    }
    await ensureInitDelivered();
    if (!initDelivered) {
      return;
    }
    const message: FocusEditorMessage = { type: 'focusEditor' };
    await postToWebview(message);
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

  const resolveRememberedTopLineForInit = (): { line: number; lineOffset: number } | null => {
    const minLines = getRememberPositionLines();
    if (document.lineCount < minLines) {
      runBackground(clearRememberedViewPosition(), 'clearRememberedViewPosition.initThreshold');
      return null;
    }

    if (pendingRevealSelection !== null) {
      return null;
    }

    const rememberedPositions = getRememberedViewPositionMap(context.workspaceState);
    const remembered = rememberedPositions[documentKey];
    if (!remembered) {
      return null;
    }

    const normalizedRemembered = normalizeRememberedTopLine(remembered.line, remembered.lineOffset, document.lineCount);
    const clampedLine = normalizedRemembered.line;
    const lineOffset = normalizedRemembered.lineOffset;
    if (
      normalizedRemembered.adjustedForEof &&
      (remembered.line !== clampedLine || normalizeLineOffset(remembered.lineOffset) !== lineOffset)
    ) {
      rememberedPositions[documentKey] = {
        line: clampedLine,
        lineOffset,
        updatedAt: Date.now()
      };
      runBackground(
        context.workspaceState.update(
          REMEMBERED_VIEW_POSITIONS_STATE_KEY,
          pruneRememberedViewPositionMap(rememberedPositions)
        ),
        'saveRememberedViewPosition.eofBackoff'
      );
    }
    lastSavedRememberedLine = clampedLine;
    lastSavedRememberedLineOffset = lineOffset;
    return {
      line: clampedLine,
      lineOffset
    };
  };

  const initialRevealEditor = findEditorForDocumentReveal();
  if (initialRevealEditor) {
    pendingRevealSelection = revealSelectionForTextEditor(initialRevealEditor);
  } else {
    const initialOffset = parseRevealOffsetFromUriFragment(document.uri);
    pendingRevealSelection = initialOffset === null ? null : { anchor: initialOffset, head: initialOffset };
  }
  const rememberedTopLine = resolveRememberedTopLineForInit();
  if (rememberedTopLine) {
    pendingRestoreTopLine = rememberedTopLine.line;
    pendingRestoreTopLineOffset = rememberedTopLine.lineOffset;
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

  const handleMessage = async (raw: WebviewMessage): Promise<void> => {
    if (disposed) {
      return;
    }
    switch (raw.type) {
      case 'ready':
        webviewReady = true;
        await ensureInitDelivered();
        await flushPendingRevealSelection();
        gitRefreshPending = true;
        gitRefreshPendingForcePost = true;
        await runPendingGitRefreshes();
        return;
      case 'setMode':
        mode = raw.mode;
        return;
      case 'setLineNumbers': {
        const visible = raw.visible ?? raw.enabled;
        if (typeof visible !== 'boolean') {
          return;
        }
        await vscode.workspace
          .getConfiguration(EXTENSION_CONFIG_SECTION)
          .update(LINE_NUMBERS_SETTING_KEY, visible, vscode.ConfigurationTarget.Global);
        return;
      }
      case 'setGitChangesGutter': {
        const visible = raw.visible ?? raw.enabled;
        if (typeof visible !== 'boolean') {
          return;
        }
        await vscode.workspace
          .getConfiguration(EXTENSION_CONFIG_SECTION)
          .update(GIT_CHANGES_GUTTER_SETTING_KEY, visible, vscode.ConfigurationTarget.Global);
        return;
      }
      case 'setOutlineVisible':
        await setOutlineVisible(raw.visible);
        return;
      case 'setFindOptions': {
        const wholeWord = raw.findOptions?.wholeWord ?? raw.wholeWord;
        const caseSensitive = raw.findOptions?.caseSensitive ?? raw.caseSensitive;
        await setFindOptions({
          wholeWord: wholeWord === true,
          caseSensitive: caseSensitive === true
        });
        return;
      }
      case 'viewPositionChanged':
        if (Number.isFinite(raw.topLine)) {
          await enqueue(async () => {
            await saveRememberedViewPosition(raw.topLine, raw.topLineOffset);
          });
        }
        return;
      case 'exportDocument':
        await onExportDocument(session, raw.format);
        return;
      case 'openLink':
        await openLink(raw.href, documentUri);
        return;
      case 'resolveImageSrc': {
        const response: ResolvedImageSrcMessage = {
          type: 'resolvedImageSrc',
          requestId: raw.requestId,
          resolvedUrl: resolveWebviewImageSrc(raw.url, documentUri, panel.webview)
        };
        await postToWebview(response);
        return;
      }
      case 'resolveWikiLinks': {
        const response: ResolvedWikiLinksMessage = {
          type: 'resolvedWikiLinks',
          requestId: raw.requestId,
          results: await resolveWikiLinkTargets(raw.targets, documentUri)
        };
        await postToWebview(response);
        return;
      }
      case 'resolveLocalLinks': {
        const response: ResolvedLocalLinksMessage = {
          type: 'resolvedLocalLinks',
          requestId: raw.requestId,
          results: await resolveLocalLinkTargets(raw.targets, documentUri)
        };
        await postToWebview(response);
        return;
      }
      case 'exportSnapshot':
        resolvePendingExportSnapshot(raw.requestId, {
          text: raw.text,
          environment: raw.environment
        });
        return;
      case 'exportSnapshotError':
        rejectPendingExportSnapshot(raw.requestId, new Error(raw.message || 'Failed to collect export snapshot.'));
        return;
      case 'requestGitBlame': {
        const resolved = await resolveGitBlameForRequest(documentUri, raw, document.getText(), gitDocumentState);
        const response: GitBlameResultMessage = {
          type: 'gitBlameResult',
          requestId: raw.requestId,
          lineNumber: raw.lineNumber,
          localEditGeneration: raw.localEditGeneration,
          result: resolved.result
        };
        await postToWebview(response);
        return;
      }
      case 'openGitRevisionForLine':
        await openGitRevisionForLine(documentUri, raw, document.getText(), gitDocumentState);
        return;
      case 'openGitWorktreeForLine':
        await openGitWorktreeForLine(documentUri, raw, document.getText(), gitDocumentState);
        return;
      case 'applyChanges':
        agentReviewHandoff.noteRecentMEOOwnedFileChangeForUri(document.uri);
        isApplyingOwnChange = true;
        try {
          await enqueue(async () => {
            await applyDocumentChanges(document, raw, sendDocChanged, sendApplied);
          });
        } finally {
          isApplyingOwnChange = false;
        }
        return;
      case 'draftChanged':
        pendingDraftText = raw.text;
        return;
      case 'saveDocument':
        isApplyingOwnChange = true;
        try {
          await enqueue(async () => {
            await document.save();
          });
        } finally {
          isApplyingOwnChange = false;
        }
        return;
      case 'saveImageFromClipboard': {
        const response = await handleSaveImageFromClipboard(raw, documentUri);
        await postToWebview(response);
        return;
      }
    }
  };

  const messageSubscription = panel.webview.onDidReceiveMessage((raw: WebviewMessage) => {
    runBackground(handleMessage(raw), 'handleMessage');
  });

  const documentChangeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.document.uri.toString() !== documentKey) {
      return;
    }

    // Save/dirty-state transitions can emit document events without text edits.
    if (event.contentChanges.length === 0) {
      return;
    }

    if (isApplyingOwnChange) {
      return;
    }

    runBackground(enqueue(async () => {
      await sendDocChanged();
    }), 'sendDocChanged');
  });

  const documentSaveSubscription = vscode.workspace.onDidSaveTextDocument((savedDocument) => {
    if (savedDocument.uri.toString() !== documentKey) {
      return;
    }
    refreshGitBaseline({ forceReload: true });
  });

  const textEditorSelectionSubscription = vscode.window.onDidChangeTextEditorSelection((event) => {
    if (!isTextEditorForDocument(event.textEditor)) {
      return;
    }
    runBackground(sendRevealSelectionForEditor(event.textEditor), 'sendRevealSelectionForEditor.selection');
  });

  const activeTextEditorSubscription = vscode.window.onDidChangeActiveTextEditor((textEditor) => {
    if (!isTextEditorForDocument(textEditor)) {
      return;
    }
    runBackground(sendRevealSelectionForEditor(textEditor), 'sendRevealSelectionForEditor.activeEditor');
  });

  const visibleTextEditorsSubscription = vscode.window.onDidChangeVisibleTextEditors(() => {
    runBackground(sendRevealSelectionForEditor(findEditorForDocumentReveal()), 'sendRevealSelectionForEditor.visibleEditors');
  });

  const viewStateSubscription = panel.onDidChangeViewState((event) => {
    if (event.webviewPanel.active) {
      onPanelActivated(event.webviewPanel);
      refreshGitBaseline({ forcePost: true });
      runBackground(flushPendingRevealSelection(), 'flushPendingRevealSelection');
      runBackground(sendRevealSelectionForEditor(findEditorForDocumentReveal()), 'sendRevealSelectionForEditor.viewState');
      runBackground(postFocusEditor(), 'postFocusEditor');
    }
    onPanelViewStateChanged();
  });

  const disposeSubscription = panel.onDidDispose(() => {
    dispose();
  });

  refreshGitBaseline({ forcePost: true });
  runBackground(sendRevealSelectionForEditor(findEditorForDocumentReveal()), 'sendRevealSelectionForEditor.startup');

  const dispose = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;

    runBackground(enqueue(async () => {
      try {
        // Best-effort recovery for edits that never made it through the debounce/apply round-trip.
        await applyPendingDraftIfNeeded();
      } catch {
        // Ignore dispose-time recovery failures to avoid surfacing noisy teardown errors.
      }
    }), 'disposeDraftRecovery');

    rejectPendingExportSnapshots(new Error('The editor was closed before export completed.'));
    messageSubscription.dispose();
    documentChangeSubscription.dispose();
    documentSaveSubscription.dispose();
    textEditorSelectionSubscription.dispose();
    activeTextEditorSubscription.dispose();
    visibleTextEditorsSubscription.dispose();
    viewStateSubscription.dispose();
    disposeSubscription.dispose();
    onPanelDisposed(panel);
  };

  return {
    session,
    handleMessage,
    dispose
  };
}

function clampLineNumber(value: number, maxLine: number): number {
  const numeric = Number.isFinite(value) ? Math.floor(value) : 1;
  const max = Math.max(1, Math.floor(maxLine));
  return Math.max(1, Math.min(numeric, max));
}

function normalizeLineOffset(value: number | undefined): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.round(numeric * 100) / 100);
}

function normalizeRememberedTopLine(
  line: number,
  lineOffset: number | undefined,
  maxLine: number
): { line: number; lineOffset: number; adjustedForEof: boolean } {
  const clampedLine = clampLineNumber(line, maxLine);
  const normalizedOffset = normalizeLineOffset(lineOffset);
  const nearEndLine = Math.max(1, maxLine - REMEMBERED_EOF_NEAR_THRESHOLD_LINES + 1);
  if (clampedLine < nearEndLine) {
    return {
      line: clampedLine,
      lineOffset: normalizedOffset,
      adjustedForEof: false
    };
  }
  return {
    line: Math.max(1, clampedLine - REMEMBERED_EOF_BACKOFF_LINES),
    lineOffset: 0,
    adjustedForEof: true
  };
}

function getRememberedViewPositionMap(workspaceState: vscode.Memento): Record<string, RememberedViewPosition> {
  const stored = workspaceState.get<unknown>(REMEMBERED_VIEW_POSITIONS_STATE_KEY);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return {};
  }

  const entries: Record<string, RememberedViewPosition> = {};
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    if (typeof key !== 'string' || !key) {
      continue;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      continue;
    }
    const record = value as Partial<RememberedViewPosition>;
    const line = Number(record.line);
    const lineOffset = Number(record.lineOffset);
    const updatedAt = Number(record.updatedAt);
    if (!Number.isFinite(line) || !Number.isFinite(updatedAt)) {
      continue;
    }
    entries[key] = {
      line: Math.max(1, Math.floor(line)),
      lineOffset: normalizeLineOffset(lineOffset),
      updatedAt: Math.floor(updatedAt)
    };
  }
  return entries;
}

function pruneRememberedViewPositionMap(
  entries: Record<string, RememberedViewPosition>
): Record<string, RememberedViewPosition> {
  const sortedEntries = Object.entries(entries)
    .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_REMEMBERED_VIEW_POSITIONS);
  return Object.fromEntries(sortedEntries);
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
  const documentText = document.getText();
  const mappedOffsetCache = new Map<number, number>();
  const mapOffset = (offset: number): number => {
    const cached = mappedOffsetCache.get(offset);
    if (typeof cached === 'number') {
      return cached;
    }
    const mapped = mapNormalizedOffsetToDocumentOffset(documentText, offset);
    mappedOffsetCache.set(offset, mapped);
    return mapped;
  };

  for (const change of sortedChanges) {
    // Webview offsets are LF-normalized; remap to real document offsets before applying edits.
    const mappedFrom = mapOffset(change.from);
    const mappedTo = mapOffset(change.to);
    const startOffset = Math.min(mappedFrom, mappedTo);
    const endOffset = Math.max(mappedFrom, mappedTo);
    const range = new vscode.Range(
      document.positionAt(startOffset),
      document.positionAt(endOffset)
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

function mapNormalizedOffsetToDocumentOffset(documentText: string, normalizedOffset: number): number {
  const target = Number.isFinite(normalizedOffset) ? Math.max(0, normalizedOffset) : documentText.length;
  if (target === 0) {
    return 0;
  }

  let normalizedIndex = 0;
  let documentIndex = 0;

  while (documentIndex < documentText.length && normalizedIndex < target) {
    if (documentText.charCodeAt(documentIndex) === 13) {
      if (documentText.charCodeAt(documentIndex + 1) === 10) {
        documentIndex += 2;
      } else {
        documentIndex += 1;
      }
      normalizedIndex += 1;
      continue;
    }

    documentIndex += 1;
    normalizedIndex += 1;
  }

  return documentIndex;
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

    const relativePath = path.relative(path.dirname(documentUri.fsPath), filePath.fsPath);

    return {
      type: 'savedImagePath',
      requestId: message.requestId,
      success: true,
      path: relativePath.replace(/\\/g, '/')
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
