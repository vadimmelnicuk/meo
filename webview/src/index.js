import { createEditor } from './editor';
import { createElement, Heading, Heading1, Heading2, Heading3, Heading4, Heading5, Heading6, List, ListOrdered, ListTodo, Save, ListTree, Code, Terminal, Quote, Minus, Table } from 'lucide';

import * as colors from './theme';
for (const [name, value] of Object.entries(colors)) {
  if (typeof value === 'string') {
    document.documentElement.style.setProperty(`--meo-color-${name}`, value);
  }
}

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

const headingDropdown = document.createElement('div');
headingDropdown.className = 'heading-dropdown';
headingDropdown.setAttribute('role', 'menu');
headingDropdown.setAttribute('aria-label', 'Heading levels');

const headingDropdownWrapper = document.createElement('div');
headingDropdownWrapper.className = 'heading-dropdown-wrapper';

const headingIcons = [Heading1, Heading2, Heading3, Heading4, Heading5, Heading6];

for (let level = 1; level <= 6; level++) {
  const option = document.createElement('button');
  option.type = 'button';
  option.className = 'heading-dropdown-option';
  option.dataset.level = level;
  option.title = `Heading ${level}`;
  option.appendChild(createElement(headingIcons[level - 1], { width: 18, height: 18 }));
  headingDropdown.appendChild(option);
}

headingDropdownWrapper.appendChild(headingDropdown);

const headingWrapper = document.createElement('div');
headingWrapper.className = 'heading-wrapper';
headingWrapper.append(headingBtn, headingDropdownWrapper);

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

let autoSaveEnabled = true;

const autoSaveBtn = document.createElement('button');
autoSaveBtn.type = 'button';
autoSaveBtn.className = 'format-button is-active';
autoSaveBtn.dataset.action = 'autoSave';
autoSaveBtn.title = 'Auto Save';
autoSaveBtn.appendChild(createElement(Save, { width: 18, height: 18 }));

let outlineVisible = false;

const outlineBtn = document.createElement('button');
outlineBtn.type = 'button';
outlineBtn.className = 'format-button';
outlineBtn.dataset.action = 'outline';
outlineBtn.title = 'Toggle Outline';
outlineBtn.appendChild(createElement(ListTree, { width: 18, height: 18 }));

const outlineSidebar = document.createElement('div');
outlineSidebar.className = 'outline-sidebar';
outlineSidebar.setAttribute('role', 'navigation');
outlineSidebar.setAttribute('aria-label', 'Document outline');

const outlineContent = document.createElement('div');
outlineContent.className = 'outline-content';
outlineSidebar.appendChild(outlineContent);

const updateAutoSaveUI = () => {
  autoSaveBtn.classList.toggle('is-active', autoSaveEnabled);
  autoSaveBtn.title = `Auto Save`;
};

const updateOutlineUI = () => {
  outlineBtn.classList.toggle('is-active', outlineVisible);
  root.classList.toggle('outline-visible', outlineVisible);
};

const toggleOutline = () => {
  outlineVisible = !outlineVisible;
  updateOutlineUI();
  if (outlineVisible && editor) {
    updateOutline();
  }
};

const updateOutline = () => {
  if (!editor) return;
  const headings = editor.getHeadings();
  outlineContent.innerHTML = '';
  
  if (headings.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'outline-empty';
    emptyMsg.textContent = 'No headings';
    outlineContent.appendChild(emptyMsg);
    return;
  }
  
  for (const heading of headings) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `outline-item outline-level-${heading.level}`;
    item.textContent = heading.text;
    item.addEventListener('click', () => {
      if (editor) {
        editor.scrollToLine(heading.line);
      }
    });
    outlineContent.appendChild(item);
  }
};

const toggleAutoSave = () => {
  autoSaveEnabled = !autoSaveEnabled;
  updateAutoSaveUI();
  vscode.postMessage({ type: 'setAutoSave', enabled: autoSaveEnabled });
};

const separator = document.createElement('div');
separator.className = 'format-separator';
separator.setAttribute('role', 'separator');

