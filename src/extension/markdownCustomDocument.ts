import * as vscode from 'vscode';

export class MarkdownCustomDocument implements vscode.CustomDocument {
  private text: string;
  private savedText: string;
  private localVersion = 1;
  // VS Code may close this model while the custom editor is still open.
  private backingTextDocument: vscode.TextDocument | undefined;
  private onDisposed?: () => void;
  private readonly changeEmitter = new vscode.EventEmitter<'edit' | 'external'>();
  readonly onDidChangeContent = this.changeEmitter.event;

  constructor(
    readonly uri: vscode.Uri,
    text: string,
    textDocument: vscode.TextDocument | undefined,
    savedText = text
  ) {
    this.text = text;
    this.savedText = savedText;
    this.backingTextDocument = textDocument;
  }

  static async open(
    uri: vscode.Uri,
    openContext?: vscode.CustomDocumentOpenContext
  ): Promise<MarkdownCustomDocument> {
    let textDocument = await tryOpenWorkspaceTextDocument(uri);
    let text: string;
    try {
      text = textDocument ? textDocument.getText() : await readFileText(uri);
    } catch (error) {
      if (!textDocument?.isClosed) {
        throw error;
      }
      textDocument = undefined;
      text = await readFileText(uri);
    }
    const savedText = uri.scheme === 'file' && textDocument
      ? await readFileText(uri).catch(() => text)
      : text;

    if (openContext?.backupId) {
      let backupText: string | undefined;
      try {
        const backupUri = vscode.Uri.parse(openContext.backupId);
        backupText = Buffer.from(await vscode.workspace.fs.readFile(backupUri)).toString('utf8');
      } catch {
        // Keep the current text if the backup cannot be read.
      }
      if (backupText !== undefined) {
        text = backupText;
      }
      if (backupText !== undefined && textDocument) {
        try {
          if (textDocument.getText() !== text && !await replaceWorkspaceDocumentText(textDocument, text)) {
            textDocument = undefined;
          }
        } catch {
          // Keep the backup in the file-backed model if the text model closes.
          textDocument = undefined;
        }
      }
    }

    return new MarkdownCustomDocument(uri, text, textDocument, savedText);
  }

  bindLifecycle(onDisposed: () => void): void {
    this.onDisposed = onDisposed;
  }

  get textDocument(): vscode.TextDocument | undefined {
    const textDocument = this.backingTextDocument;
    if (textDocument?.isClosed) {
      this.detachTextDocument(textDocument);
      return undefined;
    }
    return textDocument;
  }

  detachTextDocument(textDocument: vscode.TextDocument): void {
    if (this.backingTextDocument !== textDocument) {
      return;
    }
    this.localVersion = Math.max(this.localVersion, textDocument.version);
    this.backingTextDocument = undefined;
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
    const textDocument = this.textDocument;
    if (textDocument) {
      return textDocument.positionAt(offset);
    }
    return positionAtOffset(this.text, offset);
  }

  offsetAt(position: vscode.Position): number {
    const textDocument = this.textDocument;
    if (textDocument) {
      return textDocument.offsetAt(position);
    }
    return offsetAtPosition(this.text, position);
  }

