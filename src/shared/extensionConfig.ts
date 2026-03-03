import * as vscode from 'vscode';
import { AGENT_REVIEW_MODEL_SCHEMES } from '../agents/reviewState';
import {
  defaultThemeColors,
  defaultThemeFonts,
  maxThemeLineHeight,
  minThemeLineHeight,
  themeColorKeys,
  type ThemeColors,
  type ThemeSettings
} from './themeDefaults';

export const EXTENSION_CONFIG_SECTION = 'markdownEditorOptimized';
export const AUTO_SAVE_SETTING_KEY = 'autoSave.enabled';
export const LINE_NUMBERS_SETTING_KEY = 'lineNumbers.visible';
export const GIT_CHANGES_GUTTER_SETTING_KEY = 'gitChanges.visible';
export const GIT_DIFF_LINE_HIGHLIGHTS_SETTING_KEY = 'gitChanges.lineHighlights';
export const VIM_MODE_SETTING_KEY = 'vimMode.enabled';
export const AUTO_SAVE_LEGACY_SETTING_KEY = 'autoSave.visibility';
export const LINE_NUMBERS_LEGACY_ENABLED_SETTING_KEY = 'lineNumbers.enabled';
export const LINE_NUMBERS_LEGACY_SETTING_KEY = 'lineNumbers.visibility';
export const GIT_CHANGES_GUTTER_LEGACY_VISIBLE_SETTING_KEY = 'gitChanges.visibility';
export const GIT_CHANGES_GUTTER_LEGACY_VISIBILITY_SETTING_KEY = 'gitChangesGutter.visibility';
export const GIT_CHANGES_GUTTER_LEGACY_SETTING_KEY = 'gitChangesGutter.enabled';
export const AUTO_SAVE_KEY = 'autoSaveEnabled';
export const LINE_NUMBERS_KEY = 'lineNumbersEnabled';
export const GIT_CHANGES_GUTTER_KEY = 'gitChangesGutterEnabled';
export const VIM_MODE_KEY = 'vimModeEnabled';
export const OUTLINE_VISIBLE_KEY = 'outlineVisible';
export const MARKDOWN_FILE_EXTENSIONS = ['.md', '.markdown', '.mdx', '.mdc'] as const;

export type OutlinePosition = 'left' | 'right';

export function getThemeSettings(): ThemeSettings {
  const config = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION);
  const colors = {} as ThemeColors;

  for (const key of themeColorKeys) {
    colors[key] = readThemeColor(config, `theme.${key}`, defaultThemeColors[key]);
  }

  return {
    colors,
    fonts: {
      live: readThemeFont(config, 'fonts.live', defaultThemeFonts.live),
      source: readThemeFont(config, 'fonts.source', defaultThemeFonts.source),
      fontSize: readThemeFontSize(config, 'fonts.fontSize', defaultThemeFonts.fontSize),
      liveLineHeight: readThemeLineHeight(config, 'fonts.liveLineHeight', defaultThemeFonts.liveLineHeight),
      sourceLineHeight: readThemeLineHeight(config, 'fonts.sourceLineHeight', defaultThemeFonts.sourceLineHeight)
    }
  };
}

export function getAutoSaveEnabled(context: vscode.ExtensionContext): boolean {
  return getToggleSettingValue(context, AUTO_SAVE_SETTING_KEY, AUTO_SAVE_KEY, [AUTO_SAVE_LEGACY_SETTING_KEY]);
}

export function getLineNumbersEnabled(context: vscode.ExtensionContext): boolean {
  return getToggleSettingValue(context, LINE_NUMBERS_SETTING_KEY, LINE_NUMBERS_KEY, [
    LINE_NUMBERS_LEGACY_ENABLED_SETTING_KEY,
    LINE_NUMBERS_LEGACY_SETTING_KEY
  ]);
}

export function getGitChangesGutterEnabled(context: vscode.ExtensionContext): boolean {
  return getToggleSettingValue(context, GIT_CHANGES_GUTTER_SETTING_KEY, GIT_CHANGES_GUTTER_KEY, [
    GIT_CHANGES_GUTTER_LEGACY_VISIBLE_SETTING_KEY,
    GIT_CHANGES_GUTTER_LEGACY_VISIBILITY_SETTING_KEY,
    GIT_CHANGES_GUTTER_LEGACY_SETTING_KEY
  ]);
}

