import { createEditor } from './editor';
import { createElement, Heading, List, ListOrdered, ListTodo } from 'lucide';

const vscode = acquireVsCodeApi();

const root = document.getElementById('app');

if (!root) {
  throw new Error('Webview root element not found');
}

root.className = 'editor-root';

const toolbar = document.createElement('div');
toolbar.className = 'mode-toolbar';
toolbar.setAttribute('role', 'toolbar');
toolbar.setAttribute('aria-label', 'Editor toolbar');

const formatGroup = document.createElement('div');
formatGroup.className = 'format-group';
formatGroup.setAttribute('role', 'group');
formatGroup.setAttribute('aria-label', 'Formatting');

const headingBtn = document.createElement('button');
headingBtn.type = 'button';
headingBtn.className = 'format-button';
headingBtn.dataset.action = 'heading';
headingBtn.title = 'Heading';
headingBtn.appendChild(createElement(Heading, { width: 18, height: 18 }));

const bulletListBtn = document.createElement('button');
bulletListBtn.type = 'button';
bulletListBtn.className = 'format-button';
bulletListBtn.dataset.action = 'bulletList';
bulletListBtn.title = 'Bullet List';
bulletListBtn.appendChild(createElement(List, { width: 18, height: 18 }));

const numberedListBtn = document.createElement('button');
numberedListBtn.type = 'button';
numberedListBtn.className = 'format-button';
numberedListBtn.dataset.action = 'numberedList';
numberedListBtn.title = 'Numbered List';
numberedListBtn.appendChild(createElement(ListOrdered, { width: 18, height: 18 }));

const taskBtn = document.createElement('button');
taskBtn.type = 'button';
taskBtn.className = 'format-button';
taskBtn.dataset.action = 'task';
taskBtn.title = 'Task';
taskBtn.appendChild(createElement(ListTodo, { width: 18, height: 18 }));

formatGroup.append(headingBtn, bulletListBtn, numberedListBtn, taskBtn);

const modeGroup = document.createElement('div');
modeGroup.className = 'mode-group';
modeGroup.setAttribute('role', 'tablist');
modeGroup.setAttribute('aria-label', 'Markdown mode');

const liveButton = document.createElement('button');
liveButton.type = 'button';
liveButton.className = 'mode-button';
liveButton.dataset.mode = 'live';
liveButton.textContent = 'Live';
liveButton.setAttribute('role', 'tab');

const sourceButton = document.createElement('button');
sourceButton.type = 'button';
sourceButton.className = 'mode-button';
sourceButton.dataset.mode = 'source';
sourceButton.textContent = 'Source';
sourceButton.setAttribute('role', 'tab');

modeGroup.append(liveButton, sourceButton);
toolbar.append(formatGroup, modeGroup);

const editorHost = document.createElement('div');
editorHost.className = 'editor-host';

root.append(toolbar, editorHost);

let editor = null;
let documentVersion = 0;
let pendingDebounce = null;
let pendingText = null;
let syncedText = '';
let inFlight = false;
let inFlightText = null;
let saveAfterSync = false;
let currentMode = 'source';
let hasLocalModePreference = false;

const updateModeUI = () => {
  root.dataset.mode = currentMode;
  const buttons = [liveButton, sourceButton];
  for (const button of buttons) {
    const selected = button.dataset.mode === currentMode;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-selected', selected ? 'true' : 'false');
    button.tabIndex = selected ? 0 : -1;
  }
};

const applyMode = (mode, { post = true, persist = true, userTriggered = false } = {}) => {
  if (mode !== 'live' && mode !== 'source') {
    return;
  }

  currentMode = mode;
  if (userTriggered) {
    hasLocalModePreference = true;
  }
  updateModeUI();

  if (editor) {
    editor.setMode(mode);
  }

  if (persist) {
    vscode.setState({ mode });
  }

  if (post) {
    vscode.postMessage({ type: 'setMode', mode });
  }
};

const flushChanges = () => {
  if (!editor || inFlight || pendingText === null || pendingText === syncedText) {
    return;
  }

  const nextText = pendingText;
  const message = {
    type: 'applyChanges',
    baseVersion: documentVersion,
    changes: [
      {
        from: 0,
        to: syncedText.length,
        insert: nextText
      }
    ]
  };

  inFlight = true;
  inFlightText = nextText;
  syncedText = nextText;
  documentVersion++;
  vscode.postMessage(message);
};

const maybeSaveAfterSync = () => {
  if (!saveAfterSync) {
    return;
  }

  if (inFlight) {
    return;
  }

  if (pendingText !== null && pendingText !== syncedText) {
    flushChanges();
    return;
  }

  saveAfterSync = false;
  vscode.postMessage({ type: 'saveDocument' });
};

const requestSave = () => {
  if (pendingDebounce !== null) {
    window.clearTimeout(pendingDebounce);
    pendingDebounce = null;
  }

  saveAfterSync = true;
  flushChanges();
  maybeSaveAfterSync();
};

const isPrimaryModifier = (event) => {
  if (event.altKey) {
    return false;
  }
  return event.metaKey !== event.ctrlKey && (event.metaKey || event.ctrlKey);
};

const isShortcutKey = (event, key, code) => {
  return event.key.toLowerCase() === key || event.code === code;
};

const normalizeEol = (text) => text.replace(/\r\n?/g, '\n');

