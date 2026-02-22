import * as vscode from 'vscode';
import * as path from 'node:path';
import {
  defaultThemeColors,
  defaultThemeFonts,
  themeColorKeys,
  type ThemeColors,
  type ThemeSettings
} from './shared/themeDefaults';

const VIEW_TYPE = 'markdownEditorOptimized.editor';
const AUTO_SAVE_KEY = 'autoSaveEnabled';
const LINE_NUMBERS_KEY = 'lineNumbersEnabled';
const WIKI_LINK_SCHEME = 'meo-wiki:';
type EditorMode = 'live' | 'source';
type OutlinePosition = 'left' | 'right';

type AutoSaveChangedMessage = {
  type: 'autoSaveChanged';
  enabled: boolean;
};

type LineNumbersChangedMessage = {
  type: 'lineNumbersChanged';
  enabled: boolean;
};

type InitMessage = {
  type: 'init';
  text: string;
  version: number;
  mode: EditorMode;
  autoSave: boolean;
  lineNumbers: boolean;
  outlinePosition: OutlinePosition;
  theme: ThemeSettings;
};

type DocChangedMessage = {
  type: 'docChanged';
  text: string;
  version: number;
};

type AppliedMessage = {
  type: 'applied';
  version: number;
};

type ApplyChangesMessage = {
  type: 'applyChanges';
  baseVersion: number;
  changes: Array<{ from: number; to: number; insert: string }>;
};

type SetModeMessage = {
  type: 'setMode';
  mode: EditorMode;
};

type OpenLinkMessage = {
  type: 'openLink';
  href: string;
};

type ResolveImageSrcMessage = {
  type: 'resolveImageSrc';
  requestId: string;
  url: string;
};

type ResolveWikiLinksMessage = {
  type: 'resolveWikiLinks';
  requestId: string;
  targets: string[];
};

type SaveDocumentMessage = {
  type: 'saveDocument';
};

type SetAutoSaveMessage = {
  type: 'setAutoSave';
  enabled: boolean;
};

type SetLineNumbersMessage = {
  type: 'setLineNumbers';
  enabled: boolean;
};

type ResolvedImageSrcMessage = {
  type: 'resolvedImageSrc';
  requestId: string;
  resolvedUrl: string;
};

type ResolvedWikiLinksMessage = {
  type: 'resolvedWikiLinks';
  requestId: string;
  results: Array<{ target: string; exists: boolean }>;
};

type ThemeChangedMessage = {
  type: 'themeChanged';
  theme: ThemeSettings;
};

type OutlinePositionChangedMessage = {
  type: 'outlinePositionChanged';
  position: OutlinePosition;
};

type WebviewMessage =
  | ApplyChangesMessage
  | SetModeMessage
  | SetAutoSaveMessage
  | SetLineNumbersMessage
  | OpenLinkMessage
  | ResolveImageSrcMessage
  | ResolveWikiLinksMessage
  | SaveDocumentMessage
  | { type: 'ready' };

const ALLOWED_IMAGE_SRC_RE = /^(?:https?:|data:|blob:|vscode-webview-resource:|vscode-resource:)/i;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

export function activate(context: vscode.ExtensionContext): void {
  const useAsDefault = vscode.workspace.getConfiguration('markdownEditorOptimized').get<boolean>('useAsDefault', true);
  void syncEditorAssociations(useAsDefault);

  const provider = new MarkdownWebviewProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      supportsMultipleEditorsPerDocument: false,
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('markdownEditorOptimized.useAsDefault')) {
        const shouldUseAsDefault = vscode.workspace
          .getConfiguration('markdownEditorOptimized')
          .get<boolean>('useAsDefault', true);
        void syncEditorAssociations(shouldUseAsDefault);
      }

      void provider.handleConfigurationChanged(event);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownEditorOptimized.open', async (uri?: vscode.Uri) => {
      let targetUri = uri;
      if (!targetUri) {
        const active = vscode.window.activeTextEditor;
        if (!active) {
          return;
        }
        targetUri = active.document.uri;
      }
      if (!targetUri.fsPath.endsWith('.md') && !targetUri.fsPath.endsWith('.markdown')) {
        return;
      }
      await vscode.commands.executeCommand('vscode.openWith', targetUri, VIEW_TYPE);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownEditorOptimized.setDefaultEditor', async () => {
      await updateEditorAssociations();
      void vscode.window.showInformationMessage('Markdown Editor Optimized is now set as the default editor for Markdown files.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownEditorOptimized.resetThemeToDefaults', async () => {
      await resetThemeSettingsToDefaults();
      provider.notifyThemeChanged();
      void vscode.window.showInformationMessage('Markdown Editor Optimized theme and font settings were reset to defaults.');
    })
  );
}

