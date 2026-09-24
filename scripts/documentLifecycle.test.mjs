import { expect, mock, test } from 'bun:test';

const disk = new Map();
const textDocuments = [];
const commands = [];
let openTextDocument = async () => undefined;

class EventEmitter {
  listeners = [];
  event = (listener) => {
    this.listeners.push(listener);
    return { dispose() {} };
  };
  fire(value) {
    for (const listener of this.listeners) {
      listener(value);
    }
  }
  dispose() {}
}

class TabInputText {
  constructor(uri) {
    this.uri = uri;
  }
}

class TabInputCustom {
  constructor(uri) {
    this.uri = uri;
  }
}

class WorkspaceEdit {
  replace() {}
}

class Range {}

mock.module('vscode', () => ({
  EventEmitter,
  TabInputText,
  TabInputCustom,
  WorkspaceEdit,
  Range,
  Uri: { parse: (value) => ({ toString: () => value }) },
  env: { appName: 'Cursor' },
  commands: {
    executeCommand: async (name, ...args) => {
      commands.push({ name, args });
    }
  },
  window: { tabGroups: { all: [], close: async () => true } },
  workspace: {
    textDocuments,
    openTextDocument: (uri) => openTextDocument(uri),
    applyEdit: async () => false,
    fs: {
      readFile: async (uri) => Buffer.from(disk.get(uri.toString()) ?? ''),
      writeFile: async (uri, bytes) => {
        disk.set(uri.toString(), Buffer.from(bytes).toString('utf8'));
      }
    }
  }
}));

const { MarkdownCustomDocument } = await import('../src/extension/markdownCustomDocument.ts');
const { findLikelyAgentReviewState } = await import('../src/agents/reviewState.ts');
const { AgentReviewDocumentPrimer } = await import('../src/agents/documentPrimer.ts');

const fileUri = {
  scheme: 'file',
  path: '/tmp/meo-document-lifecycle.md',
  fsPath: '/tmp/meo-document-lifecycle.md',
  toString: () => 'file:///tmp/meo-document-lifecycle.md'
};
fileUri.with = () => fileUri;

function textModel(text, version = 1) {
  return {
    uri: fileUri,
    text,
    version,
    isClosed: false,
    isDirty: true,
    getText() { return this.text; },
    async save() { return true; }
  };
}

test('a closed backing model keeps the latest text and saves later edits', async () => {
  disk.set(fileUri.toString(), 'old');
  const backing = textModel('old', 7);
  const document = new MarkdownCustomDocument(fileUri, 'old', backing, 'old');
  backing.text = 'new from host';
  document.notifyExternalChange(backing);
  backing.isClosed = true;
  document.detachTextDocument(backing);

  expect(document.getText()).toBe('new from host');
  expect(await document.replaceFull('MEO edit')).toBe(true);
  expect(document.version).toBe(8);
  await document.save();
  expect(disk.get(fileUri.toString())).toBe('MEO edit');
});

test('a model that closes during Save uses the file-backed snapshot', async () => {
  disk.set(fileUri.toString(), 'old');
  const backing = textModel('MEO edit', 3);
  backing.save = async () => {
    backing.isClosed = true;
    throw new Error('Document has been closed');
  };
  const document = new MarkdownCustomDocument(fileUri, 'MEO edit', backing, 'old');

  await document.save();
  expect(disk.get(fileUri.toString())).toBe('MEO edit');
});

test('a live text model that rejects Save stays unsaved', async () => {
  disk.set(fileUri.toString(), 'old');
  const backing = textModel('MEO edit');
  backing.save = async () => false;
  const document = new MarkdownCustomDocument(fileUri, 'MEO edit', backing, 'old');

  await expect(document.save()).rejects.toThrow('Failed to save');
  expect(disk.get(fileUri.toString())).toBe('old');
});