const codeBlockBtn = document.createElement('button');
codeBlockBtn.type = 'button';
codeBlockBtn.className = 'format-button';
codeBlockBtn.dataset.action = 'codeBlock';
codeBlockBtn.title = 'Code Block';
codeBlockBtn.appendChild(createElement(Code, { width: 18, height: 18 }));

const inlineCodeBtn = document.createElement('button');
inlineCodeBtn.type = 'button';
inlineCodeBtn.className = 'format-button';
inlineCodeBtn.dataset.action = 'inlineCode';
inlineCodeBtn.title = 'Inline Code';
inlineCodeBtn.appendChild(createElement(Terminal, { width: 18, height: 18 }));

const quoteBtn = document.createElement('button');
quoteBtn.type = 'button';
quoteBtn.className = 'format-button';
quoteBtn.dataset.action = 'quote';
quoteBtn.title = 'Quote';
quoteBtn.appendChild(createElement(Quote, { width: 18, height: 18 }));

const hrBtn = document.createElement('button');
hrBtn.type = 'button';
hrBtn.className = 'format-button';
hrBtn.dataset.action = 'hr';
hrBtn.title = 'Horizontal Rule';
hrBtn.appendChild(createElement(Minus, { width: 18, height: 18 }));

const tableBtn = document.createElement('button');
tableBtn.type = 'button';
tableBtn.className = 'format-button';
tableBtn.dataset.action = 'table';
tableBtn.title = 'Table';
tableBtn.appendChild(createElement(Table, { width: 18, height: 18 }));

formatGroup.append(headingWrapper, bulletListBtn, numberedListBtn, taskBtn, separator, codeBlockBtn, inlineCodeBtn, quoteBtn, hrBtn, tableBtn);

const rightGroup = document.createElement('div');
rightGroup.className = 'right-group';
rightGroup.append(outlineBtn, autoSaveBtn);

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
toolbar.append(formatGroup, rightGroup, modeGroup);

const editorHost = document.createElement('div');
editorHost.className = 'editor-host';

const editorWrapper = document.createElement('div');
editorWrapper.className = 'editor-wrapper';

editorWrapper.append(editorHost, outlineSidebar);
root.append(toolbar, editorWrapper);

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
  }, 1000);
  
  if (outlineVisible) {
    updateOutline();
  }
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
  if (typeof message.autoSave === 'boolean') {
    autoSaveEnabled = message.autoSave;
    updateAutoSaveUI();
  }
  if (outlineVisible) {
    updateOutline();
  }
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
    if (autoSaveEnabled && !inFlight && pendingText === syncedText) {
      vscode.postMessage({ type: 'saveDocument' });
    }
    return;
  }

  if (message.type === 'autoSaveChanged') {
    autoSaveEnabled = message.enabled;
    updateAutoSaveUI();
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

headingDropdown.addEventListener('click', (event) => {
  const option = event.target.closest('.heading-dropdown-option');
  if (!option || !editor) return;
  const level = parseInt(option.dataset.level, 10);
  editor.insertFormat('heading', level);
  editor.focus();
});

bulletListBtn.addEventListener('click', () => handleFormatAction('bulletList'));
numberedListBtn.addEventListener('click', () => handleFormatAction('numberedList'));
taskBtn.addEventListener('click', () => handleFormatAction('task'));
codeBlockBtn.addEventListener('click', () => handleFormatAction('codeBlock'));
inlineCodeBtn.addEventListener('click', () => handleFormatAction('inlineCode'));
quoteBtn.addEventListener('click', () => handleFormatAction('quote'));
hrBtn.addEventListener('click', () => handleFormatAction('hr'));
tableBtn.addEventListener('click', () => handleFormatAction('table'));
autoSaveBtn.addEventListener('click', toggleAutoSave);
outlineBtn.addEventListener('click', toggleOutline);

vscode.setState({ mode: currentMode });
vscode.postMessage({ type: 'setMode', mode: currentMode });
vscode.postMessage({ type: 'ready' });
