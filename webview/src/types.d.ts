declare function acquireVsCodeApi(): VsCodeWebviewApi;

interface VsCodeWebviewApi {
  getState(): unknown;
  setState(state: unknown): void;
  postMessage(message: WebviewMessage): void;
}

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'applyChanges'; content?: string; baseVersion: number; changes?: { from: number; to: number; insert: string }[] }
  | { type: 'setMode'; mode: 'live' | 'source' }
  | { type: 'setAutoSave'; enabled: boolean }
  | { type: 'setLineNumbers'; visible: boolean }
  | { type: 'setGitChangesGutter'; visible: boolean }
  | { type: 'openLink'; href: string }
  | { type: 'resolveImageSrc'; requestId: string; url: string }
  | { type: 'resolveWikiLinks'; requestId: string; targets: string[] }
  | { type: 'saveDocument' }
  | { type: 'exportDocument'; format: 'html' | 'pdf' }
  | { type: 'exportSnapshot'; requestId: string; text: string; environment?: Record<string, unknown> }
  | { type: 'exportSnapshotError'; requestId: string; error: string; message?: string }
  | { type: 'saveImageFromClipboard'; requestId: string; imageData: string; fileName: string };

type ExtensionMessage =
  | { type: 'init'; content: string; version: number; theme: ThemeSettings; mode: 'live' | 'source'; outlinePosition: 'left' | 'right'; autoSaveEnabled: boolean; lineNumbersVisible: boolean }
  | { type: 'docChanged'; content: string; version: number }
  | { type: 'applied' }
  | { type: 'revealSelection'; anchor: number; head: number; focus?: boolean }
  | { type: 'themeChanged'; theme: ThemeSettings }
  | { type: 'outlinePositionChanged'; position: 'left' | 'right' }
  | { type: 'autoSaveChanged'; enabled: boolean }
  | { type: 'lineNumbersChanged'; visible: boolean }
  | { type: 'resolvedImageSrc'; requestId: string; resolvedUrl: string }
  | { type: 'resolvedWikiLinks'; requestId: string; statuses: Record<string, WikiLinkStatus> }
  | { type: 'savedImagePath'; requestId: string; success: boolean; path?: string; error?: string };

interface ThemeSettings {
  colors?: Partial<Record<string, string>>;
  fonts?: {
    live?: string;
    source?: string;
    fontSize?: number | null;
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
