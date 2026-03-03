import * as path from 'node:path';
import { createHash } from 'node:crypto';
import * as vscode from 'vscode';
import { getGitBlameForLine } from './blame';
import { runGit } from './cli';
import { GitDocumentState } from './documentState';
import type { GitBaselinePayload, GitBlameLineResult } from './types';
import { buildCurrentToBaselineLineMap as buildCurrentToBaselineLineMapShared } from '../shared/gitDiffCore';
import { resolveWorktreeUriFromGitUri } from '../agents/resourceMatching';

type RequestWithLineNumber = {
  lineNumber: number;
  text?: string;
};

type ResolvedGitBlameRequest = {
  baseline: GitBaselinePayload | null;
  result: GitBlameLineResult;
};

// The shared mapper now scales via anchors/heuristics and only uses exact LCS on
// bounded chunks, so these are chunk limits rather than global failure caps.
const MAX_BLAME_LINE_MAP_EXACT_CHUNK_LINES = 6000;
const MAX_BLAME_LINE_MAP_EXACT_CHUNK_CELLS = 4_000_000;
const MAX_BLAME_SNAPSHOT_TEXT_CHARS = 500 * 1024;
const blameLineMapCache = new Map<string, Int32Array | null>();

export function normalizeTrailingEofVisualLineForGitBlame(
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

export function isTrailingEofVisualLineRequest(
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

export async function resolveGitBlameForRequest(
  documentUri: vscode.Uri,
  request: RequestWithLineNumber,
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
    if (!baseline.available || !baseline.repoRoot || !baseline.gitPath || !baseline.tracked) {
      return {
        baseline,
        result: snapshotBlame
      };
    }
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

export async function openGitRevisionForLine(
  documentUri: vscode.Uri,
  request: RequestWithLineNumber,
  currentDocumentText?: string,
  gitDocumentState?: GitDocumentState
): Promise<void> {
  const { baseline, result } = await resolveGitBlameForRequest(documentUri, request, currentDocumentText, gitDocumentState);

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

export async function showWorktreeDocumentAtLine(worktreeUri: vscode.Uri, lineNumber: number): Promise<void> {
  const line = Math.max(0, Math.floor(lineNumber) - 1);
  const worktreeDoc = await vscode.workspace.openTextDocument(worktreeUri);
  await vscode.window.showTextDocument(worktreeDoc, {
    preview: false,
    selection: new vscode.Range(line, 0, line, 0)
  });
}

export async function resolveHeadCommitBlameForWorktreeOpen(
  documentUri: vscode.Uri,
  request: RequestWithLineNumber,
  currentDocumentText: string | undefined,
  state: GitDocumentState,
  baseline: GitBaselinePayload
): Promise<Extract<GitBlameLineResult, { kind: 'commit' }> | null> {
  const { result } = await resolveGitBlameForRequest(
    documentUri,
    request,
    currentDocumentText,
    state
  );

  if (result.kind === 'commit') {
    return result;
  }

  const mappingText = typeof request.text === 'string' ? request.text : currentDocumentText;
  let resolvedBaseline = baseline;
  if (typeof mappingText === 'string' && typeof resolvedBaseline.baseText !== 'string') {
    resolvedBaseline = await state.resolveBaseline({ includeText: true });
    if (
      !resolvedBaseline.available ||
      !resolvedBaseline.repoRoot ||
      !resolvedBaseline.gitPath ||
      !resolvedBaseline.tracked
    ) {
      return null;
    }
  }

  const normalizedRequestedLineNumber = Math.max(1, Math.floor(request.lineNumber));
  const lineNumberForOpenFallback = normalizeTrailingEofVisualLineForGitBlame(
    request.lineNumber,
    mappingText
  );
  const lineNumberForHistoricalMapping = isTrailingEofVisualLineRequest(request.lineNumber, mappingText)
    ? normalizedRequestedLineNumber
    : lineNumberForOpenFallback;
  const historicalLineNumber = (
    typeof mappingText === 'string'
      ? getMappedBaselineLineForRequest(resolvedBaseline, mappingText, lineNumberForHistoricalMapping)
      : null
  );

  return historicalLineNumber
    ? getHeadBlameForLineFallback(resolvedBaseline, historicalLineNumber)
    : getHeadBlameForLineFallback(resolvedBaseline, lineNumberForOpenFallback);
}

export async function openGitWorktreeForLine(
  documentUri: vscode.Uri,
  request: RequestWithLineNumber,
  currentDocumentText?: string,
  gitDocumentState?: GitDocumentState
): Promise<void> {
  const worktreeUri = documentUri.scheme === 'file' ? documentUri : resolveWorktreeUriFromGitUri(documentUri);
  if (!worktreeUri || worktreeUri.scheme !== 'file') {
    return;
  }

  const state = gitDocumentState ?? new GitDocumentState(worktreeUri.fsPath);
  const baseline = await state.resolveBaseline({ includeText: false });
  if (!baseline.available || !baseline.repoRoot || !baseline.gitPath || !baseline.tracked) {
    await showWorktreeDocumentAtLine(worktreeUri, request.lineNumber);
    return;
  }

  const commitBlame = await resolveHeadCommitBlameForWorktreeOpen(
    documentUri,
    request,
    currentDocumentText,
    state,
    baseline
  );
  if (!commitBlame) {
    await showWorktreeDocumentAtLine(worktreeUri, request.lineNumber);
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

async function getHeadBlameForLineFallback(
  baseline: GitBaselinePayload | null | undefined,
  lineNumber: number
): Promise<Extract<GitBlameLineResult, { kind: 'commit' }> | null> {
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