export function getGitDiffLineHighlightsEnabled(): boolean {
  return vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION).get<boolean>(GIT_DIFF_LINE_HIGHLIGHTS_SETTING_KEY, true);
}

export function getVimModeEnabled(context: vscode.ExtensionContext): boolean {
  return getToggleSettingValue(context, VIM_MODE_SETTING_KEY, VIM_MODE_KEY, [], false);
}

export function getOutlinePosition(): OutlinePosition {
  const value = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION).get<string>('outline.position', 'right');
  return value === 'left' ? 'left' : 'right';
}

export function getOutlineVisible(context: vscode.ExtensionContext): boolean {
  return context.globalState.get<boolean>(OUTLINE_VISIBLE_KEY, false);
}

export function getExportPdfBrowserPath(): string | undefined {
  const configured = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION).get<string>('export.pdf.browserPath', '');
  const trimmed = `${configured ?? ''}`.trim();
  return trimmed || undefined;
}

export function getExportEditorFontEnvironment(): { editorFontFamily?: string; editorFontSizePx?: number } {
  const editorConfig = vscode.workspace.getConfiguration('editor');
  const fontFamily = `${editorConfig.get<string>('fontFamily', '') ?? ''}`.trim() || undefined;
  const fontSize = editorConfig.get<number>('fontSize');
  return {
    editorFontFamily: fontFamily,
    editorFontSizePx: typeof fontSize === 'number' && Number.isFinite(fontSize) ? fontSize : undefined
  };
}

export function isMarkdownDocumentPath(filePath: string): boolean {
  return MARKDOWN_FILE_EXTENSIONS.some((extension) => filePath.endsWith(extension));
}

export function withMarkdownExtensions(basePath: string, preferExtensionlessFirst = false): string[] {
  const extensionCandidates = MARKDOWN_FILE_EXTENSIONS.map((extension) => `${basePath}${extension}`);
  return preferExtensionlessFirst ? [basePath, ...extensionCandidates] : [...extensionCandidates, basePath];
}

export async function migrateLegacyToggleSettings(context: vscode.ExtensionContext): Promise<void> {
  await migrateLegacyToggleSetting(context, AUTO_SAVE_SETTING_KEY, AUTO_SAVE_KEY);
  await migrateLegacyToggleSetting(context, LINE_NUMBERS_SETTING_KEY, LINE_NUMBERS_KEY);
  await migrateLegacyToggleSetting(context, GIT_CHANGES_GUTTER_SETTING_KEY, GIT_CHANGES_GUTTER_KEY);
}

export async function resetThemeSettingsToDefaults(): Promise<void> {
  const config = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION);
  const keys = [
    ...themeColorKeys.map((key) => `theme.${key}`),
    'fonts.live',
    'fonts.source',
    'fonts.fontSize',
    'fonts.liveLineHeight',
    'fonts.sourceLineHeight'
  ];

  await clearThemeKeysForTarget(config, keys, vscode.ConfigurationTarget.Global);
  await clearThemeKeysForTarget(config, keys, vscode.ConfigurationTarget.Workspace);
  await clearThemeKeysForTarget(config, keys, vscode.ConfigurationTarget.WorkspaceFolder);
}

export async function syncEditorAssociations(useAsDefault: boolean): Promise<void> {
  const config = vscode.workspace.getConfiguration('workbench');
  const inspected = config.inspect<Record<string, string>>('editorAssociations');
  const markdownAssociation = useAsDefault ? 'markdownEditorOptimized.editor' : 'default';
  await syncEditorAssociationsForTarget(
    config,
    inspected?.globalValue,
    vscode.ConfigurationTarget.Global,
    markdownAssociation
  );

  if (inspected?.workspaceValue !== undefined) {
    await syncEditorAssociationsForTarget(
      config,
      inspected.workspaceValue,
      vscode.ConfigurationTarget.Workspace,
      markdownAssociation
    );
  }
}

function getToggleSettingValue(
  context: vscode.ExtensionContext,
  settingKey: string,
  legacyStateKey: string,
  legacySettingKeys: readonly string[] = [],
  fallbackDefault = true
): boolean {
  const config = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION);
  if (hasExplicitConfigurationValue<boolean>(config, settingKey)) {
    return config.get<boolean>(settingKey, fallbackDefault);
  }
  for (const legacySettingKey of legacySettingKeys) {
    if (hasExplicitConfigurationValue<boolean>(config, legacySettingKey)) {
      return config.get<boolean>(legacySettingKey, fallbackDefault);
    }
  }
  return context.globalState.get<boolean>(legacyStateKey, fallbackDefault);
}