class MarkdownWebviewProvider implements vscode.CustomTextEditorProvider {
  private readonly activePanels = new Set<vscode.WebviewPanel>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  private broadcastAutoSaveChanged(enabled: boolean): void {
    const message: AutoSaveChangedMessage = { type: 'autoSaveChanged', enabled };
    for (const panel of this.activePanels) {
      void panel.webview.postMessage(message);
    }
  }

  private broadcastLineNumbersChanged(enabled: boolean): void {
    const message: LineNumbersChangedMessage = { type: 'lineNumbersChanged', enabled };
    for (const panel of this.activePanels) {
      void panel.webview.postMessage(message);
    }
  }

  private broadcastThemeChanged(theme: ThemeSettings): void {
    const message: ThemeChangedMessage = { type: 'themeChanged', theme };
    for (const panel of this.activePanels) {
      void panel.webview.postMessage(message);
    }
  }

  private broadcastOutlinePositionChanged(position: OutlinePosition): void {
    const message: OutlinePositionChangedMessage = { type: 'outlinePositionChanged', position };
    for (const panel of this.activePanels) {
      void panel.webview.postMessage(message);
    }
  }

  async handleConfigurationChanged(event: vscode.ConfigurationChangeEvent): Promise<void> {
    if (event.affectsConfiguration('markdownEditorOptimized.outline.position')) {
      this.broadcastOutlinePositionChanged(getOutlinePosition());
    }

    if (
      event.affectsConfiguration('markdownEditorOptimized.theme') ||
      event.affectsConfiguration('markdownEditorOptimized.fonts')
    ) {
      this.broadcastThemeChanged(getThemeSettings());
    }
  }

  notifyThemeChanged(): void {
    this.broadcastThemeChanged(getThemeSettings());
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const redirectedToNativeEditor = await this.redirectGitResourceToNativeEditor(document, panel);
    if (redirectedToNativeEditor) {
      return;
    }

    this.activePanels.add(panel);

    const documentUri = resolveWorktreeUri(document);
    const distRoot = vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist');
    const localRoots = collectLocalResourceRoots(distRoot, documentUri);
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: localRoots
    };

    panel.webview.html = this.getWebviewHtml(panel.webview);

    let mode: EditorMode = 'live';
    let applyQueue: Promise<void> = Promise.resolve();
    let initDelivered = false;
    let isApplyingOwnChange = false;

    const enqueue = (task: () => Promise<void>): Promise<void> => {
      applyQueue = applyQueue.then(task, task);
      return applyQueue;
    };

    const sendInit = async (): Promise<boolean> => {
      const autoSave = this.context.globalState.get<boolean>(AUTO_SAVE_KEY, true);
      const lineNumbers = this.context.globalState.get<boolean>(LINE_NUMBERS_KEY, true);
      const message: InitMessage = {
        type: 'init',
        text: document.getText(),
        version: document.version,
        mode,
        autoSave,
        lineNumbers,
        outlinePosition: getOutlinePosition(),
        theme: getThemeSettings()
      };
      return panel.webview.postMessage(message);
    };

    const sendDocChanged = async (): Promise<boolean> => {
      const message: DocChangedMessage = {
        type: 'docChanged',
        text: document.getText(),
        version: document.version
      };
      return panel.webview.postMessage(message);
    };

