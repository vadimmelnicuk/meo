import * as path from 'node:path';
import * as vscode from 'vscode';
import { safeDecodeURIComponent } from '../agents/resourceMatching';
import { withMarkdownExtensions } from './extensionConfig';

const WIKI_LINK_SCHEME = 'meo-wiki:';
const ALLOWED_IMAGE_SRC_RE = /^(?:https?:|data:|blob:|vscode-webview-resource:|vscode-resource:)/i;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

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
  return findFirstExistingFileUri(candidates);
}

export async function resolveLocalLinkTargetUri(rawHref: string, documentUri: vscode.Uri): Promise<vscode.Uri | null> {
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
  const candidates = ext ? [basePath] : withMarkdownExtensions(basePath, true);
  return findFirstExistingFileUri(candidates);
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

async function findFirstExistingFileUri(candidatePaths: readonly string[]): Promise<vscode.Uri | null> {
  for (const candidate of candidatePaths) {
    const uri = vscode.Uri.file(candidate);
    if (await uriExists(uri)) {
      return uri;
    }
  }

  return null;
}
