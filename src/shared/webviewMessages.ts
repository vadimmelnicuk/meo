import type { ExportStyleEnvironment } from '../export/exportStyles';
import type { VimKeybinding } from './extensionConfig';
import type { ThemeSettings } from './themeDefaults';
import type { RawVscodeTheme } from './vscodeTheme';

export type EditorMode = 'live' | 'source';

export type ExportFormat = 'html' | 'pdf';

export type FindOptions = {
  wholeWord: boolean;
  caseSensitive: boolean;
};

export interface EditorDiagnostic {
  from: number;
  to: number;
  severity: 0 | 1 | 2 | 3;
  message: string;
  source?: string;
  code?: string;
}

export type ExtensionMessage =
  | {
    type: 'init';
    text: string;
    version: number;
    diagnostics: EditorDiagnostic[];
    theme: ThemeSettings;
    shikiCodeBlocks: boolean;
    codeTheme: RawVscodeTheme | null;
    vscodePreviewFontFamily?: string;
    mode: 'live' | 'source';
    outlinePosition: 'left' | 'right';
    outlineVisible: boolean;
    lineNumbers: boolean;
    gitChangesGutter: boolean;
    gitDiffLineHighlights: boolean;
    spellCheckEnabled: boolean;
    contentMaxWidthEnabled: boolean;
    vimMode: boolean;
    vimKeybindings: VimKeybinding[];
    vimLeader: string;
    findOptions: { wholeWord: boolean; caseSensitive: boolean };
    restoreTopLine?: number;
    restoreTopLineOffset?: number;
  }
  | { type: 'docChanged'; text: string; version: number }
  | { type: 'applied'; version: number }
  | { type: 'focusEditor' }
  | { type: 'revealSelection'; anchor: number; head: number; focus?: boolean }
  | { type: 'diagnosticsChanged'; diagnostics: EditorDiagnostic[] }
  | { type: 'themeChanged'; theme: ThemeSettings; codeTheme: RawVscodeTheme | null; vscodePreviewFontFamily?: string }
  | { type: 'shikiCodeBlocksChanged'; enabled: boolean; codeTheme: RawVscodeTheme | null }
  | { type: 'toggleMode' }
  | { type: 'outlinePositionChanged'; position: 'left' | 'right' }
  | { type: 'outlineVisibilityChanged'; visible: boolean }
  | { type: 'lineNumbersChanged'; enabled: boolean }
  | { type: 'gitChangesGutterChanged'; enabled: boolean }
  | { type: 'gitDiffLineHighlightsChanged'; enabled: boolean }
  | { type: 'spellCheckChanged'; enabled: boolean }
  | { type: 'contentMaxWidthChanged'; enabled: boolean }
  | { type: 'vimModeChanged'; enabled: boolean }
  | { type: 'vimKeybindingsChanged'; keybindings: VimKeybinding[]; leaderKey: string }
  | { type: 'findOptionsChanged'; findOptions: { wholeWord: boolean; caseSensitive: boolean } }
  | { type: 'resolvedImageSrc'; requestId: string; resolvedUrl: string }
  | { type: 'resolvedWikiLinks'; requestId: string; results: Array<{ target: string; exists: boolean }> }
  | { type: 'resolvedLocalLinks'; requestId: string; results: Array<{ target: string; exists: boolean }> }
  | { type: 'diagnosticSuggestionsResult'; requestId: string; from: number; to: number; suggestions: string[] }
  | { type: 'savedImagePath'; requestId: string; success: boolean; path?: string; error?: string }
  | { type: 'requestExportSnapshot'; requestId: string }
  | { type: 'gitBaselineChanged'; version: number; payload: unknown }
  | { type: 'gitBlameResult'; requestId: string; lineNumber: number; localEditGeneration: number; result: unknown };

// `setLineNumbers`, `setGitChangesGutter`, and `setFindOptions` each accept two shapes,
// since the extension still reads a legacy spelling (`enabled`, and the flattened find options) alongside the current one.
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'applyChanges'; baseVersion: number; changes: Array<{ from: number; to: number; insert: string }> }
  | { type: 'draftChanged'; text: string | null }
  | { type: 'setMode'; mode: EditorMode }
  | { type: 'setLineNumbers'; visible?: boolean; enabled?: boolean }
  | { type: 'setGitChangesGutter'; visible?: boolean; enabled?: boolean }
  | { type: 'setSpellCheck'; enabled: boolean }
  | { type: 'setContentMaxWidth'; enabled: boolean }
  | { type: 'setOutlineVisible'; visible: boolean }
  | { type: 'setFindOptions'; wholeWord?: boolean; caseSensitive?: boolean; findOptions?: Partial<FindOptions> }
  | { type: 'viewPositionChanged'; topLine: number; topLineOffset?: number }
  | { type: 'openLink'; href: string }
  | { type: 'resolveImageSrc'; requestId: string; url: string }
  | { type: 'resolveWikiLinks'; requestId: string; targets: string[] }
  | { type: 'resolveLocalLinks'; requestId: string; targets: string[] }
  | { type: 'requestDiagnosticSuggestions'; requestId: string; from: number; to: number; message: string; source?: string; code?: string }
  | { type: 'saveDocument' }
  | { type: 'exportDocument'; format: ExportFormat }
  | { type: 'exportSnapshot'; requestId: string; text: string; environment?: ExportStyleEnvironment }
  | { type: 'exportSnapshotError'; requestId: string; error: string }
  | { type: 'saveImageFromClipboard'; requestId: string; imageData: string; fileName: string }
  | { type: 'requestGitBlame'; requestId: string; lineNumber: number; text?: string; localEditGeneration: number }
  | { type: 'openGitRevisionForLine'; lineNumber: number; text?: string }
  | { type: 'openGitWorktreeForLine'; lineNumber: number; text?: string };

export type ApplyChangesMessage = Extract<WebviewMessage, { type: 'applyChanges' }>;
export type RequestDiagnosticSuggestionsMessage = Extract<WebviewMessage, { type: 'requestDiagnosticSuggestions' }>;
export type SaveImageFromClipboardMessage = Extract<WebviewMessage, { type: 'saveImageFromClipboard' }>;
