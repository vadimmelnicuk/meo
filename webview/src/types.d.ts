declare function acquireVsCodeApi(): VsCodeWebviewApi;

interface VsCodeWebviewApi {
  getState?(): unknown;
  setState?(state: unknown): void;
  postMessage(message: WebviewMessage): void;
}

type WebviewMessage = import('../../src/shared/webviewMessages').WebviewMessage;

type VimKeybinding = import('../../src/shared/extensionConfig').VimKeybinding;

type ExtensionMessage = import('../../src/shared/webviewMessages').ExtensionMessage;

type ThemeSettings = import('../../src/shared/themeDefaults').ThemeSettings;

type EditorDiagnostic = import('../../src/shared/webviewMessages').EditorDiagnostic;

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
