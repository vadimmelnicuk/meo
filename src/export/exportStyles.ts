import { defaultThemeColors, defaultThemeFonts, type ThemeColorKey, type ThemeColors, type ThemeSettings } from '../shared/themeDefaults';

export type ExportStyleEnvironment = {
  editorFontFamily?: string;
  editorFontSizePx?: number;
  editorBackgroundColor?: string;
  editorForegroundColor?: string;
  codeBlockBackgroundColor?: string;
  sideBarBackgroundColor?: string;
  panelBorderColor?: string;
  liveFontFamily?: string;
  sourceFontFamily?: string;
  liveLineHeight?: number;
  sourceLineHeight?: number;
  meoThemeColors?: Partial<Record<ThemeColorKey, string>>;
};

export function buildExportStyles(theme: ThemeSettings, environment: ExportStyleEnvironment = {}): string {
  const colors = resolveThemeColors(theme, environment);
  const fonts = theme.fonts ?? defaultThemeFonts;
  const editorFontFamily = sanitizeCssFont(environment.editorFontFamily ?? '');
  const editorBackgroundColor = sanitizeCssColor(environment.editorBackgroundColor ?? '') || colors.base03;
  const editorForegroundColor = sanitizeCssColor(environment.editorForegroundColor ?? '') || colors.base02;
  const codeBlockBackgroundColor = sanitizeCssColor(environment.codeBlockBackgroundColor ?? '') || editorBackgroundColor;
  const sideBarBackgroundColor = sanitizeCssColor(environment.sideBarBackgroundColor ?? '') || editorBackgroundColor;
  const panelBorderColor = sanitizeCssColor(environment.panelBorderColor ?? '') || colors.base03;
  const liveFont = sanitizeCssFont(environment.liveFontFamily ?? '') || sanitizeCssFont(fonts.live) || editorFontFamily || 'var(--meo-font-system-sans)';
  const sourceFont = sanitizeCssFont(environment.sourceFontFamily ?? '') || sanitizeCssFont(fonts.source) || editorFontFamily || 'var(--meo-font-system-mono)';
  const fontSizePx = clampFontSize(environment.editorFontSizePx);
  const lineHeight = clampLineHeight(environment.liveLineHeight ?? fonts.liveLineHeight ?? defaultThemeFonts.liveLineHeight);
  const sourceLineHeight = clampLineHeight(environment.sourceLineHeight ?? fonts.sourceLineHeight ?? defaultThemeFonts.sourceLineHeight);

  return `
:root {
  color-scheme: light dark;
  --meo-font-system-sans: ui-sans-serif, system-ui, sans-serif;
  --meo-font-system-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --meo-bg: ${editorBackgroundColor};
  --meo-fg: ${editorForegroundColor};
  --meo-muted: ${colors.base02};
  --meo-border: ${colors.base03};
  --meo-heading: ${colors.base04};
  --meo-link: ${colors.base05};
  --meo-accent-2: ${colors.base06};
  --meo-strong: ${colors.base07};
  --meo-number: ${colors.base08};
  --meo-quote: ${colors.base07};
  --meo-font-body: ${liveFont};
  --meo-font-code: ${sourceFont};
  --meo-font-size: ${fontSizePx}px;
  --meo-line-height: ${lineHeight};
  --meo-code-line-height: ${sourceLineHeight};
  --meo-code-bg: ${codeBlockBackgroundColor};
  --meo-sidebar-bg: ${sideBarBackgroundColor};
  --meo-page-bg: color-mix(in srgb, var(--meo-bg) 86%, var(--meo-border) 14%);
  --meo-panel-bg: color-mix(in srgb, var(--meo-bg) 96%, var(--meo-fg) 4%);
  --meo-panel-border: ${panelBorderColor};
  --meo-doc-border: color-mix(in srgb, var(--meo-panel-border) 55%, transparent);
  --meo-code-border: color-mix(in srgb, var(--meo-panel-border) 45%, transparent);
  --meo-hr: color-mix(in srgb, var(--meo-border) 70%, transparent);
  --meo-table-border: var(--meo-panel-border);
  --meo-table-header-bg: var(--meo-sidebar-bg);
  --meo-mermaid-error-border: color-mix(in srgb, var(--meo-heading) 70%, var(--meo-border) 30%);
  --meo-mermaid-error-fg: color-mix(in srgb, var(--meo-heading) 75%, var(--meo-fg) 25%);
}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--meo-bg);
  color: var(--meo-fg);
  font-family: var(--meo-font-body);
  font-size: var(--meo-font-size);
  line-height: var(--meo-line-height);
}

.meo-export-page {
  width: 100%;
  min-height: 100vh;
  padding: 0;
  background: var(--meo-bg);
}

html[data-meo-export-target='pdf'] .meo-export-page,
body[data-meo-export-target='pdf'] .meo-export-page {
  background: var(--meo-bg);
  padding: 0;
}

html[data-meo-export-target='pdf'],
body[data-meo-export-target='pdf'] {
  background: var(--meo-bg);
  overflow-x: hidden;
  width: 100%;
}

html[data-meo-export-target='pdf'] body,
body[data-meo-export-target='pdf'] {
  position: relative;
}

html[data-meo-export-target='pdf'] body::after,
body[data-meo-export-target='pdf']::after {
  content: '';
  position: fixed;
  top: 0;
  right: -8px;
  bottom: 0;
  width: 16px;
  background: var(--meo-bg);
  pointer-events: none;
}

html[data-meo-export-target='pdf'] .meo-export-doc,
body[data-meo-export-target='pdf'] .meo-export-doc {
  width: calc(100% + 8px);
  margin: 0;
  margin-right: -8px;
  border: 0;
  border-radius: 0;
  padding: calc(0.5in + 24px);
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}

html[data-meo-export-target='pdf'] .meo-export-page,
body[data-meo-export-target='pdf'] .meo-export-page {
  width: calc(100% + 8px);
  margin-right: -8px;
}

html[data-meo-export-target='pdf'] hr,
body[data-meo-export-target='pdf'] hr {
  height: 0;
  margin: 0;
  border: 0;
  background: transparent;
  break-before: page;
  page-break-before: always;
}

.meo-export-doc {
  width: 100%;
  margin: 0;
  padding: 28px 32px;
  border: 0;
  border-radius: 0;
  background: var(--meo-bg);
}

.meo-export-doc > :first-child { margin-top: 0; }
.meo-export-doc > :last-child { margin-bottom: 0; }

h1, h2, h3, h4, h5, h6 {
  color: var(--meo-heading);
  line-height: 1.25;
  margin-top: 1.2em;
  margin-bottom: 0.55em;
}
h1 { font-size: 2rem; }
h2 { font-size: 1.7rem; }
h3 { font-size: 1.35rem; }
h4 { font-size: 1.15rem; }
h5 { font-size: 1rem; }
h6 { font-size: 0.95rem; opacity: 0.9; }

p, ul, ol, blockquote, pre, table, hr {
  margin: 0 0 1em;
}
ul { padding-left: 1.5em; }
ol { padding-left: 1.8em; }
li + li { margin-top: 0.2em; }
li > ul,
li > ol {
  margin-top: 0.35em;
}
ul ul,
ul ol,
ol ul,
ol ol {
  margin-bottom: 0.35em;
}

.meo-export-task-item {
  list-style: none;
  margin-left: -0.1em;
}

.meo-export-task-checkbox {
  display: inline-block;
  box-sizing: border-box;
  width: 17px;
  height: 17px;
  margin-right: 0.55em;
  vertical-align: middle;
  border: 1px solid var(--meo-border);
  border-radius: 4px;
  background: var(--meo-sidebar-bg);
  position: relative;
  top: -1px;
}

.meo-export-task-checkbox.is-checked::after {
  content: '';
  position: absolute;
  left: 4px;
  top: 2px;
  width: 4px;
  height: 7px;
  border: solid var(--meo-fg);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

.meo-export-task-text.is-checked {
  color: var(--meo-muted);
}

a {
  color: var(--meo-link);
  text-decoration: underline;
  text-underline-offset: 3px;
}

strong { color: var(--meo-strong); }
em { font-style: italic; }
code {
  font-family: var(--meo-font-code);
  font-size: 0.92em;
  line-height: var(--meo-code-line-height);
}

p code,
li code,
blockquote code,
td code,
th code {
  padding: 0.08em 0.6em;
  border-radius: 0.35em;
  background: var(--meo-code-bg);
  color: var(--meo-strong);
}

pre.meo-export-code-block {
  padding: 24px 16px;
  overflow: auto;
  border-radius: 0;
  border: 1px solid var(--meo-code-border);
  background: var(--meo-code-bg);
}
.meo-export-code-block-wrap {
  position: relative;
  margin: 0 0 1em;
}
.meo-export-code-block-wrap > pre.meo-export-code-block {
  margin: 0;
}
.meo-export-code-language-label {
  position: absolute;
  top: 6px;
  left: 16px;
  z-index: 1;
  color: var(--meo-muted);
  font-family: var(--meo-font-code);
  font-size: 11px;
  line-height: 1;
  pointer-events: none;
  text-transform: lowercase;
}
.meo-export-code-block-wrap .meo-export-code-language-label + pre.meo-export-code-block {
  padding-top: 34px;
}
pre.meo-export-code-block code {
  display: block;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  padding: 0;
  border-radius: 0;
  background: transparent;
}

blockquote {
  margin-left: 0;
  padding: 0 0 0 3ch;
  border-left: 3px solid var(--meo-quote);
  background: transparent;
  border-radius: 0;
  color: var(--meo-quote);
}

blockquote > :last-child {
  margin-bottom: 0;
}

hr {
  border: 0;
  height: 1px;
  background: var(--meo-hr);
}

img {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
}

table {
  width: 100%;
  border-collapse: collapse;
  table-layout: auto;
  background: transparent;
}
th, td {
  border: 1px solid var(--meo-table-border);
  padding: 0.45em 0.6em;
  vertical-align: top;
  text-align: left;
  min-height: 1lh;
}
th {
  background: var(--meo-table-header-bg);
  color: var(--meo-fg);
}

td:empty::before,
th:empty::before {
  content: '\00a0';
  visibility: hidden;
}

.meo-export-mermaid {
  margin: 0 0 1em;
  border-radius: 0;
  border: 1px solid var(--meo-code-border);
  background: var(--meo-code-bg);
  overflow: hidden;
}
.meo-export-mermaid .meo-export-mermaid-svg {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 24px 16px;
  overflow: auto;
}
.meo-export-mermaid .meo-export-mermaid-svg svg {
  max-width: 100%;
  height: auto;
  display: block;
}
.meo-export-mermaid > pre.meo-export-code-block {
  margin: 0;
  border: 0;
  border-radius: 0;
}
.meo-export-mermaid.is-math {
  background: var(--meo-code-bg);
}
.meo-export-mermaid.is-math .meo-export-mermaid-svg {
  padding: 24px 16px;
}
.meo-export-mermaid .katex-display {
  margin: 0 !important;
}
.meo-export-mermaid .nodeLabel > div {
  line-height: 1 !important;
}
.meo-export-mermaid .katex-html {
  display: none;
}
.meo-export-mermaid.is-error {
  border-color: var(--meo-mermaid-error-border);
}
.meo-export-mermaid.is-error::before {
  content: 'Mermaid render failed';
  display: block;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--meo-mermaid-error-fg);
}
.meo-export-mermaid.is-rendered pre { display: none; }

/* highlight.js token colors */
.hljs { color: var(--meo-fg); background: transparent; }
.hljs-comment, .hljs-quote { color: var(--meo-muted); font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-title.function_ { color: var(--meo-heading); }
.hljs-string, .hljs-regexp { color: var(--meo-strong); }
.hljs-number, .hljs-literal, .hljs-symbol { color: var(--meo-number); }
.hljs-type, .hljs-class, .hljs-built_in, .hljs-function { color: var(--meo-accent-2); }
.hljs-attr, .hljs-attribute, .hljs-property { color: var(--meo-quote); }
.hljs-link { color: var(--meo-link); text-decoration: underline; }

@media (max-width: 700px) {
  .meo-export-page { padding: 12px; }
  .meo-export-doc { padding: 16px; }
}

@page {
  size: A4;
  margin: 0;
}

@media print {
  * {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .meo-export-page {
    min-height: auto;
  }
  pre, blockquote, table, img, .meo-export-mermaid {
    break-inside: avoid;
    page-break-inside: avoid;
  }
}
`.trim();
}

function resolveThemeColors(theme: ThemeSettings, environment: ExportStyleEnvironment): ThemeColors {
  const themeColors = theme.colors ?? defaultThemeColors;
  const envColors = environment.meoThemeColors ?? {};
  const resolved = {} as ThemeColors;

  for (const key of Object.keys(defaultThemeColors) as ThemeColorKey[]) {
    resolved[key] =
      sanitizeCssColor(envColors[key] ?? '') ||
      sanitizeCssColor(themeColors[key] ?? '') ||
      defaultThemeColors[key];
  }

  return resolved;
}

function sanitizeCssFont(value: string): string {
  const trimmed = `${value ?? ''}`.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.replace(/[\n\r;{}]/g, ' ');
}

function sanitizeCssColor(value: string): string {
  const trimmed = `${value ?? ''}`.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.replace(/[\n\r;{}]/g, ' ');
}

function clampLineHeight(value: number): number {
  if (!Number.isFinite(value)) {
    return defaultThemeFonts.liveLineHeight;
  }
  return Math.min(3, Math.max(1, value));
}

function clampFontSize(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 14;
  }
  return Math.min(32, Math.max(8, value as number));
}
