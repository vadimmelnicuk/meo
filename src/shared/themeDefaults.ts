export const themeColorKeys = [
  'base02',
  'base03',
  'base04',
  'base05',
  'base06',
  'base07',
  'base08',
  'base09'
] as const;

export type ThemeColorKey = typeof themeColorKeys[number];

export type ThemeColors = Record<ThemeColorKey, string>;
export const minThemeLineHeight = 1;
export const maxThemeLineHeight = 3;
export const defaultThemeLineHeight = 1.5;

export type ThemeFonts = {
  live: string;
  source: string;
  liveLineHeight: number;
  sourceLineHeight: number;
};

export type ThemeSettings = {
  colors: ThemeColors;
  fonts: ThemeFonts;
};

export const defaultThemeColors: ThemeColors = {
  base02: '#676f7d',
  base03: '#3e444d',
  base04: '#e06c75',
  base05: '#61afef',
  base06: '#66D9EF',
  base07: '#e5c07b',
  base08: '#c678dd',
  base09: '#98c379'
};

export const defaultThemeFonts: ThemeFonts = {
  live: '',
  source: '',
  liveLineHeight: defaultThemeLineHeight,
  sourceLineHeight: defaultThemeLineHeight
};