const handleEditorShortcut = (event) => {
  if (!editor || event.isComposing || !isPrimaryModifier(event)) {
    return false;
  }

  if (isShortcutKey(event, 's', 'KeyS')) {
    event.preventDefault();
    event.stopPropagation();
    requestSave();
    return true;
  }

  if (!editor.hasFocus()) {
    return false;
  }

  if (isShortcutKey(event, 'a', 'KeyA')) {
    event.preventDefault();
    event.stopPropagation();
    editor.selectAll();
    return true;
  }

  if (isShortcutKey(event, 'z', 'KeyZ') && !event.shiftKey) {
    event.preventDefault();
    event.stopPropagation();
    editor.undo();
    return true;
  }

  if (
    (isShortcutKey(event, 'z', 'KeyZ') && event.shiftKey) ||
    isShortcutKey(event, 'y', 'KeyY')
  ) {
    event.preventDefault();
    event.stopPropagation();
    editor.redo();
    return true;
  }

  return false;
};

const queueChanges = (nextText) => {
  pendingText = nextText;

  if (pendingDebounce !== null) {
    window.clearTimeout(pendingDebounce);
  }

  pendingDebounce = window.setTimeout(() => {
    pendingDebounce = null;
    flushChanges();
  }, 100);
};

const handleInit = (message) => {
  if (!editor) {
    editor = createEditor({
      parent: editorHost,
      text: message.text,
      onApplyChanges: queueChanges
    });
  } else {
    editor.setText(message.text);
  }
  editor.setMode(currentMode);
};

window.addEventListener('message', (event) => {
  const message = event.data;

  if (!message || typeof message !== 'object') {
    return;
  }

  if (message.type === 'init') {
    const nextMode = hasLocalModePreference ? currentMode : message.mode;
    documentVersion = message.version;
    syncedText = message.text;
    pendingText = null;
    inFlight = false;
    inFlightText = null;
    saveAfterSync = false;

    handleInit(message);
    if (hasLocalModePreference) {
      applyMode(nextMode, { post: true, persist: true });
    } else {
      applyMode(nextMode, { post: false, persist: false });
    }
    return;
  }

  if (message.type === 'docChanged' && editor) {
    const incomingText = normalizeEol(message.text);
    const currentText = normalizeEol(editor.getText());
    const pendingNormalized = pendingText === null ? null : normalizeEol(pendingText);
    const inFlightNormalized = inFlightText === null ? null : normalizeEol(inFlightText);

    documentVersion = message.version;

    if (incomingText === currentText) {
      syncedText = currentText;

      if (pendingNormalized === incomingText) {
        pendingText = null;
      }

      if (inFlight && inFlightNormalized === incomingText) {
        inFlight = false;
        inFlightText = null;
      }

      flushChanges();
      maybeSaveAfterSync();
      return;
    }

    // Ack path: remote text matches the last sent value, but local text has already advanced.
    // Keep local content and continue syncing instead of replacing the editor text.
    if (inFlight && inFlightNormalized === incomingText) {
      syncedText = inFlightText ?? message.text;
      inFlight = false;
      inFlightText = null;
      flushChanges();
      maybeSaveAfterSync();
      return;
    }

    // Local pending text already matches remote; avoid unnecessary replacement.
    if (pendingNormalized === incomingText) {
      syncedText = pendingText ?? message.text;
      pendingText = null;
      inFlight = false;
      inFlightText = null;
      flushChanges();
      maybeSaveAfterSync();
      return;
    }

    syncedText = message.text;
    pendingText = null;
    inFlight = false;
    inFlightText = null;
    saveAfterSync = false;

    if (pendingDebounce !== null) {
      window.clearTimeout(pendingDebounce);
      pendingDebounce = null;
    }

    editor.setText(message.text);
    return;
  }

  if (message.type === 'applied') {
    documentVersion = message.version;
    if (inFlightText !== null) {
      syncedText = inFlightText;
    }
    inFlight = false;
    inFlightText = null;
    flushChanges();
    maybeSaveAfterSync();
    return;
  }
});

window.addEventListener('keydown', (event) => {
  handleEditorShortcut(event);
}, { capture: true });

window.addEventListener('blur', () => {
  if (pendingDebounce !== null) {
    window.clearTimeout(pendingDebounce);
    pendingDebounce = null;
  }
  flushChanges();
});

window.addEventListener('beforeunload', () => {
  flushChanges();
});

const state = vscode.getState();
if (state && (state.mode === 'live' || state.mode === 'source')) {
  applyMode(state.mode, { post: false });
  hasLocalModePreference = true;
} else {
  updateModeUI();
}

liveButton.addEventListener('click', () => {
  applyMode('live', { userTriggered: true });
});

sourceButton.addEventListener('click', () => {
  applyMode('source', { userTriggered: true });
});

const handleFormatAction = (action) => {
  if (!editor) return;
  editor.insertFormat(action);
  editor.focus();
};

headingBtn.addEventListener('click', () => handleFormatAction('heading'));
bulletListBtn.addEventListener('click', () => handleFormatAction('bulletList'));
numberedListBtn.addEventListener('click', () => handleFormatAction('numberedList'));
taskBtn.addEventListener('click', () => handleFormatAction('task'));

vscode.setState({ mode: currentMode });
vscode.postMessage({ type: 'setMode', mode: currentMode });
vscode.postMessage({ type: 'ready' });
