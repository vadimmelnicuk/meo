const defaultMaxBlameSnapshotChars = 500 * 1024;
const defaultBlameTimeoutMs = 8000;

const normalizeEol = (text) => `${text ?? ''}`.replace(/\r\n?/g, '\n');

const normalizeLineNumber = (lineNumber) => (
  Number.isFinite(lineNumber) ? Math.max(1, Math.floor(lineNumber)) : 1
);

function shouldIncludeBlameSnapshotText(currentText, syncedText, maxChars) {
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
}) {
  let gitBaselineSnapshot = null;
  let pendingGitBaselineBeforeEditorMount = null;
  let gitBlameRequestCounter = 0;
  let localEditGeneration = 0;
  const pendingGitBlameRequests = new Map();
  const gitBlameCache = new Map();
  const inFlightGitBlameRequests = new Map();

  const clearBlameCache = ({ hideTooltip = true } = {}) => {
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

  const resetForInit = ({ hideTooltip = false } = {}) => {
    localEditGeneration = 0;
    clearBlameCache({ hideTooltip });
  };

  const requestBlameForLine = ({ lineNumber }) => {
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
    const message = {
      type: 'requestGitBlame',
      requestId,
      lineNumber: normalizedLine,
      localEditGeneration
    };

    if (shouldIncludeBlameSnapshotText(currentText, getSyncedText?.(), maxBlameSnapshotChars)) {
      message.text = currentText;
    }

    const requestPromise = new Promise((resolve, reject) => {
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

  const openRevisionForLine = ({ lineNumber }) => {
    const normalizedLine = normalizeLineNumber(lineNumber);
    const currentText = getCurrentEditorText?.();
    const message = {
      type: 'openGitRevisionForLine',
      lineNumber: normalizedLine
    };
    if (shouldIncludeBlameSnapshotText(currentText, getSyncedText?.(), maxBlameSnapshotChars)) {
      message.text = currentText;
    }
    vscode.postMessage(message);
  };

  const openWorktreeForLine = ({ lineNumber }) => {
    const normalizedLine = normalizeLineNumber(lineNumber);
    vscode.postMessage({
      type: 'openGitWorktreeForLine',
      lineNumber: normalizedLine
    });
  };

  const applyBaselineToEditor = (editor) => {
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

  const handleMessage = (message, { editor } = {}) => {
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