async function migrateLegacyToggleSetting(
  context: vscode.ExtensionContext,
  settingKey: string,
  legacyStateKey: string
): Promise<void> {
  const legacyValue = context.globalState.get<boolean | undefined>(legacyStateKey);
  if (typeof legacyValue !== 'boolean') {
    return;
  }

  const config = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION);
  if (hasExplicitConfigurationValue<boolean>(config, settingKey)) {
    return;
  }

  if (legacyValue === true) {
    return;
  }

  try {
    await config.update(settingKey, legacyValue, vscode.ConfigurationTarget.Global);
  } catch {
    // Ignore configuration write failures to avoid breaking editor startup.
  }
}

function hasExplicitConfigurationValue<T>(config: vscode.WorkspaceConfiguration, key: string): boolean {
  const inspected = config.inspect<T>(key);
  if (!inspected) {
    return false;
  }

  const languageScoped = inspected as typeof inspected & {
    globalLanguageValue?: T;
    workspaceLanguageValue?: T;
    workspaceFolderLanguageValue?: T;
  };

  return (
    inspected.globalValue !== undefined ||
    inspected.workspaceValue !== undefined ||
    inspected.workspaceFolderValue !== undefined ||
    languageScoped.globalLanguageValue !== undefined ||
    languageScoped.workspaceLanguageValue !== undefined ||
    languageScoped.workspaceFolderLanguageValue !== undefined
  );
}

function readThemeColor(config: vscode.WorkspaceConfiguration, key: string, fallback: string): string {
  const value = config.get<string>(key, fallback);
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim();
  return normalized || fallback;
}

function readThemeFont(config: vscode.WorkspaceConfiguration, key: string, fallback: string): string {
  const value = config.get<string>(key, fallback);
  if (typeof value !== 'string') {
    return fallback;
  }
  return value.trim() || fallback;
}

function readThemeFontSize(config: vscode.WorkspaceConfiguration, key: string, fallback: number | null): number | null {
  const value = config.get<number | null>(key, fallback);
  if (value === null || value === undefined) {
    return fallback;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function readThemeLineHeight(config: vscode.WorkspaceConfiguration, key: string, fallback: number): number {
  const value = config.get<number>(key, fallback);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(maxThemeLineHeight, Math.max(minThemeLineHeight, value));
}

async function clearThemeKeysForTarget(
  config: vscode.WorkspaceConfiguration,
  keys: string[],
  target: vscode.ConfigurationTarget
): Promise<void> {
  for (const key of keys) {
    if (!hasThemeKeyValueAtTarget(config, key, target)) {
      continue;
    }
    await config.update(key, undefined, target);
  }
}

function hasThemeKeyValueAtTarget(
  config: vscode.WorkspaceConfiguration,
  key: string,
  target: vscode.ConfigurationTarget
): boolean {
  const inspected = config.inspect(key);
  if (!inspected) {
    return false;
  }
  if (target === vscode.ConfigurationTarget.Global) {
    return inspected.globalValue !== undefined;
  }
  if (target === vscode.ConfigurationTarget.Workspace) {
    return inspected.workspaceValue !== undefined;
  }
  if (target === vscode.ConfigurationTarget.WorkspaceFolder) {
    return inspected.workspaceFolderValue !== undefined;
  }
  return false;
}

async function syncEditorAssociationsForTarget(
  config: vscode.WorkspaceConfiguration,
  associations: Record<string, string> | undefined,
  target: vscode.ConfigurationTarget.Global | vscode.ConfigurationTarget.Workspace,
  markdownAssociation: string
): Promise<void> {
  const current = { ...(associations || {}) };
  const next = { ...current };

  for (const extension of MARKDOWN_FILE_EXTENSIONS) {
    next[`*${extension}`] = markdownAssociation;
    next[`git:**/*${extension}`] = 'default';
    next[`git:/**/*${extension}`] = 'default';
    for (const scheme of AGENT_REVIEW_MODEL_SCHEMES) {
      next[`${scheme}:**/*${extension}`] = 'default';
      next[`${scheme}:/**/*${extension}`] = 'default';
    }
  }

  if (JSON.stringify(current) === JSON.stringify(next)) {
    return;
  }

  await config.update('editorAssociations', next, target);
}
