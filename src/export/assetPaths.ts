import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const REMOTE_OR_INLINE_RE = /^(?:https?:|data:|blob:)/i;

type ExportImageTarget = 'html' | 'pdf';
export type ExportHtmlImageMode = 'embedded' | 'linked';

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.webp': 'image/webp'
};

export type RewriteExportImageSrcOptions = {
  markdownFilePath: string;
  target: ExportImageTarget;
  outputFilePath?: string;
  htmlImageMode: ExportHtmlImageMode;
  embeddedImageDataUrlCache?: Map<string, string | null>;
};

export function rewriteExportImageSrc(rawSrc: string, options: RewriteExportImageSrcOptions): string {
  const input = (rawSrc ?? '').trim();
  if (!input) {
    return '';
  }

  if (REMOTE_OR_INLINE_RE.test(input)) {
    return input;
  }

  const { pathPart, suffix, hash } = splitPathAndSuffix(input);
  if (!pathPart) {
    return input;
  }

  if (SCHEME_RE.test(pathPart) && !/^file:/i.test(pathPart)) {
    return input;
  }

  const filePath = resolveLocalLikePath(pathPart, options.markdownFilePath);
  if (!filePath) {
    return input;
  }

  if (options.target === 'pdf') {
    return `${toFileUrlString(filePath)}${suffix}`;
  }

  if (options.htmlImageMode === 'embedded') {
    const embedded = toEmbeddedImageDataUrl(filePath, options.embeddedImageDataUrlCache);
    if (embedded) {
      // Preserve hash fragments (e.g. SVG fragment refs), but skip query args for data URLs.
      return `${embedded}${hash}`;
    }
  }

  const outputDir = options.outputFilePath ? path.dirname(options.outputFilePath) : path.dirname(options.markdownFilePath);
  const relative = path.relative(outputDir, filePath);
  if (!relative || path.isAbsolute(relative) || hasWindowsDrivePrefix(relative)) {
    return `${toFileUrlString(filePath)}${suffix}`;
  }

  return `${toPosixPath(relative)}${suffix}`;
}

export function toFileUrlString(filePath: string): string {
  return pathToFileURL(filePath).toString();
}

function resolveLocalLikePath(rawPath: string, markdownFilePath: string): string | null {
  if (/^file:/i.test(rawPath)) {
    try {
      return fileURLToPath(rawPath);
    } catch {
      return null;
    }
  }

  const decoded = safeDecodeURIComponent(rawPath).replace(/\\/g, path.sep);
  if (!decoded) {
    return null;
  }

  if (path.isAbsolute(decoded)) {
    return decoded;
  }

  return path.resolve(path.dirname(markdownFilePath), decoded);
}

function splitPathAndSuffix(value: string): { pathPart: string; suffix: string; hash: string } {
  const queryIndex = value.indexOf('?');
  const hashIndex = value.indexOf('#');
  const hasQuery = queryIndex >= 0;
  const hasHash = hashIndex >= 0;
  const index = hasQuery && hasHash
    ? Math.min(queryIndex, hashIndex)
    : (hasQuery ? queryIndex : hashIndex);
  if (index < 0) {
    return { pathPart: value, suffix: '', hash: '' };
  }
  const hash = hasHash ? value.slice(hashIndex) : '';
  return {
    pathPart: value.slice(0, index),
    suffix: value.slice(index),
    hash
  };
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

function hasWindowsDrivePrefix(value: string): boolean {
  return /^[a-z]:/i.test(value);
}

function toEmbeddedImageDataUrl(filePath: string, cache?: Map<string, string | null>): string | null {
  const cached = cache?.get(filePath);
  if (cached !== undefined) {
    return cached;
  }

  let embedded: string | null = null;
  try {
    const content = fs.readFileSync(filePath);
    const mimeType = IMAGE_MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    embedded = `data:${mimeType};base64,${content.toString('base64')}`;
  } catch {
    embedded = null;
  }

  cache?.set(filePath, embedded);
  return embedded;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