    const sendApplied = async (version: number): Promise<boolean> => {
      const message: AppliedMessage = {
        type: 'applied',
        version
      };
      return panel.webview.postMessage(message);
    };

    const ensureInitDelivered = async (): Promise<void> => {
      if (initDelivered) {
        return;
      }
      const posted = await sendInit();
      if (posted) {
        initDelivered = true;
      }
    };

    const messageSubscription = panel.webview.onDidReceiveMessage(async (raw: WebviewMessage) => {
      switch (raw.type) {
        case 'ready':
          await ensureInitDelivered();
          return;
        case 'setMode':
          mode = raw.mode;
          return;
        case 'setAutoSave':
          await this.context.globalState.update(AUTO_SAVE_KEY, raw.enabled);
          this.broadcastAutoSaveChanged(raw.enabled);
          return;
        case 'setLineNumbers':
          await this.context.globalState.update(LINE_NUMBERS_KEY, raw.enabled);
          this.broadcastLineNumbersChanged(raw.enabled);
          return;
        case 'openLink':
          await openLink(raw.href, documentUri);
          return;
        case 'resolveImageSrc': {
          const resolvedUrl = resolveWebviewImageSrc(raw.url, documentUri, panel.webview);
          const response: ResolvedImageSrcMessage = {
            type: 'resolvedImageSrc',
            requestId: raw.requestId,
            resolvedUrl
          };
          await panel.webview.postMessage(response);
          return;
        }
        case 'resolveWikiLinks': {
          const results = await resolveWikiLinkTargets(raw.targets, documentUri);
          const response: ResolvedWikiLinksMessage = {
            type: 'resolvedWikiLinks',
            requestId: raw.requestId,
            results
          };
          await panel.webview.postMessage(response);
          return;
        }
        case 'applyChanges':
          isApplyingOwnChange = true;
          await enqueue(() => applyDocumentChanges(document, raw, sendDocChanged, sendApplied));
          isApplyingOwnChange = false;
          return;
        case 'saveDocument':
          isApplyingOwnChange = true;
          await enqueue(async () => {
            await document.save();
          });
          isApplyingOwnChange = false;
          return;
      }
    });

    const documentChangeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== document.uri.toString()) {
        return;
      }

      if (isApplyingOwnChange) {
        return;
      }

      void enqueue(async () => {
        await sendDocChanged();
      });
    });

    void ensureInitDelivered();

    panel.onDidDispose(() => {
      this.activePanels.delete(panel);
      messageSubscription.dispose();
      documentChangeSubscription.dispose();
    });
  }

  private async redirectGitResourceToNativeEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel
  ): Promise<boolean> {
    if (document.uri.scheme !== 'git') {
      return false;
    }

    const viewColumn = panel.viewColumn ?? vscode.ViewColumn.Active;
    const editorOptions = {
      preserveFocus: false,
      preview: true,
      override: 'default'
    };
    const existingDiff = findDiffContextForGitUri(document.uri);

    if (existingDiff) {
      await vscode.commands.executeCommand(
        '_workbench.diff',
        existingDiff.original,
        existingDiff.modified,
        existingDiff.title,
        [viewColumn, editorOptions]
      );
      panel.dispose();
      return true;
    }

    const ref = getGitUriRef(document.uri);
    if (isWorkingTreeOrIndexRef(ref)) {
      const targetUri = resolveWorktreeUri(document);
      const title = getNativeWorkingTreeTitle(document.uri, targetUri);

      await vscode.commands.executeCommand(
        '_workbench.diff',
        document.uri,
        targetUri,
        title,
        [viewColumn, editorOptions]
      );
      panel.dispose();
      return true;
    }

    return false;
  }

  private getWebviewHtml(webview: vscode.Webview): string {
    const scriptUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist', 'index.js'))
      .toString();
    const styleUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist', 'index.css'))
      .toString();
    const mermaidRuntimeUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist', 'mermaid.min.js'))
      .toString();
    const nonce = getNonce();
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} https:`,
      `font-src ${webview.cspSource}`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src ${webview.cspSource} 'nonce-${nonce}'`
    ].join('; ');

    return `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta http-equiv="Content-Security-Policy" content="${csp};" />
        <title>Markdown Editor Optimized</title>
        <link href="${styleUri}" rel="stylesheet" />
      </head>
      <body data-meo-mermaid-src="${mermaidRuntimeUri}">
        <div id="app" class="editor-root">
        </div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
    </html>`;
  }
}

