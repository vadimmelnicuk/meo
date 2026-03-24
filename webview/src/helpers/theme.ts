import {
  resolveTheme,
  SYNTAX_TAG_SPECS,
  type ThemeSettings,
  themeColorKeys
} from '../../../src/shared/themeDefaults';

const vscodeEditorFontFamily = 'var(--vscode-editor-font-family)';
const vscodeEditorFontSize = 'var(--vscode-editor-font-size, 13px)';
const styleValueInjectionPattern = /[\n\r;{}]/g;
const defaultHeadingFontWeight = '600';
const headingSizeFallbacks = ['1.6em', '1.5em', '1.3em', '1.2em', '1.1em', '1em'] as const;

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

const normalizeThemeFontWeight = (value: string | undefined, fallback: string): string => {
  const normalized = sanitizeThemeFontStyle(value ?? '');
  if (!normalized) {
    return fallback;
  }
  if (/^var\(\s*--vscode-editor-font-weight\s*\)$/i.test(normalized)) {
    return fallback;
  }
  return normalized;
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
  const headingFontSizes = [
    normalizeThemeHeadingSize(resolvedTheme.fonts.h1FontSize, headingSizeFallbacks[0], 'em'),
    normalizeThemeHeadingSize(resolvedTheme.fonts.h2FontSize, headingSizeFallbacks[1], 'em'),
    normalizeThemeHeadingSize(resolvedTheme.fonts.h3FontSize, headingSizeFallbacks[2], 'em'),
    normalizeThemeHeadingSize(resolvedTheme.fonts.h4FontSize, headingSizeFallbacks[3], 'em'),
    normalizeThemeHeadingSize(resolvedTheme.fonts.h5FontSize, headingSizeFallbacks[4], 'em'),
    normalizeThemeHeadingSize(resolvedTheme.fonts.h6FontSize, headingSizeFallbacks[5], 'em')
  ];
  const headingFontWeights = [
    normalizeThemeFontWeight(resolvedTheme.fonts.h1FontWeight, defaultHeadingFontWeight),
    normalizeThemeFontWeight(resolvedTheme.fonts.h2FontWeight, defaultHeadingFontWeight),
    normalizeThemeFontWeight(resolvedTheme.fonts.h3FontWeight, defaultHeadingFontWeight),
    normalizeThemeFontWeight(resolvedTheme.fonts.h4FontWeight, defaultHeadingFontWeight),
    normalizeThemeFontWeight(resolvedTheme.fonts.h5FontWeight, defaultHeadingFontWeight),
    normalizeThemeFontWeight(resolvedTheme.fonts.h6FontWeight, defaultHeadingFontWeight)
  ];
  const liveLineHeight = normalizeThemeLineHeight(resolvedTheme.fonts.liveLineHeight, 1.5);
  const sourceLineHeight = normalizeThemeLineHeight(resolvedTheme.fonts.sourceLineHeight, 1.5);
  rootStyle.setProperty('--meo-font-live', liveFont || vscodeEditorFontFamily);
  rootStyle.setProperty('--meo-font-source', sourceFont || vscodeEditorFontFamily);
  rootStyle.setProperty('--meo-font-live-weight', liveFontWeight || editorFontWeight);
  rootStyle.setProperty('--meo-font-source-weight', sourceFontWeight || editorFontWeight);
  rootStyle.setProperty('--meo-font-live-size', liveFontSize || vscodeEditorFontSize);
  rootStyle.setProperty('--meo-font-source-size', sourceFontSize || vscodeEditorFontSize);
  for (const [index, size] of headingFontSizes.entries()) {
    rootStyle.setProperty(`--meo-heading-${index + 1}-size`, size);
  }
  for (const [index, weight] of headingFontWeights.entries()) {
    rootStyle.setProperty(`--meo-heading-${index + 1}-weight`, weight);
  }
  rootStyle.setProperty('--meo-heading-token-weight', defaultHeadingFontWeight);
  rootStyle.setProperty('--meo-line-height-live', `${liveLineHeight}`);
  rootStyle.setProperty('--meo-line-height-source', `${sourceLineHeight}`);
};
