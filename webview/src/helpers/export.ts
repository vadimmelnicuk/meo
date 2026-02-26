import { themeColorKeys } from '../../../src/shared/themeDefaults';

export interface ExportStyleEnvironment {
  editorBackgroundColor: string;
  editorForegroundColor: string;
  codeBlockBackgroundColor: string;
  sideBarBackgroundColor: string;
  panelBorderColor: string;
  editorFontFamily: string;
  editorFontSizePx: number | undefined;
  liveFontFamily: string;
  sourceFontFamily: string;
  liveLineHeight: number | undefined;
  sourceLineHeight: number | undefined;
  meoThemeColors: Record<string, string>;
}

export const delay = (ms: number): Promise<void> => new Promise((resolve) => {
  window.setTimeout(resolve, ms);
});

export const getExportStyleEnvironment = (): ExportStyleEnvironment => {
  const rootStyles = getComputedStyle(document.documentElement);
  const bodyStyles = getComputedStyle(document.body);
  const editorEl = document.querySelector('.cm-editor');
  const editorStyles = editorEl ? getComputedStyle(editorEl) : null;

  const colorVar = (name: string, fallback = ''): string => {
    const value = rootStyles.getPropertyValue(name).trim();
    return value || fallback;
  };

  const fontSizeRaw = (editorStyles?.fontSize || bodyStyles.fontSize || '').trim();
  const parsedFontSize = Number.parseFloat(fontSizeRaw);
  const lineHeightLiveRaw = rootStyles.getPropertyValue('--meo-line-height-live').trim();
  const lineHeightSourceRaw = rootStyles.getPropertyValue('--meo-line-height-source').trim();
  const parsedLiveLineHeight = Number.parseFloat(lineHeightLiveRaw);
  const parsedSourceLineHeight = Number.parseFloat(lineHeightSourceRaw);
  const meoThemeColors: Record<string, string> = {};
  for (const key of themeColorKeys) {
    const value = rootStyles.getPropertyValue(`--meo-color-${key}`).trim();
    if (value) {
      meoThemeColors[key] = value;
    }
  }

  return {
    editorBackgroundColor: colorVar('--vscode-editor-background', bodyStyles.backgroundColor || ''),
    editorForegroundColor: colorVar('--vscode-editor-foreground', bodyStyles.color || ''),
    codeBlockBackgroundColor: colorVar('--vscode-textCodeBlock-background', ''),
    sideBarBackgroundColor: colorVar('--vscode-sideBar-background', ''),
    panelBorderColor: colorVar('--vscode-panel-border', ''),
    editorFontFamily: (editorStyles?.fontFamily || bodyStyles.fontFamily || '').trim(),
    editorFontSizePx: Number.isFinite(parsedFontSize) ? parsedFontSize : undefined,
    liveFontFamily: colorVar('--meo-font-live', ''),
    sourceFontFamily: colorVar('--meo-font-source', ''),
    liveLineHeight: Number.isFinite(parsedLiveLineHeight) ? parsedLiveLineHeight : undefined,
    sourceLineHeight: Number.isFinite(parsedSourceLineHeight) ? parsedSourceLineHeight : undefined,
    meoThemeColors
  };
};

export interface ExportSyncContext {
  inFlight: boolean;
  pendingText: string | null;
  syncedText: string;
  flushChanges: () => void;
  normalizeEol: (text: string) => string;
}

export const waitForExportSyncIdle = async (
  context: ExportSyncContext,
  timeoutMs = 15000
): Promise<void> => {
  const startedAt = Date.now();

  while (true) {
    if (!context.inFlight && context.pendingText !== null && context.normalizeEol(context.pendingText) !== context.syncedText) {
      context.flushChanges();
    }

    if (!context.inFlight && (context.pendingText === null || context.normalizeEol(context.pendingText) === context.syncedText)) {
      return;
    }

    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error('Timed out waiting for editor sync before export');
    }

    await delay(25);
  }
};

export interface ExportHandlerContext {
  vscode: any;
  getEditor: () => any;
  pendingText: string | null;
  pendingInitialText: string | null;
  syncedText: string;
  pendingDebounce: number | null;
  inFlight: boolean;
  flushChanges: () => void;
  normalizeEol: (text: string) => string;
  setPendingDebounce: (value: number | null) => void;
}

export const createExportHandler = (context: ExportHandlerContext) => {
  const getCurrentExportText = (): string => {
    const editor = context.getEditor();
    if (editor) {
      return editor.getText();
    }
    if (typeof context.pendingText === 'string') {
      return context.pendingText;
    }
    if (typeof context.pendingInitialText === 'string') {
      return context.pendingInitialText;
    }
    return context.syncedText;
  };

  const handleExportSnapshotRequest = async (requestId: string): Promise<void> => {
    try {
      if (context.pendingDebounce !== null) {
        window.clearTimeout(context.pendingDebounce);
        context.setPendingDebounce(null);
      }

      context.flushChanges();
      await waitForExportSyncIdle({
        inFlight: context.inFlight,
        pendingText: context.pendingText,
        syncedText: context.syncedText,
        flushChanges: context.flushChanges,
        normalizeEol: context.normalizeEol
      });

      const msg: WebviewMessage = {
        type: 'exportSnapshot',
        requestId,
        text: getCurrentExportText(),
        environment: getExportStyleEnvironment() as unknown as Record<string, unknown>
      };
      context.vscode.postMessage(msg);
    } catch (error) {
      const errMsg: WebviewMessage = {
        type: 'exportSnapshotError',
        requestId,
        error: error instanceof Error ? error.message : 'Failed to collect export snapshot'
      };
      context.vscode.postMessage(errMsg);
    }
  };

  const requestExport = (format: 'html' | 'pdf'): void => {
    if (format !== 'html' && format !== 'pdf') {
      return;
    }
    context.vscode.postMessage({ type: 'exportDocument', format });
  };

  return {
    handleExportSnapshotRequest,
    requestExport,
    getCurrentExportText,
    getExportStyleEnvironment
  };
};

export type ExportHandler = ReturnType<typeof createExportHandler>;
