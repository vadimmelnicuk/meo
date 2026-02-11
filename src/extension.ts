import * as vscode from 'vscode';

const VIEW_TYPE = 'markdownEditorOptimized.editor';
const VIEW_SETTINGS_KEY = 'markdownEditorOptimized.viewSettings';

type ViewSettings = {
  preview: boolean;
  htmlPreview: boolean;
  previewOnly: boolean;
  pageFullscreen: boolean;
  fullscreen: boolean;
  catalog: boolean;
};

const DEFAULT_VIEW_SETTINGS: ViewSettings = {
  preview: true,
  htmlPreview: false,
  previewOnly: false,
  pageFullscreen: true,
  fullscreen: false,
  catalog: true
};

function normalizeViewSettings(raw: unknown): ViewSettings {
  const value = (raw ?? {}) as Partial<ViewSettings>;
  return {
    preview: typeof value.preview === 'boolean' ? value.preview : DEFAULT_VIEW_SETTINGS.preview,
    htmlPreview:
      typeof value.htmlPreview === 'boolean' ? value.htmlPreview : DEFAULT_VIEW_SETTINGS.htmlPreview,
    previewOnly:
      typeof value.previewOnly === 'boolean' ? value.previewOnly : DEFAULT_VIEW_SETTINGS.previewOnly,
    pageFullscreen:
      typeof value.pageFullscreen === 'boolean'
        ? value.pageFullscreen
        : DEFAULT_VIEW_SETTINGS.pageFullscreen,
    fullscreen:
      typeof value.fullscreen === 'boolean' ? value.fullscreen : DEFAULT_VIEW_SETTINGS.fullscreen,
    catalog: typeof value.catalog === 'boolean' ? value.catalog : DEFAULT_VIEW_SETTINGS.catalog
  };
}

function viewSettingsEqual(a: ViewSettings, b: ViewSettings): boolean {
  return (
    a.preview === b.preview &&
    a.htmlPreview === b.htmlPreview &&
    a.previewOnly === b.previewOnly &&
    a.pageFullscreen === b.pageFullscreen &&
    a.fullscreen === b.fullscreen &&
    a.catalog === b.catalog
  );
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new MarkdownEditorProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      supportsMultipleEditorsPerDocument: false,
      webviewOptions: {
        retainContextWhenHidden: true
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownEditorOptimized.open', async () => {
      const active = vscode.window.activeTextEditor;
      if (!active) {
        vscode.window.showInformationMessage('Open a markdown file to use Markdown Editor Optimized.');
        return;
      }
      const uri = active.document.uri;
      if (active.document.languageId !== 'markdown') {
        vscode.window.showInformationMessage('Markdown Editor Optimized only supports markdown files.');
        return;
      }
      await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownEditorOptimized.toggleFocus', async () => {
      // Zen Mode removes the editor title/breadcrumb row and other chrome.
      await vscode.commands.executeCommand('workbench.action.toggleZenMode');
    })
  );
}

class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  private context: vscode.ExtensionContext;
  private viewSettings: ViewSettings;
  private panels = new Set<vscode.WebviewPanel>();

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.viewSettings = normalizeViewSettings(context.globalState.get(VIEW_SETTINGS_KEY));
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist')
      ]
    };

    webviewPanel.webview.html = this.getWebviewHtml(webviewPanel.webview);
    this.panels.add(webviewPanel);

    const updateWebview = () => {
      webviewPanel.webview.postMessage({
        type: 'documentUpdate',
        text: document.getText(),
        fileName: vscode.workspace.asRelativePath(document.uri)
      });
    };

    let applyingEdit = false;

    webviewPanel.webview.onDidReceiveMessage(async message => {
      if (message.type === 'ready') {
        updateWebview();
        this.sendViewSettings(webviewPanel);
        return;
      }

      if (message.type === 'edit' && typeof message.text === 'string') {
        applyingEdit = true;
        try {
          const edit = new vscode.WorkspaceEdit();
          const fullRange = getFullDocumentRange(document);
          edit.replace(document.uri, fullRange, message.text);
          await vscode.workspace.applyEdit(edit);
        } finally {
          applyingEdit = false;
        }
      }

      if (message.type === 'autosave') {
        if (document.languageId === 'markdown' && document.isDirty) {
          await document.save();
        }
      }

      if (message.type === 'viewSettingsChanged') {
        this.applyViewSettings(message.settings);
      }
    });

    // Ensure we do not echo our own edits back as redundant updates.
    const throttledUpdate = debounce(() => {
      if (!applyingEdit) {
        updateWebview();
      }
    }, 150);

    const changeSubscription = vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.uri.toString() === document.uri.toString()) {
        throttledUpdate();
      }
    });

    const saveSubscription = vscode.workspace.onDidSaveTextDocument(savedDoc => {
      if (savedDoc.uri.toString() === document.uri.toString()) {
        webviewPanel.webview.postMessage({ type: 'saved' });
      }
    });

    webviewPanel.onDidDispose(() => {
      changeSubscription.dispose();
      saveSubscription.dispose();
      this.panels.delete(webviewPanel);
    });
  }

  private getWebviewHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist', 'index.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist', 'index.css')
    );

    const nonce = getNonce();

    return /* html */ `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline' https:; font-src ${webview.cspSource}; script-src ${webview.cspSource} 'nonce-${nonce}' https:;">
        <title>Markdown Editor Optimized</title>
        <link rel="stylesheet" href="${styleUri}" />
      </head>
      <body>
        <div id="app"></div>
        <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
      </body>
      </html>
    `;
  }

  private sendViewSettings(panel: vscode.WebviewPanel) {
    panel.webview.postMessage({
      type: 'viewSettings',
      settings: this.viewSettings
    });
  }

  private broadcastViewSettings() {
    for (const panel of this.panels) {
      this.sendViewSettings(panel);
    }
  }

  private applyViewSettings(raw: unknown) {
    const next = normalizeViewSettings({
      ...this.viewSettings,
      ...(raw ?? {})
    });
    if (viewSettingsEqual(this.viewSettings, next)) {
      return;
    }
    this.viewSettings = next;
    void this.context.globalState.update(VIEW_SETTINGS_KEY, this.viewSettings);
    this.broadcastViewSettings();
  }
}

function getFullDocumentRange(document: vscode.TextDocument): vscode.Range {
  const lastLine = document.lineAt(document.lineCount - 1);
  return new vscode.Range(0, 0, document.lineCount - 1, lastLine.text.length);
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function debounce<T extends (...args: any[]) => void>(fn: T, waitMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => fn(...args), waitMs);
  };
}

export function deactivate() {}