async function applyDocumentChanges(
  document: vscode.TextDocument,
  message: ApplyChangesMessage,
  sendDocChanged: () => Promise<boolean>,
  sendApplied: (version: number) => Promise<boolean>
): Promise<void> {
  if (message.baseVersion !== document.version) {
    await sendDocChanged();
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  const sortedChanges = [...message.changes].sort((a, b) => b.from - a.from);

  for (const change of sortedChanges) {
    const range = new vscode.Range(
      document.positionAt(change.from),
      document.positionAt(change.to)
    );
    edit.replace(document.uri, range, change.insert);
  }

  const applied = await vscode.workspace.applyEdit(edit);

  if (!applied) {
    await sendDocChanged();
    return;
  }

  await sendApplied(document.version);
}

async function openExternalLink(rawHref: string): Promise<void> {
  try {
    const href = normalizeExternalHref(rawHref);
    if (!href) {
      return;
    }
    const uri = vscode.Uri.parse(href, true);
    await vscode.env.openExternal(uri);
  } catch {
    // Ignore invalid URIs emitted by the webview.
  }
}

async function openLink(rawHref: string, documentUri: vscode.Uri): Promise<void> {
  if (await openWikiLink(rawHref, documentUri)) {
    return;
  }
  if (await openLocalLink(rawHref, documentUri)) {
    return;
  }
  await openExternalLink(rawHref);
}

async function openLocalLink(rawHref: string, documentUri: vscode.Uri): Promise<boolean> {
  const targetUri = await resolveLocalLinkTargetUri(rawHref, documentUri);
  if (!targetUri) {
    return false;
  }

  await vscode.commands.executeCommand('vscode.open', targetUri, {
    preview: false
  });
  return true;
}

async function openWikiLink(rawHref: string, documentUri: vscode.Uri): Promise<boolean> {
  if (!rawHref.toLowerCase().startsWith(WIKI_LINK_SCHEME)) {
    return false;
  }

  const decoded = safeDecodeURIComponent(rawHref.slice(WIKI_LINK_SCHEME.length)).trim();
  if (!decoded) {
    return true;
  }

  const target = decoded.split('#', 1)[0]?.trim() ?? '';
  if (!target) {
    return true;
  }

  const targetUri = await resolveWikiLinkTargetUri(target, documentUri);
  if (!targetUri) {
    return true;
  }

  const targetDoc = await vscode.workspace.openTextDocument(targetUri);
  await vscode.window.showTextDocument(targetDoc, { preview: false });
  return true;
}

async function resolveWikiLinkTargets(
  targets: string[],
  documentUri: vscode.Uri
): Promise<Array<{ target: string; exists: boolean }>> {
  const uniqueTargets = Array.from(new Set(targets
    .map((target) => normalizeWikiTarget(target))
    .filter((target) => target.length > 0)));

  const resolved = await Promise.all(uniqueTargets.map(async (target) => {
    const targetUri = await resolveWikiLinkTargetUri(target, documentUri);
    return { target, exists: Boolean(targetUri) };
  }));

  return resolved;
}

function normalizeWikiTarget(target: string): string {
  const normalized = target.split('#', 1)[0]?.trim() ?? '';
  if (!normalized || SCHEME_RE.test(normalized)) {
    return '';
  }
  return normalized;
}

async function resolveWikiLinkTargetUri(target: string, documentUri: vscode.Uri): Promise<vscode.Uri | null> {
  const normalized = target.replace(/\\/g, path.sep);
  const basePath = path.isAbsolute(normalized)
    ? normalized
    : path.resolve(path.dirname(documentUri.fsPath), normalized);
  const ext = path.extname(normalized);
  const candidates = ext
    ? [basePath]
    : [`${basePath}.md`, `${basePath}.markdown`, basePath];

  for (const candidate of candidates) {
    const uri = vscode.Uri.file(candidate);
    if (await uriExists(uri)) {
      return uri;
    }
  }
  return null;
}

async function resolveLocalLinkTargetUri(rawHref: string, documentUri: vscode.Uri): Promise<vscode.Uri | null> {
  const trimmed = rawHref.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const [targetPath = ''] = trimmed.split(/[?#]/, 1);
  if (!targetPath) {
    return null;
  }

  if (/^file:/i.test(targetPath)) {
    try {
      const fileUri = vscode.Uri.parse(targetPath, true);
      return (await uriExists(fileUri)) ? fileUri : null;
    } catch {
      return null;
    }
  }

  if (SCHEME_RE.test(targetPath)) {
    return null;
  }

  const decodedPath = safeDecodeURIComponent(targetPath).replace(/\\/g, path.sep);
  const basePath = path.isAbsolute(decodedPath)
    ? decodedPath
    : path.resolve(path.dirname(documentUri.fsPath), decodedPath);
  const ext = path.extname(decodedPath);
  const candidates = ext
    ? [basePath]
    : [basePath, `${basePath}.md`, `${basePath}.markdown`];

  for (const candidate of candidates) {
    const uri = vscode.Uri.file(candidate);
    if (await uriExists(uri)) {
      return uri;
    }
  }

  return null;
}

async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars[Math.floor(Math.random() * chars.length)];
  }
  return nonce;
}

function collectLocalResourceRoots(distRoot: vscode.Uri, documentUri: vscode.Uri): vscode.Uri[] {
  const roots = new Map<string, vscode.Uri>();
  roots.set(distRoot.toString(), distRoot);

  const documentDir = vscode.Uri.file(path.dirname(documentUri.fsPath));
  roots.set(documentDir.toString(), documentDir);

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    roots.set(folder.uri.toString(), folder.uri);
  }

  return Array.from(roots.values());
}