test('an agent write refreshes a clean file-backed editor without marking it dirty', async () => {
  disk.set(fileUri.toString(), 'old');
  const document = new MarkdownCustomDocument(fileUri, 'old', undefined, 'old');
  const changes = [];
  document.onDidChangeContent((kind) => changes.push(kind));
  disk.set(fileUri.toString(), 'agent edit');

  await document.refreshFromDisk();
  expect(document.getText()).toBe('agent edit');
  expect(document.version).toBe(2);
  expect(changes).toEqual(['external']);
});

test('an agent write cannot be overwritten by a dirty file-backed editor', async () => {
  disk.set(fileUri.toString(), 'old');
  const document = new MarkdownCustomDocument(fileUri, 'old', undefined, 'old');
  await document.applyReplacements([{ startOffset: 0, endOffset: 3, insert: 'MEO edit' }]);
  disk.set(fileUri.toString(), 'agent edit');

  await document.refreshFromDisk();
  expect(document.getText()).toBe('MEO edit');
  await expect(document.save()).rejects.toThrow('changed outside MEO');
  expect(disk.get(fileUri.toString())).toBe('agent edit');
});

test('revert resets the file baseline for later agent edits', async () => {
  disk.set(fileUri.toString(), 'old');
  const document = new MarkdownCustomDocument(fileUri, 'old', undefined, 'old');
  await document.replaceFull('MEO edit');
  disk.set(fileUri.toString(), 'first agent edit');
  await document.revert();
  disk.set(fileUri.toString(), 'second agent edit');

  await document.refreshFromDisk();
  expect(document.getText()).toBe('second agent edit');
});

test('opening a closed text model loads the file instead', async () => {
  disk.set(fileUri.toString(), 'on disk');
  openTextDocument = async () => ({ ...textModel('stale'), isClosed: true });

  const document = await MarkdownCustomDocument.open(fileUri);
  expect(document.isSynchronized).toBe(false);
  expect(document.getText()).toBe('on disk');
});

test('a rejected backup restore remains available in the file-backed editor', async () => {
  disk.set(fileUri.toString(), 'on disk');
  disk.set('backup:/note', 'unsaved backup');
  openTextDocument = async () => ({
    ...textModel('on disk'),
    positionAt: (offset) => ({ line: 0, character: offset })
  });

  const document = await MarkdownCustomDocument.open(fileUri, { backupId: 'backup:/note' });
  expect(document.isSynchronized).toBe(false);
  expect(document.getText()).toBe('unsaved backup');
});

test('a pending agent review is detectable from a file-backed snapshot', () => {
  const reviewUri = {
    scheme: 'chat-editing-text-model',
    path: fileUri.path,
    toString: () => `review:${fileUri.path}`
  };
  textDocuments.push({ uri: reviewUri, getText: () => 'pending agent edit' });

  const review = findLikelyAgentReviewState(fileUri, (uri) => uri.path, () => undefined, 'on disk');
  expect(review?.uri).toBe(reviewUri);
  textDocuments.length = 0;
});

test('forced native priming waits for and upgrades an ordinary prime', async () => {
  commands.length = 0;
  let release;
  const firstOpen = new Promise((resolve) => { release = resolve; });
  let opens = 0;
  openTextDocument = async () => {
    opens += 1;
    if (opens === 1) {
      await firstOpen;
    }
    return textModel('on disk');
  };
  let pins = 0;
  const primer = new AgentReviewDocumentPrimer({
    getComparableResourceKey: (uri) => uri.path,
    getOpenTextDocumentForUri: () => undefined,
    overrides: {
      pinFile: () => { pins += 1; },
      unpinFile: () => {},
      syncNow: async () => {},
      scheduleSync: () => {}
    }
  });

  const ordinary = primer.ensureReady(fileUri);
  const forced = primer.ensureReady(fileUri, { forceNative: true });
  const idle = primer.whenIdle();
  release();
  await Promise.all([ordinary, forced, idle]);
  expect(pins).toBe(1);
  expect(commands.some((command) => command.name === 'vscode.openWith')).toBe(true);
});
