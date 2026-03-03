import * as path from 'node:path';
import * as vscode from 'vscode';

export function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseGitUriQuery(query: string): { path?: unknown; ref?: unknown } | undefined {
  const parsed = parseLooseJson(query) ?? parseLooseJson(safeDecodeURIComponent(query));
  if (!parsed || typeof parsed !== 'object') {
    return undefined;
  }
  return parsed as { path?: unknown; ref?: unknown };
}

export function resolveWorktreeUriFromGitUri(uri: vscode.Uri): vscode.Uri | undefined {
  if (uri.scheme !== 'git') {
    return undefined;
  }

  const query = parseGitUriQuery(uri.query);
  const queryRecord = query && typeof query === 'object' ? query as Record<string, unknown> : undefined;
  const queryPath = queryRecord?.path;
  if (typeof queryPath === 'string') {
    return vscode.Uri.file(queryPath);
  }

  return uri.path ? vscode.Uri.file(uri.path) : undefined;
}

export function getPreferredCommandUri(value: unknown): vscode.Uri | undefined {
  const commandUri = coerceCommandUri(value);
  const activeContextUri = getActiveEditorContextUri();

  if (!commandUri) {
    return activeContextUri;
  }

  if (!activeContextUri) {
    return commandUri;
  }

  return shouldPreferActiveContextUri(commandUri, activeContextUri) ? activeContextUri : commandUri;
}

export function getComparableResourceKey(uri: vscode.Uri): string | undefined {
  if (uri.scheme === 'file') {
    return path.normalize(uri.fsPath);
  }

  const gitUri = resolveWorktreeUriFromGitUri(uri);
  if (gitUri) {
    return path.normalize(gitUri.fsPath);
  }

  const hintedFileUri = findFileUriHintFromQuery(uri.query);
  if (hintedFileUri) {
    return path.normalize(hintedFileUri.fsPath);
  }

  if (uri.path && path.isAbsolute(uri.path)) {
    return path.normalize(uri.path);
  }

  return undefined;
}

export function getOpenTextDocumentForUri(targetUri: vscode.Uri): vscode.TextDocument | undefined {
  const target = targetUri.toString();
  return vscode.workspace.textDocuments.find((document) => document.uri.toString() === target);
}

export function getOpenTextDocumentForComparableKey(targetKey: string): vscode.TextDocument | undefined {
  return vscode.workspace.textDocuments.find((document) => {
    if (document.uri.scheme !== 'file') {
      return false;
    }

    return getComparableResourceKey(document.uri) === targetKey;
  });
}

function getActiveEditorContextUri(): vscode.Uri | undefined {
  const activeEditorUri = vscode.window.activeTextEditor?.document.uri;
  if (activeEditorUri) {
    return activeEditorUri;
  }

  return getActiveTabResourceUri();
}

function getActiveTabResourceUri(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (!input) {
    return undefined;
  }

  if (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom) {
    return input.uri;
  }

  if (input instanceof vscode.TabInputTextDiff) {
    return input.modified;
  }

  return undefined;
}

function shouldPreferActiveContextUri(commandUri: vscode.Uri, activeContextUri: vscode.Uri): boolean {
  if (commandUri.toString() === activeContextUri.toString()) {
    return true;
  }

  const commandKey = getComparableResourceKey(commandUri);
  const activeKey = getComparableResourceKey(activeContextUri);
  return Boolean(commandKey && activeKey && commandKey === activeKey);
}

function findFileUriHintFromQuery(query: string): vscode.Uri | undefined {
  if (!query) {
    return undefined;
  }

  const parsedJson = parseLooseJson(query) ?? parseLooseJson(safeDecodeURIComponent(query));
  if (parsedJson !== undefined) {
    const fromJson = findFileUriHintFromUnknown(parsedJson);
    if (fromJson) {
      return fromJson;
    }
  }

  const params = new URLSearchParams(query);
  const keys = ['path', 'file', 'resource', 'resourceUri', 'uri', 'target', 'targetUri', 'modified', 'original'];
  for (const key of keys) {
    const value = params.get(key);
    const hinted = findFileUriHintFromUnknown(value);
    if (hinted) {
      return hinted;
    }
  }

  return undefined;
}

function findFileUriHintFromUnknown(value: unknown): vscode.Uri | undefined {
  if (typeof value === 'string') {
    if (path.isAbsolute(value)) {
      return vscode.Uri.file(value);
    }

    try {
      const parsed = vscode.Uri.parse(value, true);
      if (parsed.scheme === 'file') {
        return parsed;
      }
      if (parsed.path && path.isAbsolute(parsed.path)) {
        return vscode.Uri.file(parsed.path);
      }
    } catch {
      return undefined;
    }

    return undefined;
  }

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const directUri = uriFromUnknown(value);
  if (directUri?.scheme === 'file') {
    return directUri;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findFileUriHintFromUnknown(item);
      if (nested) {
        return nested;
      }
    }
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const keys = ['path', 'file', 'resource', 'resourceUri', 'uri', 'target', 'targetUri', 'modified', 'original'];
  for (const key of keys) {
    if (!(key in candidate)) {
      continue;
    }
    const nested = findFileUriHintFromUnknown(candidate[key]);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

function parseLooseJson(value: string): unknown {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
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