function resolveWebviewImageSrc(rawUrl: string, documentUri: vscode.Uri, webview: vscode.Webview): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return '';
  }

  if (ALLOWED_IMAGE_SRC_RE.test(trimmed)) {
    return trimmed;
  }

  if (SCHEME_RE.test(trimmed) && !/^file:/i.test(trimmed)) {
    return trimmed;
  }

  const [pathPart = ''] = trimmed.split(/[?#]/, 1);
  let filePath = '';
  if (/^file:/i.test(trimmed)) {
    try {
      filePath = vscode.Uri.parse(pathPart, true).fsPath;
    } catch {
      filePath = '';
    }
  } else if (path.isAbsolute(pathPart)) {
    filePath = pathPart;
  } else {
    const decoded = safeDecodeURIComponent(pathPart);
    filePath = path.resolve(path.dirname(documentUri.fsPath), decoded);
  }

  if (!filePath) {
    return trimmed;
  }

  return webview.asWebviewUri(vscode.Uri.file(filePath)).toString();
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeExternalHref(rawHref: string): string {
  const trimmed = rawHref.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return '';
  }
  if (/^\/\//.test(trimmed)) {
    return `https:${trimmed}`;
  }
  if (SCHEME_RE.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function resolveWorktreeUriFromGitUri(uri: vscode.Uri): vscode.Uri | undefined {
  if (uri.scheme !== 'git') {
    return undefined;
  }

  const query = parseGitUriQuery(uri.query);
  if (query?.path && typeof query.path === 'string') {
    return vscode.Uri.file(query.path);
  }

  return uri.path ? vscode.Uri.file(uri.path) : undefined;
}

function resolveWorktreeUri(document: vscode.TextDocument): vscode.Uri {
  if (document.fileName) {
    return vscode.Uri.file(document.fileName);
  }

  return resolveWorktreeUriFromGitUri(document.uri) ?? document.uri;
}

function findDiffContextForGitUri(uri: vscode.Uri): { original: vscode.Uri; modified: vscode.Uri; title: string } | undefined {
  const target = uri.toString();

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (!(input instanceof vscode.TabInputTextDiff)) {
        continue;
      }

      const original = input.original;
      const modified = input.modified;
      if (original.toString() !== target && modified.toString() !== target) {
        continue;
      }

      return {
        original,
        modified,
        title: tab.label
      };
    }
  }

  return undefined;
}

function getGitUriRef(uri: vscode.Uri): string | undefined {
  const query = parseGitUriQuery(uri.query);
  return typeof query?.ref === 'string' ? query.ref : undefined;
}

function isWorkingTreeOrIndexRef(ref: string | undefined): boolean {
  return ref === '~' || ref === 'HEAD' || ref === '';
}

function getNativeWorkingTreeTitle(gitUri: vscode.Uri, fileUri: vscode.Uri): string {
  const fileName = vscode.workspace.asRelativePath(fileUri, false) || fileUri.path;
  const ref = getGitUriRef(gitUri);

  if (ref === '~') {
    return `${fileName} (Working Tree)`;
  }

  if (ref === 'HEAD' || ref === '') {
    return `${fileName} (Index)`;
  }

  return fileName;
}

function parseGitUriQuery(query: string): { path?: unknown; ref?: unknown } | undefined {
  if (!query) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(query);
    return typeof parsed === 'object' && parsed !== null ? (parsed as { path?: unknown; ref?: unknown }) : undefined;
  } catch {
    try {
      const parsed = JSON.parse(decodeURIComponent(query));
      return typeof parsed === 'object' && parsed !== null ? (parsed as { path?: unknown; ref?: unknown }) : undefined;
    } catch {
      return undefined;
    }
  }
}

