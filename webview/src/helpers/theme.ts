import { defaultThemeColors, defaultThemeFonts, maxThemeLineHeight, minThemeLineHeight, themeColorKeys } from '../../../src/shared/themeDefaults';

const vscodeEditorFontFamily = 'var(--vscode-editor-font-family)';
const vscodeEditorFontSize = 'var(--vscode-editor-font-size, 13px)';

const normalizeThemeLineHeight = (value: number | undefined, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(maxThemeLineHeight, Math.max(minThemeLineHeight, value));
};

export const applyThemeSettings = (theme?: ThemeSettings): void => {
  const rootStyle = document.documentElement.style;
  const colors = theme?.colors ?? {};

  for (const key of themeColorKeys) {
    const fallback = defaultThemeColors[key];
    const value = typeof colors[key] === 'string' ? colors[key].trim() : '';
    rootStyle.setProperty(`--meo-color-${key}`, value || fallback);
  }

  const fonts = theme?.fonts ?? {};
  const liveFont = typeof fonts.live === 'string' ? fonts.live.trim() : '';
  const sourceFont = typeof fonts.source === 'string' ? fonts.source.trim() : '';
  const fontSize = typeof fonts.fontSize === 'number' && Number.isFinite(fonts.fontSize) && fonts.fontSize > 0
    ? `${fonts.fontSize}px`
    : '';
  const liveLineHeight = normalizeThemeLineHeight(fonts.liveLineHeight, defaultThemeFonts.liveLineHeight);
  const sourceLineHeight = normalizeThemeLineHeight(fonts.sourceLineHeight, defaultThemeFonts.sourceLineHeight);
  rootStyle.setProperty('--meo-font-live', liveFont || vscodeEditorFontFamily);
  rootStyle.setProperty('--meo-font-source', sourceFont || vscodeEditorFontFamily);
  rootStyle.setProperty('--meo-font-size', fontSize || vscodeEditorFontSize);
  rootStyle.setProperty('--meo-line-height-live', `${liveLineHeight}`);
  rootStyle.setProperty('--meo-line-height-source', `${sourceLineHeight}`);
};
