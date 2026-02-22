import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const REMOTE_OR_INLINE_RE = /^(?:https?:|data:|blob:)/i;

type ExportImageTarget = 'html' | 'pdf';

export type RewriteExportImageSrcOptions = {
  markdownFilePath: string;
  target: ExportImageTarget;
  outputFilePath?: string;
};

export function rewriteExportImageSrc(rawSrc: string, options: RewriteExportImageSrcOptions): string {
  const input = (rawSrc ?? '').trim();
  if (!input) {
    return '';
  }

  if (REMOTE_OR_INLINE_RE.test(input)) {
    return input;
  }

  const { pathPart, suffix } = splitPathAndSuffix(input);
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

function splitPathAndSuffix(value: string): { pathPart: string; suffix: string } {
  const match = /[?#]/.exec(value);
  if (!match || typeof match.index !== 'number') {
    return { pathPart: value, suffix: '' };
  }
  const index = match.index;
  return {
    pathPart: value.slice(0, index),
    suffix: value.slice(index)
  };
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

function hasWindowsDrivePrefix(value: string): boolean {
  return /^[a-z]:/i.test(value);
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