function getThemeSettings(): ThemeSettings {
  const config = vscode.workspace.getConfiguration('markdownEditorOptimized');
  const colors = {} as ThemeColors;

  for (const key of themeColorKeys) {
    colors[key] = readThemeColor(config, `theme.${key}`, defaultThemeColors[key]);
  }

  return {
    colors,
    fonts: {
      live: readThemeFont(config, 'fonts.live', defaultThemeFonts.live),
      source: readThemeFont(config, 'fonts.source', defaultThemeFonts.source)
    }
  };
}

function getOutlinePosition(): OutlinePosition {
  const value = vscode.workspace.getConfiguration('markdownEditorOptimized').get<string>('outline.position', 'right');
  return value === 'left' ? 'left' : 'right';
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

async function resetThemeSettingsToDefaults(): Promise<void> {
  const section = 'markdownEditorOptimized';
  const config = vscode.workspace.getConfiguration(section);
  const keys = [...themeColorKeys.map((key) => `theme.${key}`), 'fonts.live', 'fonts.source'];

  await clearThemeKeysForTarget(config, keys, vscode.ConfigurationTarget.Global);
  await clearThemeKeysForTarget(config, keys, vscode.ConfigurationTarget.Workspace);
  await clearThemeKeysForTarget(config, keys, vscode.ConfigurationTarget.WorkspaceFolder);
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

export function deactivate(): void {}

async function syncEditorAssociations(useAsDefault: boolean): Promise<void> {
  const config = vscode.workspace.getConfiguration('workbench');
  const associations = { ...(config.get<Record<string, string>>('editorAssociations') || {}) };
  const markdownAssociation = useAsDefault ? VIEW_TYPE : 'default';
  const next = {
    ...associations,
    '*.md': markdownAssociation,
    '*.markdown': markdownAssociation,
    'git:/**/*.md': 'default',
    'git:/**/*.markdown': 'default',
    'git:**/*.md': 'default',
    'git:**/*.markdown': 'default'
  };

  if (JSON.stringify(associations) === JSON.stringify(next)) {
    return;
  }

  await config.update('editorAssociations', next, vscode.ConfigurationTarget.Global);
}

async function updateEditorAssociations(): Promise<void> {
  await syncEditorAssociations(true);
}
