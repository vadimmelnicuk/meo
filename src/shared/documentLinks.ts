import * as path from 'node:path';
import * as vscode from 'vscode';
import { safeDecodeURIComponent } from '../agents/resourceMatching';
import { withMarkdownExtensions } from './extensionConfig';

const WIKI_LINK_SCHEME = 'meo-wiki:';
const ALLOWED_IMAGE_SRC_RE = /^(?:https?:|data:|blob:|vscode-webview-resource:|vscode-resource:)/i;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const HOSTNAME_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;

export async function openExternalLink(rawHref: string): Promise<void> {
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

export async function openLink(rawHref: string, documentUri: vscode.Uri): Promise<void> {
  if (await openWikiLink(rawHref, documentUri)) {
    return;
  }
  if (await openLocalLink(rawHref, documentUri)) {
    return;
  }
  if (looksLikeLocalHref(rawHref)) {
    console.warn('[meo] Local link target not found', {
      href: rawHref,
      documentUri: documentUri.toString(),
      documentScheme: documentUri.scheme,
      documentFsPath: documentUri.fsPath
    });
    return;
  }
  await openExternalLink(rawHref);
}

export async function openLocalLink(rawHref: string, documentUri: vscode.Uri): Promise<boolean> {
  const targetUri = await resolveLocalLinkTargetUri(rawHref, documentUri);
  if (!targetUri) {
    return false;
  }

  await vscode.commands.executeCommand('vscode.open', targetUri, {
    preview: false
  });
  return true;
}

export async function openWikiLink(rawHref: string, documentUri: vscode.Uri): Promise<boolean> {
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

export async function resolveWikiLinkTargets(
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

export async function resolveLocalLinkTargets(
  targets: string[],
  documentUri: vscode.Uri
): Promise<Array<{ target: string; exists: boolean }>> {
  const uniqueTargets = Array.from(new Set(targets
    .map((target) => `${target ?? ''}`.trim())
    .filter((target) => target.length > 0)));

  const resolved = await Promise.all(uniqueTargets.map(async (target) => {
    const targetUri = await resolveLocalLinkTargetUri(target, documentUri);
    return { target, exists: Boolean(targetUri) };
  }));

  return resolved;
}

export function normalizeWikiTarget(target: string): string {
  const normalized = target.split('#', 1)[0]?.trim() ?? '';
  if (!normalized || SCHEME_RE.test(normalized)) {
    return '';
  }
  return normalized;
}

export async function resolveWikiLinkTargetUri(target: string, documentUri: vscode.Uri): Promise<vscode.Uri | null> {
  const normalized = target.replace(/\\/g, path.sep);
  const basePath = path.isAbsolute(normalized)
    ? normalized
    : path.resolve(path.dirname(documentUri.fsPath), normalized);
  const ext = path.extname(normalized);
  const candidates = ext ? [basePath] : withMarkdownExtensions(basePath);
  const resolvedFromDocumentDir = await findFirstExistingUri(candidates.map((candidate) => toDocumentScopedUri(candidate, documentUri)));
  if (resolvedFromDocumentDir) {
    return resolvedFromDocumentDir;
  }

  if (path.isAbsolute(normalized)) {
    return null;
  }

  const workspaceRoot = vscode.workspace.getWorkspaceFolder(documentUri)?.uri ?? vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!workspaceRoot?.fsPath) {
    return null;
  }

  const workspaceBasePath = path.resolve(workspaceRoot.fsPath, normalized);
  const workspaceCandidates = ext ? [workspaceBasePath] : withMarkdownExtensions(workspaceBasePath);
  return findFirstExistingUri(workspaceCandidates.map((candidate) => toDocumentScopedUri(candidate, workspaceRoot)));
}

export async function resolveLocalLinkTargetUri(rawHref: string, documentUri: vscode.Uri): Promise<vscode.Uri | null> {
  const trimmed = rawHref.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }
  if (/^\/\//.test(trimmed)) {
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
  const candidates = ext ? [basePath] : withMarkdownExtensions(basePath, true);
  const resolvedFromDocumentDir = await findFirstExistingUri(candidates.map((candidate) => toDocumentScopedUri(candidate, documentUri)));
  if (resolvedFromDocumentDir) {
    return resolvedFromDocumentDir;
  }

  if (path.isAbsolute(decodedPath)) {
    return null;
  }

  const workspaceRoot = vscode.workspace.getWorkspaceFolder(documentUri)?.uri ?? vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!workspaceRoot?.fsPath) {
    return null;
  }

  const workspaceBasePath = path.resolve(workspaceRoot.fsPath, decodedPath);
  const workspaceCandidates = ext ? [workspaceBasePath] : withMarkdownExtensions(workspaceBasePath, true);
  return findFirstExistingUri(workspaceCandidates.map((candidate) => toDocumentScopedUri(candidate, workspaceRoot)));
}

export async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

export function resolveWebviewImageSrc(rawUrl: string, documentUri: vscode.Uri, webview: vscode.Webview): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return '';
  }
  if (/^\/\//.test(trimmed)) {
    return `https:${trimmed}`;
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

export function normalizeExternalHref(rawHref: string): string {
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

function toDocumentScopedUri(candidatePath: string, baseUri: vscode.Uri): vscode.Uri {
  if (baseUri.scheme === 'file') {
    return vscode.Uri.file(candidatePath);
  }
  return baseUri.with({
    path: candidatePath,
    query: '',
    fragment: ''
  });
}

function looksLikeLocalHref(rawHref: string): boolean {
  const trimmed = rawHref.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return false;
  }
  if (/^\/\//.test(trimmed)) {
    return false;
  }
  if (/^file:/i.test(trimmed)) {
    return true;
  }
  const [targetPath = ''] = trimmed.split(/[?#]/, 1);
  if (!targetPath) {
    return false;
  }
  if (SCHEME_RE.test(targetPath)) {
    return false;
  }

  const normalized = safeDecodeURIComponent(targetPath).trim().replace(/\\/g, '/');
  if (!normalized) {
    return false;
  }
  if (
    normalized.startsWith('./') ||
    normalized.startsWith('../') ||
    normalized.startsWith('/') ||
    normalized.startsWith('~')
  ) {
    return true;
  }
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return true;
  }
  if (normalized.toLowerCase().startsWith('www.')) {
    return false;
  }

  const firstSegment = normalized.split('/', 1)[0] ?? '';
  const hostPart = firstSegment.includes(':') ? firstSegment.split(':', 1)[0] : firstSegment;
  if (hostPart === 'localhost') {
    return false;
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostPart)) {
    return false;
  }
  if (HOSTNAME_RE.test(hostPart)) {
    return false;
  }

  return true;
}

async function findFirstExistingUri(candidateUris: readonly vscode.Uri[]): Promise<vscode.Uri | null> {
  for (const uri of candidateUris) {
    if (await uriExists(uri)) {
      return uri;
    }
  }

  return null;
}
