import * as vscode from 'vscode';

const VIEW_TYPE = 'markdownEditorOptimized.editor';
type EditorMode = 'live' | 'source';

type InitMessage = {
  type: 'init';
  text: string;
  version: number;
  mode: EditorMode;
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

type SaveDocumentMessage = {
  type: 'saveDocument';
};

type WebviewMessage =
  | ApplyChangesMessage
  | SetModeMessage
  | OpenLinkMessage
  | SaveDocumentMessage
  | { type: 'ready' };

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, new MarkdownWebviewProvider(context), {
      supportsMultipleEditorsPerDocument: false,
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownEditorOptimized.open', async () => {
      const active = vscode.window.activeTextEditor;
      if (!active || active.document.languageId !== 'markdown') {
        return;
      }
      await vscode.commands.executeCommand('vscode.openWith', active.document.uri, VIEW_TYPE);
    })
  );
}

class MarkdownWebviewProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist')]
    };

    panel.webview.html = this.getWebviewHtml(panel.webview);

    let mode: EditorMode = 'source';
    let applyQueue: Promise<void> = Promise.resolve();
    let initDelivered = false;

    const enqueue = (task: () => Promise<void>): Promise<void> => {
      applyQueue = applyQueue.then(task, task);
      return applyQueue;
    };

    const sendInit = async (): Promise<boolean> => {
      const message: InitMessage = {
        type: 'init',
        text: document.getText(),
        version: document.version,
        mode
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
        case 'openLink':
          await openExternalLink(raw.href);
          return;
        case 'applyChanges':
          await enqueue(() => applyDocumentChanges(document, raw, sendDocChanged, sendApplied));
          return;
        case 'saveDocument':
          await enqueue(async () => {
            await document.save();
          });
          return;
      }
    });

    const documentChangeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== document.uri.toString()) {
        return;
      }

      void enqueue(async () => {
        await sendDocChanged();
      });
    });

    void ensureInitDelivered();

    panel.onDidDispose(() => {
      messageSubscription.dispose();
      documentChangeSubscription.dispose();
    });
  }

  private getWebviewHtml(webview: vscode.Webview): string {
    const scriptUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist', 'index.js'))
      .toString();
    const styleUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'dist', 'index.css'))
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
      <body>
        <div id="app"></div>
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
    const uri = vscode.Uri.parse(rawHref, true);
    await vscode.env.openExternal(uri);
  } catch {
    // Ignore invalid URIs emitted by the webview.
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

export function deactivate(): void {}
