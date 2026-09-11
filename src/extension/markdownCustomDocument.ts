import * as vscode from 'vscode';

export class MarkdownCustomDocument implements vscode.CustomDocument {
  private text: string;
  private localVersion = 1;
  private onDisposed?: () => void;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeContent = this.changeEmitter.event;

  constructor(
    readonly uri: vscode.Uri,
    text: string,
    readonly textDocument: vscode.TextDocument | undefined
  ) {
    this.text = text;
  }

  static async open(
    uri: vscode.Uri,
    openContext?: vscode.CustomDocumentOpenContext
  ): Promise<MarkdownCustomDocument> {
    const textDocument = await tryOpenWorkspaceTextDocument(uri);
    let text = textDocument ? textDocument.getText() : await readFileText(uri);

    if (openContext?.backupId) {
      try {
        const backupUri = vscode.Uri.parse(openContext.backupId);
        text = Buffer.from(await vscode.workspace.fs.readFile(backupUri)).toString('utf8');
        if (textDocument && textDocument.getText() !== text) {
          await replaceWorkspaceDocumentText(textDocument, text);
        }
      } catch {
        // Keep the on-disk text if the backup cannot be restored.
      }
    }

    return new MarkdownCustomDocument(uri, text, textDocument);
  }

  bindLifecycle(onDisposed: () => void): void {
    this.onDisposed = onDisposed;
  }

  get isSynchronized(): boolean {
    return Boolean(this.textDocument);
  }

  get version(): number {
    return this.textDocument?.version ?? this.localVersion;
  }

  get lineCount(): number {
    return lineCountOf(this.getText());
  }

  getText(): string {
    return this.textDocument?.getText() ?? this.text;
  }

  positionAt(offset: number): vscode.Position {
    if (this.textDocument) {
      return this.textDocument.positionAt(offset);
    }
    return positionAtOffset(this.text, offset);
  }

  offsetAt(position: vscode.Position): number {
    if (this.textDocument) {
      return this.textDocument.offsetAt(position);
    }
    return offsetAtPosition(this.text, position);
  }

  lineAt(line: number): { text: string; range: vscode.Range } {
    if (this.textDocument) {
      const info = this.textDocument.lineAt(line);
      return { text: info.text, range: info.range };
    }
    const start = offsetAtPosition(this.text, new vscode.Position(line, 0));
    const text = this.getText().slice(start).split(/\r\n|\n|\r/, 1)[0] ?? '';
    const range = new vscode.Range(
      new vscode.Position(line, 0),
      new vscode.Position(line, text.length)
    );
    return { text, range };
  }

  async save(destination?: vscode.Uri): Promise<void> {
    const target = destination ?? this.uri;
    if (this.textDocument && target.toString() === this.uri.toString()) {
      await this.textDocument.save();
      this.text = this.textDocument.getText();
      return;
    }

    await vscode.workspace.fs.writeFile(target, Buffer.from(this.getText(), 'utf8'));
  }

  async revert(): Promise<void> {
    if (this.uri.scheme !== 'file') {
      return;
    }

    const diskText = await readFileText(this.uri);
    if (diskText === this.getText()) {
      return;
    }

    await this.replaceFull(diskText);
  }

  async backup(destination: vscode.Uri): Promise<vscode.CustomDocumentBackup> {
    await vscode.workspace.fs.writeFile(destination, Buffer.from(this.getText(), 'utf8'));
    return {
      id: destination.toString(),
      delete: async () => {
        try {
          await vscode.workspace.fs.delete(destination);
        } catch {
          // Best-effort cleanup of a hot-exit backup.
        }
      }
    };
  }

  async replaceFull(nextText: string): Promise<boolean> {
    if (nextText === this.getText()) {
      return true;
    }

    if (this.textDocument) {
      const applied = await replaceWorkspaceDocumentText(this.textDocument, nextText);
      if (applied) {
        this.text = this.textDocument.getText();
      }
      return applied;
    }

    this.text = nextText;
    this.localVersion += 1;
    this.changeEmitter.fire();
    return true;
  }

  async applyReplacements(replacements: Array<{ startOffset: number; endOffset: number; insert: string }>): Promise<boolean> {
    if (this.textDocument) {
      const edit = new vscode.WorkspaceEdit();
      for (const replacement of replacements) {
        edit.replace(
          this.uri,
          new vscode.Range(
            this.textDocument.positionAt(replacement.startOffset),
            this.textDocument.positionAt(replacement.endOffset)
          ),
          replacement.insert
        );
      }
      const applied = await vscode.workspace.applyEdit(edit);
      if (applied) {
        this.text = this.textDocument.getText();
      }
      return applied;
    }

    let nextText = this.text;
    const sorted = [...replacements].sort((left, right) => right.startOffset - left.startOffset);
    for (const replacement of sorted) {
      nextText = `${nextText.slice(0, replacement.startOffset)}${replacement.insert}${nextText.slice(replacement.endOffset)}`;
    }
    this.text = nextText;
    this.localVersion += 1;
    this.changeEmitter.fire();
    return true;
  }

  notifyExternalChange(): void {
    if (this.textDocument) {
      this.text = this.textDocument.getText();
    }
    this.changeEmitter.fire();
  }

  dispose(): void {
    this.changeEmitter.dispose();
    this.onDisposed?.();
  }
}

export async function tryOpenWorkspaceTextDocument(uri: vscode.Uri): Promise<vscode.TextDocument | undefined> {
  try {
    return await vscode.workspace.openTextDocument(uri);
  } catch {
    return undefined;
  }
}

async function readFileText(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString('utf8');
}

async function replaceWorkspaceDocumentText(textDocument: vscode.TextDocument, nextText: string): Promise<boolean> {
  const currentText = textDocument.getText();
  if (currentText === nextText) {
    return true;
  }

  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    textDocument.uri,
    new vscode.Range(textDocument.positionAt(0), textDocument.positionAt(currentText.length)),
    nextText
  );
  return vscode.workspace.applyEdit(edit);
}

function lineCountOf(text: string): number {
  if (!text) {
    return 1;
  }
  let lines = 1;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 13) {
      lines += 1;
      if (text.charCodeAt(index + 1) === 10) {
        index += 1;
      }
      continue;
    }
    if (code === 10) {
      lines += 1;
    }
  }
  return lines;
}

function positionAtOffset(text: string, offset: number): vscode.Position {
  const end = Math.max(0, Math.min(offset, text.length));
  let line = 0;
  let character = 0;
  let index = 0;
  while (index < end) {
    const code = text.charCodeAt(index);
    if (code === 13) {
      index += text.charCodeAt(index + 1) === 10 ? 2 : 1;
      line += 1;
      character = 0;
      continue;
    }
    if (code === 10) {
      index += 1;
      line += 1;
      character = 0;
      continue;
    }
    index += 1;
    character += 1;
  }
  return new vscode.Position(line, character);
}

function offsetAtPosition(text: string, position: vscode.Position): number {
  const targetLine = Math.max(0, position.line);
  const targetCharacter = Math.max(0, position.character);
  let line = 0;
  let index = 0;
  while (index < text.length && line < targetLine) {
    const code = text.charCodeAt(index);
    if (code === 13) {
      index += text.charCodeAt(index + 1) === 10 ? 2 : 1;
      line += 1;
      continue;
    }
    if (code === 10) {
      index += 1;
      line += 1;
      continue;
    }
    index += 1;
  }

  let character = 0;
  while (index < text.length && character < targetCharacter) {
    const code = text.charCodeAt(index);
    if (code === 10 || code === 13) {
      break;
    }
    index += 1;
    character += 1;
  }
  return index;
}
