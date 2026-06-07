import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

export type RawVscodeTheme = {
  name: string;
  type: 'light' | 'dark';
  colors: Record<string, string>;
  tokenColors: unknown[];
};

type RawTheme = {
  include?: string;
  colors?: Record<string, string | null | undefined>;
  tokenColors?: unknown[];
};

type MergedTheme = {
  colors: Record<string, string>;
  tokenColors: unknown[];
};

function parseJsonc(text: string): unknown {
  let out = '';
  let inString = false;
  let stringQuote = '';
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        out += ch;
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 1;
        continue;
      }
      if (ch === stringQuote) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    out += ch;
  }

  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

function readRawTheme(themePath: string): RawTheme | undefined {
  try {
    const parsed = parseJsonc(fs.readFileSync(themePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as RawTheme) : undefined;
  } catch {
    return undefined;
  }
}

function loadMergedTheme(themePath: string, seen = new Set<string>()): MergedTheme {
  const merged: MergedTheme = { colors: {}, tokenColors: [] };
  const normalizedPath = path.normalize(themePath);
  if (seen.has(normalizedPath)) {
    return merged;
  }
  seen.add(normalizedPath);

  const raw = readRawTheme(themePath);
  if (!raw) {
    return merged;
  }

  if (typeof raw.include === 'string' && raw.include) {
    const base = loadMergedTheme(path.join(path.dirname(themePath), raw.include), seen);
    merged.colors = { ...base.colors };
    merged.tokenColors = [...base.tokenColors];
  }

  if (raw.colors && typeof raw.colors === 'object') {
    for (const [key, value] of Object.entries(raw.colors)) {
      if (typeof value === 'string') {
        merged.colors[key] = value;
      }
    }
  }
  if (Array.isArray(raw.tokenColors)) {
    merged.tokenColors.push(...raw.tokenColors);
  }

  return merged;
}

function findThemeContribution(themeLabelOrId: string): { path: string; uiTheme: string } | undefined {
  for (const extension of vscode.extensions.all) {
    const contributedThemes = extension.packageJSON?.contributes?.themes;
    if (!Array.isArray(contributedThemes)) {
      continue;
    }
    for (const contributed of contributedThemes) {
      if (contributed?.label === themeLabelOrId || contributed?.id === themeLabelOrId) {
        const relativePath = typeof contributed.path === 'string' ? contributed.path : '';
        if (!relativePath) {
          return undefined;
        }
        return {
          path: path.join(extension.extensionPath, relativePath),
          uiTheme: typeof contributed.uiTheme === 'string' ? contributed.uiTheme : 'vs-dark'
        };
      }
    }
  }
  return undefined;
}

export function getActiveVscodeRawTheme(): RawVscodeTheme | null {
  const themeLabel = vscode.workspace.getConfiguration('workbench').get<string>('colorTheme');
  if (!themeLabel) {
    return null;
  }
  const found = findThemeContribution(themeLabel);
  if (!found) {
    return null;
  }
  const merged = loadMergedTheme(found.path);
  if (!merged.tokenColors.length && !Object.keys(merged.colors).length) {
    return null;
  }
  const type = found.uiTheme === 'vs' || found.uiTheme === 'hc-light' ? 'light' : 'dark';
  return { name: themeLabel, type, colors: merged.colors, tokenColors: merged.tokenColors };
}
