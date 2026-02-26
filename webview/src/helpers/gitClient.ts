interface GitBlameResult {
  kind: 'available' | 'unavailable';
  reason?: string;
  hash?: string;
  author?: string;
  date?: string;
  message?: string;
  lineNumber?: number;
}

interface PendingBlameRequest {
  cacheKey: string;
  timer: number;
  resolve: (result: GitBlameResult) => void;
  reject: (error: Error) => void;
}

interface GitClientOptions {
  vscode: any;
  getCurrentEditorText?: () => string | undefined;
  getSyncedText?: () => string | undefined;
  clearTransientUi?: () => void;
  maxBlameSnapshotChars?: number;
  blameTimeoutMs?: number;
}

interface GitClient {
  clearBlameCache: (options?: { hideTooltip?: boolean }) => void;
  bumpLocalEditGeneration: () => void;
  resetForInit: (options?: { hideTooltip?: boolean }) => void;
  requestBlameForLine: (options: { lineNumber: number }) => Promise<GitBlameResult>;
  openRevisionForLine: (options: { lineNumber: number }) => void;
  openWorktreeForLine: (options: { lineNumber: number }) => void;
  applyBaselineToEditor: (editor: any) => void;
  handleMessage: (message: any, options?: { editor?: any }) => boolean;
}

const defaultMaxBlameSnapshotChars = 500 * 1024;
const defaultBlameTimeoutMs = 8000;

const normalizeEol = (text: string | null | undefined): string => `${text ?? ''}`.replace(/\r\n?/g, '\n');

const normalizeLineNumber = (lineNumber: number): number => (
  Number.isFinite(lineNumber) ? Math.max(1, Math.floor(lineNumber)) : 1
);

function shouldIncludeBlameSnapshotText(currentText: string | undefined, syncedText: string | undefined, maxChars: number): boolean {
  if (typeof currentText !== 'string') {
    return false;
  }
  if (currentText.length > maxChars) {
    return false;
  }
  return normalizeEol(currentText) !== normalizeEol(syncedText);
}

export function createGitClient({
  vscode,
  getCurrentEditorText,
  getSyncedText,
  clearTransientUi,
  maxBlameSnapshotChars = defaultMaxBlameSnapshotChars,
  blameTimeoutMs = defaultBlameTimeoutMs
}: GitClientOptions): GitClient {
  let gitBaselineSnapshot: any = null;
  let pendingGitBaselineBeforeEditorMount: any = null;
  let gitBlameRequestCounter = 0;
  let localEditGeneration = 0;
  const pendingGitBlameRequests = new Map<string, PendingBlameRequest>();
  const gitBlameCache = new Map<string, GitBlameResult>();
  const inFlightGitBlameRequests = new Map<string, Promise<GitBlameResult>>();

  const clearBlameCache = ({ hideTooltip = true }: { hideTooltip?: boolean } = {}) => {
    gitBlameCache.clear();
    inFlightGitBlameRequests.clear();
    for (const [requestId, pending] of pendingGitBlameRequests) {
      window.clearTimeout(pending.timer);
      pending.reject(new Error('Blame request superseded'));
      pendingGitBlameRequests.delete(requestId);
    }
    if (hideTooltip) {
      clearTransientUi?.();
    }
  };

  const bumpLocalEditGeneration = () => {
    localEditGeneration += 1;
    clearBlameCache();
  };

  const resetForInit = ({ hideTooltip = false }: { hideTooltip?: boolean } = {}) => {
    localEditGeneration = 0;
    clearBlameCache({ hideTooltip });
  };

  const requestBlameForLine = ({ lineNumber }: { lineNumber: number }): Promise<GitBlameResult> => {
    const normalizedLine = normalizeLineNumber(lineNumber);
    const cacheKey = `${localEditGeneration}:${normalizedLine}`;
    const cached = gitBlameCache.get(cacheKey);
    if (cached) {
      return Promise.resolve(cached);
    }
    const inFlight = inFlightGitBlameRequests.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const requestId = `blame-${gitBlameRequestCounter++}`;
    const currentText = getCurrentEditorText?.();
    const message: any = {
      type: 'requestGitBlame',
      requestId,
      lineNumber: normalizedLine,
      localEditGeneration
    };

    if (shouldIncludeBlameSnapshotText(currentText, getSyncedText?.(), maxBlameSnapshotChars)) {
      message.text = currentText;
    }

    const requestPromise = new Promise<GitBlameResult>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        inFlightGitBlameRequests.delete(cacheKey);
        pendingGitBlameRequests.delete(requestId);
        resolve({ kind: 'unavailable', reason: 'error' });
      }, blameTimeoutMs);

      pendingGitBlameRequests.set(requestId, {
        cacheKey,
        timer,
        resolve: (result) => {
          window.clearTimeout(timer);
          inFlightGitBlameRequests.delete(cacheKey);
          gitBlameCache.set(cacheKey, result);
          resolve(result);
        },
        reject: (error) => {
          window.clearTimeout(timer);
          inFlightGitBlameRequests.delete(cacheKey);
          reject(error);
        }
      });

      vscode.postMessage(message);
    });

    inFlightGitBlameRequests.set(cacheKey, requestPromise);
    return requestPromise;
  };

  const openRevisionForLine = ({ lineNumber }: { lineNumber: number }) => {
    const normalizedLine = normalizeLineNumber(lineNumber);
    const currentText = getCurrentEditorText?.();
    const message: any = {
      type: 'openGitRevisionForLine',
      lineNumber: normalizedLine
    };
    if (shouldIncludeBlameSnapshotText(currentText, getSyncedText?.(), maxBlameSnapshotChars)) {
      message.text = currentText;
    }
    vscode.postMessage(message);
  };

  const openWorktreeForLine = ({ lineNumber }: { lineNumber: number }) => {
    const normalizedLine = normalizeLineNumber(lineNumber);
    vscode.postMessage({
      type: 'openGitWorktreeForLine',
      lineNumber: normalizedLine
    });
  };

  const applyBaselineToEditor = (editor: any) => {
    if (!editor) {
      return;
    }
    if (pendingGitBaselineBeforeEditorMount) {
      editor.setGitBaseline(pendingGitBaselineBeforeEditorMount);
      pendingGitBaselineBeforeEditorMount = null;
      return;
    }
    if (gitBaselineSnapshot) {
      editor.setGitBaseline(gitBaselineSnapshot);
    }
  };

  const handleMessage = (message: any, { editor }: { editor?: any } = {}): boolean => {
    if (message.type === 'gitBaselineChanged') {
      gitBaselineSnapshot = message.payload ?? null;
      if (editor) {
        editor.setGitBaseline(gitBaselineSnapshot);
      } else {
        pendingGitBaselineBeforeEditorMount = gitBaselineSnapshot;
      }
      return true;
    }

    if (message.type === 'gitBlameResult') {
      const pending = pendingGitBlameRequests.get(message.requestId);
      if (!pending) {
        return true;
      }
      pendingGitBlameRequests.delete(message.requestId);
      pending.resolve(message.result ?? { kind: 'unavailable', reason: 'error' });
      return true;
    }

    return false;
  };

  return {
    clearBlameCache,
    bumpLocalEditGeneration,
    resetForInit,
    requestBlameForLine,
    openRevisionForLine,
    openWorktreeForLine,
    applyBaselineToEditor,
    handleMessage
  };
}
