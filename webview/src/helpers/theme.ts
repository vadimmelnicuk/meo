import {
  resolveTheme,
  SYNTAX_TAG_SPECS,
  type ThemeSettings,
  themeColorKeys
} from '../../../src/shared/themeDefaults';

const vscodeEditorFontFamily = 'var(--vscode-editor-font-family)';
const vscodeEditorFontSize = 'var(--vscode-editor-font-size, 13px)';
const styleValueInjectionPattern = /[\n\r;{}]/g;

const resolveEditorFontWeight = (): string => {
  const rawEditorFontWeight = getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-font-weight').trim();
  return rawEditorFontWeight || 'normal';
};

const sanitizeThemeFontStyle = (value: string): string => `${value ?? ''}`.trim().replace(styleValueInjectionPattern, ' ');

const normalizeThemeLineHeight = (value: number | undefined, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(3, Math.max(1, value));
};

const normalizeThemeFontSize = (value: number | null | undefined): string => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return '';
  }
  return `${value}px`;
};

const normalizeThemeHeadingSize = (value: number | undefined, fallback: string, unit: 'px' | 'em' = 'px'): string => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  if (unit === 'em') {
    const normalized = value > 10 ? value / 16 : value;
    return `${Math.min(9, Math.max(0.5, normalized))}em`;
  }
  return `${value}px`;
};

export const applyThemeSettings = (theme?: ThemeSettings): void => {
  let resolvedTheme: ThemeSettings;
  const editorFontWeight = resolveEditorFontWeight();
  try {
    resolvedTheme = resolveTheme(theme);
  } catch (error) {
    console.error('[MEO webview] Failed to resolve theme payload, using defaults.', error);
    resolvedTheme = resolveTheme();
  }

  const rootStyle = document.documentElement.style;

  for (const key of themeColorKeys) {
    rootStyle.setProperty(`--meo-color-${key}`, resolvedTheme.colors[key]);
  }

  for (const spec of SYNTAX_TAG_SPECS) {
    const tokenColor = resolvedTheme.syntaxTokens[spec.id];
    rootStyle.setProperty(`--meo-token-${spec.id}-color`, tokenColor);
  }

  const liveFont = sanitizeThemeFontStyle(resolvedTheme.fonts.liveFont);
  const sourceFont = sanitizeThemeFontStyle(resolvedTheme.fonts.sourceFont);
  const liveFontWeight = sanitizeThemeFontStyle(resolvedTheme.fonts.liveFontWeight);
  const sourceFontWeight = sanitizeThemeFontStyle(resolvedTheme.fonts.sourceFontWeight);
  const liveFontSize = normalizeThemeFontSize(resolvedTheme.fonts.liveFontSize);
  const sourceFontSize = normalizeThemeFontSize(resolvedTheme.fonts.sourceFontSize);
  const h1FontSize = normalizeThemeHeadingSize(resolvedTheme.fonts.h1FontSize, '1.6em', 'em');
  const h2FontSize = normalizeThemeHeadingSize(resolvedTheme.fonts.h2FontSize, '1.5em', 'em');
  const h3FontSize = normalizeThemeHeadingSize(resolvedTheme.fonts.h3FontSize, '1.3em', 'em');
  const h4FontSize = normalizeThemeHeadingSize(resolvedTheme.fonts.h4FontSize, '1.2em', 'em');
  const h5FontSize = normalizeThemeHeadingSize(resolvedTheme.fonts.h5FontSize, '1.1em', 'em');
  const h6FontSize = normalizeThemeHeadingSize(resolvedTheme.fonts.h6FontSize, '1em', 'em');
  const liveLineHeight = normalizeThemeLineHeight(resolvedTheme.fonts.liveLineHeight, 1.5);
  const sourceLineHeight = normalizeThemeLineHeight(resolvedTheme.fonts.sourceLineHeight, 1.5);
  rootStyle.setProperty('--meo-font-live', liveFont || vscodeEditorFontFamily);
  rootStyle.setProperty('--meo-font-source', sourceFont || vscodeEditorFontFamily);
  rootStyle.setProperty('--meo-font-live-weight', liveFontWeight || editorFontWeight);
  rootStyle.setProperty('--meo-font-source-weight', sourceFontWeight || editorFontWeight);
  rootStyle.setProperty('--meo-font-live-size', liveFontSize || vscodeEditorFontSize);
  rootStyle.setProperty('--meo-font-source-size', sourceFontSize || vscodeEditorFontSize);
  rootStyle.setProperty('--meo-heading-1-size', h1FontSize);
  rootStyle.setProperty('--meo-heading-2-size', h2FontSize);
  rootStyle.setProperty('--meo-heading-3-size', h3FontSize);
  rootStyle.setProperty('--meo-heading-4-size', h4FontSize);
  rootStyle.setProperty('--meo-heading-5-size', h5FontSize);
  rootStyle.setProperty('--meo-heading-6-size', h6FontSize);
  rootStyle.setProperty('--meo-line-height-live', `${liveLineHeight}`);
  rootStyle.setProperty('--meo-line-height-source', `${sourceLineHeight}`);
};
