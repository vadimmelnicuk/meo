import * as vscode from 'vscode';

// VS Code's global Search view passes the clicked match's range only to text editors.
// Custom editors (like MEO) receive nothing (microsoft/vscode#211351), so we recover the
// clicked match from the Search view itself:
//   - `search.action.getSearchResults` returns every result as text (no clipboard use).
//   - `search.action.copyMatch` copies the selected (clicked) result as `line,col: preview`.
// Neither exposes the match length, so it is inferred from the text shared by all matches.

export type SearchResultMatch = {
  line: number; // 1-based
  column: number; // 1-based, UTF-16 code units
  preview: string; // full text of the match's first line
};

export type SearchResultFile = {
  label: string;
  matches: SearchResultMatch[];
};

export type SearchRevealRange = {
  anchor: number;
  head: number;
  key: string;
};

const MATCH_LINE_REGEX = /^\s*(\d+),(\d+): (.*)$/;
const CONTINUATION_LINE_REGEX = /^\s*\d+: /;

export function parseSearchResults(text: string): SearchResultFile[] {
  const files: SearchResultFile[] = [];
  let current: SearchResultFile | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim()) {
      current = null;
      continue;
    }
    const match = MATCH_LINE_REGEX.exec(rawLine);
    if (match && /^\s/.test(rawLine)) {
      if (current) {
        current.matches.push({
          line: Number.parseInt(match[1], 10),
          column: Number.parseInt(match[2], 10),
          preview: match[3]
        });
      }
      continue;
    }
    if (CONTINUATION_LINE_REGEX.test(rawLine)) {
      continue;
    }
    if (!current) {
      current = { label: rawLine.trim(), matches: [] };
      files.push(current);
    }
  }
  return files;
}

export function parseSelectedMatch(text: string): { line: number; column: number } | null {
  for (const rawLine of text.split(/\r?\n/)) {
    const match = MATCH_LINE_REGEX.exec(rawLine);
    if (match) {
      return { line: Number.parseInt(match[1], 10), column: Number.parseInt(match[2], 10) };
    }
  }
  return null;
}

const normalizeLabel = (value: string): string => value.replace(/\\/g, '/').replace(/^\.\//, '');

export function findFileResults(
  files: SearchResultFile[],
  candidateLabels: string[]
): SearchResultFile | null {
  const candidates = new Set(candidateLabels.filter(Boolean).map(normalizeLabel));
  return files.find((file) => candidates.has(normalizeLabel(file.label))) ?? null;
}

function lineStartOffsets(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      starts.push(index + 1);
    }
  }
  return starts;
}

function textFromMatchToLineEnd(lines: string[], line: number, column: number): string | null {
  const lineText = lines[line - 1];
  if (lineText === undefined || column - 1 > lineText.length) {
    return null;
  }
  return lineText.slice(column - 1);
}

function commonPrefixLength(values: string[]): number {
  if (!values.length) {
    return 0;
  }
  const lowered = values.map((value) => value.toLocaleLowerCase());
  let length = lowered[0].length;
  for (let index = 1; index < lowered.length; index += 1) {
    const value = lowered[index];
    let shared = 0;
    while (shared < length && shared < value.length && value[shared] === lowered[0][shared]) {
      shared += 1;
    }
    length = shared;
  }
  return length;
}

function wordLengthAt(text: string): number {
  const match = /^[\p{L}\p{N}_]+/u.exec(text);
  return match ? match[0].length : Math.min(1, text.length);
}

/**
 * Resolves the clicked search result to an LF-normalized offset range inside `docText`.
 * `selected` is the clicked match; `fileResults` are this document's results; `allFiles`
 * are all results (used to infer the match length).
 */
export function resolveSearchRevealRange(
  docText: string,
  selected: { line: number; column: number },
  fileResults: SearchResultFile,
  allFiles: SearchResultFile[]
): SearchRevealRange | null {
  const isInThisFile = fileResults.matches.some(
    (match) => match.line === selected.line && match.column === selected.column
  );
  if (!isInThisFile) {
    return null;
  }

  const normalized = docText.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const selectedText = textFromMatchToLineEnd(lines, selected.line, selected.column);
  if (selectedText === null) {
    return null;
  }

  // Text from every match start to the end of its line. All matches of a plain-text
  // query start with the query, so their shared prefix is (at least) the query.
  const samples: string[] = [selectedText];
  for (const file of allFiles) {
    const isThisFile = file === fileResults;
    for (const match of file.matches) {
      if (isThisFile && match.line === selected.line && match.column === selected.column) {
        continue;
      }
      const sample = isThisFile
        ? textFromMatchToLineEnd(lines, match.line, match.column)
        : match.preview.slice(match.column - 1);
      if (sample !== null) {
        samples.push(sample);
      }
    }
  }

  let length = samples.length > 1 ? commonPrefixLength(samples) : wordLengthAt(selectedText);
  if (length <= 0) {
    length = wordLengthAt(selectedText);
  }

  const anchor = lineStartOffsets(normalized)[selected.line - 1] + selected.column - 1;
  return {
    anchor,
    head: anchor + length,
    key: `${selected.line},${selected.column}`
  };
}

async function readSearchResultsText(): Promise<string | null> {
  try {
    const result = await vscode.commands.executeCommand<unknown>('search.action.getSearchResults');
    return typeof result === 'string' && result.trim() ? result : null;
  } catch {
    return null;
  }
}

async function readSelectedSearchMatchText(): Promise<string | null> {
  // `copyMatch` only writes to the clipboard, so preserve and restore its text content.
  let previousClipboard: string | null = null;
  try {
    previousClipboard = await vscode.env.clipboard.readText();
  } catch {
    previousClipboard = null;
  }
  try {
    await vscode.commands.executeCommand('search.action.copyMatch');
    const copied = await vscode.env.clipboard.readText();
    return copied === previousClipboard ? null : copied;
  } catch {
    return null;
  } finally {
    if (previousClipboard !== null) {
      try {
        await vscode.env.clipboard.writeText(previousClipboard);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Returns the range of the Search view result the user opened for `uri`, or null when the
 * Search view is not showing results for this document.
 */
export async function resolveSearchViewRevealForDocument(
  uri: vscode.Uri,
  getDocumentText: () => string
): Promise<SearchRevealRange | null> {
  const resultsText = await readSearchResultsText();
  if (!resultsText) {
    return null;
  }

  const files = parseSearchResults(resultsText);
  const fileResults = findFileResults(files, [
    vscode.workspace.asRelativePath(uri, true),
    vscode.workspace.asRelativePath(uri, false),
    uri.fsPath
  ]);
  if (!fileResults || !fileResults.matches.length) {
    return null;
  }

  let selected: { line: number; column: number } | null = null;
  if (fileResults.matches.length === 1) {
    selected = fileResults.matches[0];
  } else {
    const selectedText = await readSelectedSearchMatchText();
    selected = selectedText ? parseSelectedMatch(selectedText) : null;
  }
  if (!selected) {
    return null;
  }

  return resolveSearchRevealRange(getDocumentText(), selected, fileResults, files);
}
