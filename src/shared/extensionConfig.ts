import * as vscode from 'vscode';
import {
  defaultThemeSettings,
  resolveTheme,
  serializeThemeSettings,
  type ThemeSettings,
  validateThemePayload
} from './themeDefaults';

export const EXTENSION_CONFIG_SECTION = 'markdownEditorOptimized';
export const LINE_NUMBERS_SETTING_KEY = 'lineNumbers.visible';
export const GIT_CHANGES_GUTTER_SETTING_KEY = 'gitChanges.visible';
export const GIT_DIFF_LINE_HIGHLIGHTS_SETTING_KEY = 'gitChanges.lineHighlights';
export const VIM_MODE_SETTING_KEY = 'vimMode.enabled';
export const LINE_NUMBERS_LEGACY_SETTING_KEY = 'lineNumbers.enabled';
export const LINE_NUMBERS_LEGACY_VISIBLE_SETTING_KEY = 'lineNumbers.visibility';
export const GIT_CHANGES_GUTTER_LEGACY_VISIBLE_SETTING_KEY = 'gitChanges.visibility';
export const GIT_CHANGES_GUTTER_LEGACY_VISIBILITY_SETTING_KEY = 'gitChangesGutter.visibility';
export const GIT_CHANGES_GUTTER_LEGACY_SETTING_KEY = 'gitChangesGutter.enabled';
export const LINE_NUMBERS_KEY = 'lineNumbersEnabled';
export const GIT_CHANGES_GUTTER_KEY = 'gitChangesGutterEnabled';
export const VIM_MODE_KEY = 'vimModeEnabled';
export const OUTLINE_VISIBLE_KEY = 'outlineVisible';
export const MARKDOWN_FILE_EXTENSIONS = ['.md', '.markdown', '.mdx', '.mdc'] as const;

export type OutlinePosition = 'left' | 'right';

export function getThemeSettings(): ThemeSettings {
  const config = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION);
  const themeValue = config.get<unknown>('theme');

  if (!themeValue) {
    return defaultThemeSettings;
  }

  const result = validateThemePayload(themeValue);
  if (!result.success) {
    return resolveTheme(themeValue as Partial<ThemeSettings>);
  }

  return result.theme;
}

export function getLineNumbersEnabled(context: vscode.ExtensionContext): boolean {
  return getToggleSettingValue(context, LINE_NUMBERS_SETTING_KEY, LINE_NUMBERS_KEY, [
    LINE_NUMBERS_LEGACY_SETTING_KEY,
    LINE_NUMBERS_LEGACY_VISIBLE_SETTING_KEY
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
  const config = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION);
  const settingKey = 'export.browserPath';

  if (hasExplicitConfigurationValue<string>(config, settingKey)) {
    const configured = config.get<string>(settingKey, '');
    const trimmed = `${configured ?? ''}`.trim();
    return trimmed || undefined;
  }

  const configured = config.get<string>(settingKey, '');
  const trimmed = `${configured ?? ''}`.trim();
  if (trimmed) {
    return trimmed;
  }

  const legacyConfigured = config.get<string>('export.pdf.browserPath', '');
  const legacyTrimmed = `${legacyConfigured ?? ''}`.trim();
  return legacyTrimmed || undefined;
}

export function getExportEditorFontEnvironment(): { editorFontFamily?: string; editorFontWeight?: string; editorFontSizePx?: number } {
  const editorConfig = vscode.workspace.getConfiguration('editor');
  const fontFamily = `${editorConfig.get<string>('fontFamily', '') ?? ''}`.trim() || undefined;
  const editorFontWeight = `${editorConfig.get<string>('fontWeight', 'normal') ?? 'normal'}`.trim() || 'normal';
  const fontSize = editorConfig.get<number>('fontSize');
  return {
    editorFontFamily: fontFamily,
    editorFontWeight: editorFontWeight,
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
  await migrateLegacyToggleSetting(context, LINE_NUMBERS_SETTING_KEY, LINE_NUMBERS_KEY);
  await migrateLegacyToggleSetting(context, GIT_CHANGES_GUTTER_SETTING_KEY, GIT_CHANGES_GUTTER_KEY);
}

export async function resetThemeSettingsToDefault(): Promise<void> {
  const config = vscode.workspace.getConfiguration(EXTENSION_CONFIG_SECTION);
  const key = 'theme';

  try {
    await config.update(key, serializeThemeSettings(defaultThemeSettings), vscode.ConfigurationTarget.Global);
  } catch {
    // Fall back to clearing global values if writing default payload fails.
    await clearThemeKeysForTarget(config, [key], vscode.ConfigurationTarget.Global);
  }
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

async function clearThemeKeysForTarget(
  config: vscode.WorkspaceConfiguration,
  keys: string[],
  target: vscode.ConfigurationTarget
): Promise<void> {
  for (const key of keys) {
    try {
      await config.update(key, undefined, target);
    } catch {
      // Ignore failures so editor startup is not blocked by unsupported target writes.
    }
  }
}

async function syncEditorAssociationsForTarget(
  config: vscode.WorkspaceConfiguration,
  inspectedValue: Record<string, string> | undefined,
  target: vscode.ConfigurationTarget,
  markdownAssociation: string
): Promise<void> {
  const markdownAssociations = {
    ...inspectedValue,
    '*.md': markdownAssociation,
    '*.markdown': markdownAssociation,
    '*.mdx': markdownAssociation,
    '*.mdc': markdownAssociation,
    'git:/**/*.md': 'default',
    'git:/**/*.markdown': 'default',
    'git:/**/*.mdx': 'default',
    'git:/**/*.mdc': 'default',
    'git:**/*.md': 'default',
    'git:**/*.markdown': 'default',
    'git:**/*.mdx': 'default',
    'git:**/*.mdc': 'default',
    'chat-editing-text-model:/**/*.md': 'default',
    'chat-editing-text-model:/**/*.markdown': 'default',
    'chat-editing-text-model:/**/*.mdx': 'default',
    'chat-editing-text-model:/**/*.mdc': 'default',
    'chat-editing-text-model:**/*.md': 'default',
    'chat-editing-text-model:**/*.markdown': 'default',
    'chat-editing-text-model:**/*.mdx': 'default',
    'chat-editing-text-model:**/*.mdc': 'default'
  };

  await config.update('editorAssociations', markdownAssociations, target);
}