  lineAt(line: number): { text: string; range: vscode.Range } {
    const textDocument = this.textDocument;
    if (textDocument) {
      const info = textDocument.lineAt(line);
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
    const textDocument = this.textDocument;
    if (textDocument && target.toString() === this.uri.toString()) {
      try {
        const saved = await textDocument.save();
        if (!textDocument.isClosed) {
          if (!saved && textDocument.isDirty) {
            throw new Error(`Failed to save ${this.uri.fsPath || this.uri.toString()}`);
          }
          this.text = textDocument.getText();
          this.savedText = this.text;
          return;
        }
        this.detachTextDocument(textDocument);
      } catch (error) {
        if (!textDocument.isClosed) {
          throw error;
        }
        this.detachTextDocument(textDocument);
      }
    }

    const text = this.getText();
    if (target.toString() === this.uri.toString() && this.uri.scheme === 'file') {
      const diskText = await readFileText(target);
      if (diskText !== this.savedText) {
        if (diskText !== text) {
          throw new Error(`Cannot save ${this.uri.fsPath}: the file changed outside MEO.`);
        }
        this.savedText = diskText;
        return;
      }
    }
    await vscode.workspace.fs.writeFile(target, Buffer.from(text, 'utf8'));
    if (target.toString() === this.uri.toString()) {
      this.savedText = text;
    }
  }

  async revert(): Promise<void> {
    if (this.uri.scheme !== 'file') {
      return;
    }

    const diskText = await readFileText(this.uri);
    if (diskText === this.getText()) {
      this.savedText = diskText;
      return;
    }

    if (!await this.replaceFull(diskText)) {
      throw new Error(`Failed to revert ${this.uri.fsPath || this.uri.toString()}`);
    }
    this.savedText = diskText;
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

    const textDocument = this.textDocument;
    if (textDocument) {
      try {
        const applied = await replaceWorkspaceDocumentText(textDocument, nextText);
        if (applied) {
          this.text = textDocument.getText();
          return true;
        }
        if (!textDocument.isClosed) {
          return false;
        }
      } catch (error) {
        if (!textDocument.isClosed) {
          throw error;
        }
      }
      this.detachTextDocument(textDocument);
    }

    this.text = nextText;
    this.localVersion += 1;
    this.changeEmitter.fire('edit');
    return true;
  }

  async applyReplacements(replacements: Array<{ startOffset: number; endOffset: number; insert: string }>): Promise<boolean> {
    const textDocument = this.textDocument;
    if (textDocument) {
      try {
        const edit = new vscode.WorkspaceEdit();
        for (const replacement of replacements) {
          edit.replace(
            this.uri,
            new vscode.Range(
              textDocument.positionAt(replacement.startOffset),
              textDocument.positionAt(replacement.endOffset)
            ),
            replacement.insert
          );
        }
        const applied = await vscode.workspace.applyEdit(edit);
        if (applied) {
          this.text = textDocument.getText();
          return true;
        }
        if (!textDocument.isClosed) {
          return false;
        }
      } catch (error) {
        if (!textDocument.isClosed) {
          throw error;
        }
      }
      this.detachTextDocument(textDocument);
    }

    let nextText = this.text;
    const sorted = [...replacements].sort((left, right) => right.startOffset - left.startOffset);
    for (const replacement of sorted) {
      nextText = `${nextText.slice(0, replacement.startOffset)}${replacement.insert}${nextText.slice(replacement.endOffset)}`;
    }
    this.text = nextText;
    this.localVersion += 1;
    this.changeEmitter.fire('edit');
    return true;
  }

  notifyExternalChange(textDocument: vscode.TextDocument): void {
    if (this.backingTextDocument !== textDocument) {
      return;
    }
    if (textDocument.isClosed) {
      this.detachTextDocument(textDocument);
      return;
    }
    this.text = textDocument.getText();
    this.changeEmitter.fire('edit');
  }

  noteSavedTextDocument(textDocument: vscode.TextDocument): void {
    if (this.backingTextDocument !== textDocument || textDocument.isClosed) {
      return;
    }
    this.savedText = textDocument.getText();
  }

  async refreshFromDisk(): Promise<void> {
    if (this.uri.scheme !== 'file' || this.textDocument) {
      return;
    }
    const savedText = this.savedText;
    const diskText = await readFileText(this.uri);
    if (diskText === savedText || this.textDocument || this.savedText !== savedText || this.text !== savedText) {
      return;
    }
    this.text = diskText;
    this.savedText = diskText;
    this.localVersion += 1;
    this.changeEmitter.fire('external');
  }

  dispose(): void {
    this.changeEmitter.dispose();
    this.onDisposed?.();
  }
}

export async function tryOpenWorkspaceTextDocument(uri: vscode.Uri): Promise<vscode.TextDocument | undefined> {
  try {
    const textDocument = await vscode.workspace.openTextDocument(uri);
    return textDocument.isClosed ? undefined : textDocument;
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
