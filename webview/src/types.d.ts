declare function acquireVsCodeApi(): VsCodeWebviewApi;

interface VsCodeWebviewApi {
  getState(): unknown;
  setState(state: unknown): void;
  postMessage(message: WebviewMessage): void;
}

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'applyChanges'; content?: string; baseVersion: number; changes?: { from: number; to: number; insert: string }[] }
  | { type: 'draftChanged'; text: string | null }
  | { type: 'setMode'; mode: 'live' | 'source' }
  | { type: 'setAutoSave'; enabled: boolean }
  | { type: 'setLineNumbers'; visible: boolean }
  | { type: 'setGitChangesGutter'; visible: boolean }
  | { type: 'setOutlineVisible'; visible: boolean }
  | { type: 'setFindOptions'; findOptions: { wholeWord: boolean; caseSensitive: boolean } }
  | { type: 'openLink'; href: string }
  | { type: 'resolveImageSrc'; requestId: string; url: string }
  | { type: 'resolveWikiLinks'; requestId: string; targets: string[] }
  | { type: 'resolveLocalLinks'; requestId: string; targets: string[] }
  | { type: 'saveDocument' }
  | { type: 'exportDocument'; format: 'html' | 'pdf' }
  | { type: 'exportSnapshot'; requestId: string; text: string; environment?: Record<string, unknown> }
  | { type: 'exportSnapshotError'; requestId: string; error: string; message?: string }
  | { type: 'saveImageFromClipboard'; requestId: string; imageData: string; fileName: string };

type ExtensionMessage =
  | { type: 'init'; text: string; version: number; theme: ThemeSettings; mode: 'live' | 'source'; outlinePosition: 'left' | 'right'; outlineVisible: boolean; autoSave: boolean; lineNumbers: boolean; gitChangesGutter: boolean; gitDiffLineHighlights: boolean; vimMode: boolean; findOptions: { wholeWord: boolean; caseSensitive: boolean } }
  | { type: 'docChanged'; text: string; version: number }
  | { type: 'applied'; version: number }
  | { type: 'focusEditor' }
  | { type: 'revealSelection'; anchor: number; head: number; focus?: boolean }
  | { type: 'themeChanged'; theme: ThemeSettings }
  | { type: 'outlinePositionChanged'; position: 'left' | 'right' }
  | { type: 'outlineVisibilityChanged'; visible: boolean }
  | { type: 'autoSaveChanged'; enabled: boolean }
  | { type: 'lineNumbersChanged'; enabled: boolean }
  | { type: 'gitChangesGutterChanged'; enabled: boolean }
  | { type: 'gitDiffLineHighlightsChanged'; enabled: boolean }
  | { type: 'vimModeChanged'; enabled: boolean }
  | { type: 'findOptionsChanged'; findOptions: { wholeWord: boolean; caseSensitive: boolean } }
  | { type: 'resolvedImageSrc'; requestId: string; resolvedUrl: string }
  | { type: 'resolvedWikiLinks'; requestId: string; results: Array<{ target: string; exists: boolean }> }
  | { type: 'resolvedLocalLinks'; requestId: string; results: Array<{ target: string; exists: boolean }> }
  | { type: 'savedImagePath'; requestId: string; success: boolean; path?: string; error?: string };

interface ThemeSettings {
  id: string;
  name: string;
  colors: Record<string, string>;
  syntaxTokens: Record<string, string>;
  fonts: {
    liveFont?: string;
    sourceFont?: string;
    liveFontWeight?: string;
    sourceFontWeight?: string;
    liveFontSize?: number | null;
    sourceFontSize?: number | null;
    h1FontSize?: number | null;
    h2FontSize?: number | null;
    h3FontSize?: number | null;
    h4FontSize?: number | null;
    h5FontSize?: number | null;
    h6FontSize?: number | null;
    liveLineHeight?: number;
    sourceLineHeight?: number;
  };
}

interface WikiLinkStatus {
  exists: boolean;
  path?: string;
}

interface HeadingInfo {
  text: string;
  level: number;
  from: number;
  to: number;
  lineFrom: number;
  lineTo: number;
  id: string;
}

interface GitDiffLine {
  type: 'added' | 'removed' | 'modified' | 'unchanged';
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}

interface GitBlameInfo {
  hash: string;
  author: string;
  date: string;
  message: string;
}
