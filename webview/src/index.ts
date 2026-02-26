import { createEditor } from './editor';
import { createElement, Heading, Heading1, Heading2, Heading3, Heading4, Heading5, Heading6, List, ListOrdered, ListTodo, Save, ListTree, Hash, Code, Terminal, Quote, Minus, Table2, Link, Brackets, Image, Bold, Italic, Strikethrough, Search, Share, GitCompare } from 'lucide';
import { setImageSrcResolver, initializeImageHandling, resolveImageSrc, settleImageSrcRequest, handleSavedImagePath, handleImagePaste } from './helpers/images';
import { createGitClient } from './helpers/gitClient';
import { createOutlineController } from './helpers/outline';
import { normalizeWikiTarget, replaceWikiLinkStatuses, initializeWikiLinkHandling, collectWikiLinkTargets, requestWikiLinkStatuses, scheduleWikiLinkStatusRefresh, setWikiLinkRefreshContext, cancelPendingWikiStatusRefresh, handleResolvedWikiLinks } from './helpers/wikiLinks';
import { setGitDiffLineHighlightsEnabled } from './helpers/gitDiffLineHighlights';
import { applyThemeSettings } from './helpers/theme';
import { createFailureNoticeManager, getErrorMessage, isTransientMermaidRuntimeError, shouldAutoFallbackToSourceForLiveError, logWebviewRenderError, type EditorNotice, type FailureNoticeManager } from './helpers/errors';
import { isPrimaryModifier, isShortcutKey, normalizeEol, handleEditorShortcut, type ShortcutHandlerContext } from './helpers/shortcuts';
import { createFindPanel, createFindPanelController, type FindPanelController } from './helpers/findPanel';
import { createSelectionMenu, createSelectionMenuController, type SelectionMenuController } from './helpers/selectionMenu';
import { createExportHandler, type ExportHandlerContext } from './helpers/export';

const vscode = acquireVsCodeApi();
initializeImageHandling(vscode);
initializeWikiLinkHandling(vscode);

applyThemeSettings();
setImageSrcResolver(resolveImageSrc);

const root = document.getElementById('app');

if (!root) {
  throw new Error('Webview root element not found');
}

root.classList.add('editor-root');

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
  option.dataset.level = String(level);
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
let vimModeEnabled = false;

const autoSaveBtn = document.createElement('button');
autoSaveBtn.type = 'button';
autoSaveBtn.className = 'format-button toggle-button is-active';
autoSaveBtn.dataset.action = 'autoSave';
autoSaveBtn.title = 'Auto Save';
autoSaveBtn.appendChild(createElement(Save, { width: 18, height: 18 }));

let lineNumbersVisible = true;
let gitChangesGutterVisible = true;

const outlineBtn = document.createElement('button');
outlineBtn.type = 'button';
outlineBtn.className = 'format-button toggle-button';
outlineBtn.dataset.action = 'outline';
outlineBtn.title = 'Toggle Outline';
outlineBtn.appendChild(createElement(ListTree, { width: 18, height: 18 }));

const lineNumbersBtn = document.createElement('button');
lineNumbersBtn.type = 'button';
lineNumbersBtn.className = 'format-button toggle-button is-active';
lineNumbersBtn.dataset.action = 'lineNumbers';
lineNumbersBtn.title = 'Hide Line Numbers';
lineNumbersBtn.appendChild(createElement(Hash, { width: 18, height: 18 }));

const gitChangesGutterBtn = document.createElement('button');
gitChangesGutterBtn.type = 'button';
gitChangesGutterBtn.className = 'format-button toggle-button is-active';
gitChangesGutterBtn.dataset.action = 'gitChangesGutter';
gitChangesGutterBtn.title = 'Hide Git Changes Gutter';
gitChangesGutterBtn.appendChild(createElement(GitCompare, { width: 18, height: 18 }));

const updateAutoSaveUI = () => {
  autoSaveBtn.classList.toggle('is-active', autoSaveEnabled);
  autoSaveBtn.title = `Auto Save`;
};

const updateLineNumbersUI = () => {
  lineNumbersBtn.classList.toggle('is-active', lineNumbersVisible);
  lineNumbersBtn.setAttribute('aria-pressed', lineNumbersVisible ? 'true' : 'false');
  lineNumbersBtn.title = lineNumbersVisible ? 'Hide Line Numbers' : 'Show Line Numbers';
};

const updateGitChangesGutterUI = () => {
  gitChangesGutterBtn.classList.toggle('is-active', gitChangesGutterVisible);
  gitChangesGutterBtn.setAttribute('aria-pressed', gitChangesGutterVisible ? 'true' : 'false');
  gitChangesGutterBtn.title = gitChangesGutterVisible ? 'Hide Git Changes' : 'Show Git Changes';
};

const toggleAutoSave = () => {
  autoSaveEnabled = !autoSaveEnabled;
  updateAutoSaveUI();
  vscode.postMessage({ type: 'setAutoSave', enabled: autoSaveEnabled });
};

const setLineNumbersVisible = (visible, { post = true } = {}) => {
  const nextVisible = visible !== false;
  const changed = nextVisible !== lineNumbersVisible;
  if (changed) {
    lineNumbersVisible = nextVisible;
    editor?.setLineNumbers(lineNumbersVisible);
  }
  updateLineNumbersUI();
  if (post && changed) {
    vscode.postMessage({ type: 'setLineNumbers', visible: lineNumbersVisible });
  }
};

const setGitChangesGutterVisible = (visible, { post = true } = {}) => {
  const nextVisible = visible !== false;
  const changed = nextVisible !== gitChangesGutterVisible;
  if (changed) {
    gitChangesGutterVisible = nextVisible;
    editor?.setGitGutterVisible(gitChangesGutterVisible);
    if (editor) {
    setGitDiffLineHighlightsEnabled(editor, false);
    }
  }
  updateGitChangesGutterUI();
  if (post && changed) {
    vscode.postMessage({ type: 'setGitChangesGutter', visible: gitChangesGutterVisible });
  }
};

const setVimModeEnabled = (enabled) => {
  const nextEnabled = enabled === true;
  if (nextEnabled === vimModeEnabled) {
    return;
  }
  vimModeEnabled = nextEnabled;
  editor?.setVimMode(vimModeEnabled);
};

const toggleLineNumbers = () => {
  setLineNumbersVisible(!lineNumbersVisible);
};

const toggleGitChangesGutter = () => {
  setGitChangesGutterVisible(!gitChangesGutterVisible);
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

const linkBtn = document.createElement('button');
linkBtn.type = 'button';
linkBtn.className = 'format-button';
linkBtn.dataset.action = 'link';
linkBtn.title = 'Link';
linkBtn.appendChild(createElement(Link, { width: 18, height: 18 }));

const wikiLinkBtn = document.createElement('button');
wikiLinkBtn.type = 'button';
wikiLinkBtn.className = 'format-button';
wikiLinkBtn.dataset.action = 'wikiLink';
wikiLinkBtn.title = 'Wiki Link';
wikiLinkBtn.appendChild(createElement(Brackets, { width: 18, height: 18 }));

const imageBtn = document.createElement('button');
imageBtn.type = 'button';
imageBtn.className = 'format-button';
imageBtn.dataset.action = 'image';
imageBtn.title = 'Image';
imageBtn.appendChild(createElement(Image, { width: 18, height: 18 }));

const tableBtn = document.createElement('button');
tableBtn.type = 'button';
tableBtn.className = 'format-button';
tableBtn.dataset.action = 'table';
tableBtn.title = 'Table';
tableBtn.appendChild(createElement(Table2, { width: 18, height: 18 }));

const tableDropdown = document.createElement('div');
tableDropdown.className = 'table-dropdown';

const tableDropdownWrapper = document.createElement('div');
tableDropdownWrapper.className = 'table-dropdown-wrapper';

const tableGrid = document.createElement('div');
tableGrid.className = 'table-grid';

const gridSize = 5;
for (let row = 0; row < gridSize; row++) {
  for (let col = 0; col < gridSize; col++) {
    const cell = document.createElement('div');
    cell.className = 'table-grid-cell';
    cell.dataset.row = String(row + 1);
    cell.dataset.col = String(col + 1);
    if (row === 0 && col === 0) {
      cell.classList.add('is-highlighted');
    }
    tableGrid.appendChild(cell);
  }
}

const tableSizeLabel = document.createElement('div');
tableSizeLabel.className = 'table-size-label';
tableSizeLabel.textContent = '1 x 1';

tableDropdown.append(tableGrid, tableSizeLabel);
tableDropdownWrapper.appendChild(tableDropdown);

const tableWrapper = document.createElement('div');
tableWrapper.className = 'table-wrapper';
tableWrapper.append(tableBtn, tableDropdownWrapper);

let selectedTableCols = 1;
let selectedTableRows = 1;

const updateTableGridHighlight = (hoveredCol: number, hoveredRow: number) => {
  const cells = tableGrid.querySelectorAll('.table-grid-cell');
  cells.forEach((cell) => {
    const cellCol = parseInt((cell as HTMLElement).dataset.col ?? '', 10);
    const cellRow = parseInt((cell as HTMLElement).dataset.row ?? '', 10);
    cell.classList.toggle('is-highlighted', cellCol <= hoveredCol && cellRow <= hoveredRow);
  });
  tableSizeLabel.textContent = `${hoveredCol} x ${hoveredRow}`;
  selectedTableCols = hoveredCol;
  selectedTableRows = hoveredRow;
};

tableGrid.addEventListener('mouseover', (event) => {
  const cell = (event.target as Element).closest('.table-grid-cell') as HTMLElement | null;
  if (!cell) return;
  const col = parseInt(cell.dataset.col ?? '', 10);
  const row = parseInt(cell.dataset.row ?? '', 10);
  updateTableGridHighlight(col, row);
});

tableGrid.addEventListener('mouseleave', () => {
  updateTableGridHighlight(1, 1);
});

tableGrid.addEventListener('click', (event) => {
  const cell = (event.target as Element).closest('.table-grid-cell') as HTMLElement | null;
  if (!cell || !editor) return;
  editor.insertFormat('table', { cols: selectedTableCols, rows: selectedTableRows });
  editor.focus();
});

formatGroup.append(headingWrapper, bulletListBtn, numberedListBtn, taskBtn, separator, tableWrapper, codeBlockBtn, linkBtn, wikiLinkBtn, imageBtn, quoteBtn, hrBtn);

const rightGroup = document.createElement('div');
rightGroup.className = 'right-group';

const findToggleBtn = document.createElement('button');
findToggleBtn.type = 'button';
findToggleBtn.className = 'format-button toggle-button';
findToggleBtn.dataset.action = 'find';
findToggleBtn.title = 'Find and Replace';
findToggleBtn.appendChild(createElement(Search, { width: 18, height: 18 }));

const exportBtn = document.createElement('button');
exportBtn.type = 'button';
exportBtn.className = 'format-button export-button';
exportBtn.dataset.action = 'export';
exportBtn.title = 'Export';
exportBtn.setAttribute('aria-label', 'Export');
exportBtn.appendChild(createElement(Share, { width: 18, height: 18 }));

const exportDropdown = document.createElement('div');
exportDropdown.className = 'export-dropdown';
exportDropdown.setAttribute('role', 'menu');
exportDropdown.setAttribute('aria-label', 'Export formats');

const exportDropdownWrapper = document.createElement('div');
exportDropdownWrapper.className = 'export-dropdown-wrapper';

const exportHtmlOption = document.createElement('button');
exportHtmlOption.type = 'button';
exportHtmlOption.className = 'export-dropdown-option';
exportHtmlOption.dataset.format = 'html';
exportHtmlOption.title = 'Export as HTML';
exportHtmlOption.textContent = 'HTML';

const exportPdfOption = document.createElement('button');
exportPdfOption.type = 'button';
exportPdfOption.className = 'export-dropdown-option';
exportPdfOption.dataset.format = 'pdf';
exportPdfOption.title = 'Export as PDF';
exportPdfOption.textContent = 'PDF';

exportDropdown.append(exportHtmlOption, exportPdfOption);
exportDropdownWrapper.appendChild(exportDropdown);

const exportWrapper = document.createElement('div');
exportWrapper.className = 'export-wrapper';
exportWrapper.append(exportBtn, exportDropdownWrapper);

rightGroup.append(outlineBtn, findToggleBtn, lineNumbersBtn, gitChangesGutterBtn, autoSaveBtn, exportWrapper);

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
liveButton.title = 'Live';

const sourceButton = document.createElement('button');
sourceButton.type = 'button';
sourceButton.className = 'mode-button';
sourceButton.dataset.mode = 'source';
sourceButton.textContent = 'Source';
sourceButton.setAttribute('role', 'tab');
sourceButton.title = 'Source';

modeGroup.append(liveButton, sourceButton);

const findPanelElements = createFindPanel(findToggleBtn);
const findPanelController = createFindPanelController(findPanelElements, () => editor, toolbar, modeGroup);

const selectionMenuElements = createSelectionMenu();
const selectionMenuController = createSelectionMenuController(selectionMenuElements, () => editor);

toolbar.append(formatGroup, rightGroup, modeGroup, findPanelElements.panel);

const editorHost = document.createElement('div');
editorHost.className = 'editor-host';

const editorWrapper = document.createElement('div');
editorWrapper.className = 'editor-wrapper';

let editor: any = null;
const outlineController = createOutlineController({
  root,
  editorWrapper,
  outlineButton: outlineBtn,
  getEditor: () => editor
});

editorWrapper.append(editorHost, outlineController.sidebar, selectionMenuElements.menu);
root.replaceChildren(toolbar);
window.requestAnimationFrame(() => {
  if (!root.contains(editorWrapper)) {
    root.append(editorWrapper);
  }
});

let documentVersion = 0;
let pendingDebounce: number | null = null;
let pendingText: string | null = null;
let syncedText = '';
let inFlight = false;
let inFlightText: string | null = null;
let saveAfterSync = false;
let currentMode: 'live' | 'source' = 'live';
let hasLocalModePreference = false;
let pendingInitialText: string | null = null;
let initialEditorMountQueued = false;
let initialMountRecoveryAttempted = false;
let modeToggleShouldRestoreEditorFocus = false;
let gitClient: any = null;
let pendingRevealSelection: { anchor: number; head: number; focus?: boolean } | null = null;

const editorNotice: EditorNotice = {
  setEditorNotice: (_message, _kind = 'info') => {},
  clearEditorNotice: () => {}
};

const failureNotice = createFailureNoticeManager(editorNotice);

const clearGitBlameCache = ({ hideTooltip = true } = {}) => {
  gitClient?.clearBlameCache({ hideTooltip });
};

const bumpLocalEditGeneration = () => {
  gitClient?.bumpLocalEditGeneration();
};

const persistModeState = () => {
  vscode.setState({ mode: currentMode });
};

const getCurrentEditorText = () => {
  if (editor) {
    return editor.getText();
  }
  if (typeof pendingText === 'string') {
    return pendingText;
  }
  if (typeof pendingInitialText === 'string') {
    return pendingInitialText;
  }
  return syncedText;
};

const clampRevealOffset = (value: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(Math.floor(value), max));
};

const applyRevealSelectionFromHost = (revealMessage: any) => {
  if (!revealMessage || typeof revealMessage !== 'object') {
    return;
  }

  const { anchor, head, focus } = revealMessage;
  if (typeof anchor !== 'number' || typeof head !== 'number') {
    return;
  }

  if (!editor) {
    pendingRevealSelection = { anchor, head, focus };
    return;
  }

  const max = editor.getText().length;
  const clampedAnchor = clampRevealOffset(anchor, max);
  const clampedHead = clampRevealOffset(head, max);
  editor.revealSelection(clampedAnchor, clampedHead, {
    focusEditor: focus !== false,
    align: 'center'
  });
  pendingRevealSelection = null;
};

gitClient = createGitClient({
  vscode,
  getCurrentEditorText: () => getCurrentEditorText(),
  getSyncedText: () => syncedText,
  clearTransientUi: () => editor?.clearGitUiTransientState?.()
});

const requestGitBlameForLine = ({ lineNumber }: { lineNumber: number }) => {
  if (!gitClient) {
    return Promise.resolve({ kind: 'unavailable', reason: 'error' });
  }
  return gitClient.requestBlameForLine({ lineNumber });
};

const openGitRevisionForLine = ({ lineNumber }: { lineNumber: number }) => {
  gitClient?.openRevisionForLine({ lineNumber });
};

const openGitWorktreeForLine = ({ lineNumber }: { lineNumber: number }) => {
  gitClient?.openWorktreeForLine({ lineNumber });
};

const flushChanges = () => {
  if (!editor || inFlight || pendingText === null || normalizeEol(pendingText) === syncedText) {
    return;
  }

  const nextText = pendingText;
  const message: WebviewMessage = {
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
  syncedText = normalizeEol(nextText);
  documentVersion++;
  vscode.postMessage(message);
};

const flushPendingChangesNow = () => {
  if (pendingDebounce !== null) {
    window.clearTimeout(pendingDebounce);
    pendingDebounce = null;
  }

  flushChanges();
};

const maybeSaveAfterSync = () => {
  if (!saveAfterSync) {
    return;
  }

  if (inFlight) {
    return;
  }

  if (pendingText !== null && normalizeEol(pendingText) !== syncedText) {
    flushChanges();
    return;
  }

  saveAfterSync = false;
  vscode.postMessage({ type: 'saveDocument' });
};

const requestSave = async () => {
  saveAfterSync = true;
  flushPendingChangesNow();

  let retries = 0;
  while (inFlight && retries < 50) {
    await new Promise(resolve => window.setTimeout(resolve, 20));
    retries++;
  }

  maybeSaveAfterSync();
};

const setEditorTextSafely = (text: string, context: string): boolean => {
  if (!editor) {
    return false;
  }

  try {
    editor.setText(text);
    return true;
  } catch (error) {
    logWebviewRenderError('setText', error, { context });

    if (currentMode === 'live') {
      try {
        editor.setText(text);
        failureNotice.clearFailureNotice();
        return true;
      } catch (retryInLiveError) {
        logWebviewRenderError('setText.retryInLive', retryInLiveError, { context });
        if (!shouldAutoFallbackToSourceForLiveError(retryInLiveError)) {
          failureNotice.setFailureNotice('Live mode hit a transient render error while updating. Try again.', 'warning');
          return false;
        }
      }

      failureNotice.setFailureNotice(failureNotice.liveModeFailureMessage, 'warning');
      applyMode('source', { post: true, persist: false, reason: 'render-failure' });
      if (!editor) {
        return false;
      }
      try {
        editor.setText(text);
        return true;
      } catch (retryError) {
        logWebviewRenderError('setText.retryInSource', retryError, { context });
        failureNotice.setFailureNotice(failureNotice.editorUpdateFailureMessage, 'error');
        return false;
      }
    }

    failureNotice.setFailureNotice(failureNotice.editorUpdateFailureMessage, 'error');
    return false;
  }
};

const shortcutHandlerContext: ShortcutHandlerContext = {
  get editor() { return editor; },
  get currentMode() { return currentMode; },
  get vimModeEnabled() { return vimModeEnabled; },
  get pendingText() { return pendingText; },
  get syncedText() { return syncedText; },
  requestSave,
  openFindPanel: (target) => findPanelController.open(target),
  applyMode: (mode, options) => applyMode(mode, options),
  flushPendingChangesNow
};

const queueChanges = (nextText: string) => {
  bumpLocalEditGeneration();
  pendingText = nextText;

  if (pendingDebounce !== null) {
    window.clearTimeout(pendingDebounce);
  }

  pendingDebounce = window.setTimeout(() => {
    pendingDebounce = null;
    flushChanges();
  }, 100);

  if (outlineController.isVisible()) {
    outlineController.refresh();
  }
  scheduleWikiLinkStatusRefresh(nextText);
  findPanelController.updateFindStatusSummary();
};

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

const applyMode = (mode: 'live' | 'source', { post = true, persist = true, userTriggered = false, reason = 'user' } = {}): boolean => {
  if (mode !== 'live' && mode !== 'source') {
    return false;
  }

  const previousMode = currentMode;
  const shouldRestoreEditorFocus = modeToggleShouldRestoreEditorFocus;
  modeToggleShouldRestoreEditorFocus = false;
  currentMode = mode;
  clearGitBlameCache();
  if (userTriggered) {
    hasLocalModePreference = true;
  }
  updateModeUI();

  if (editor) {
    try {
      editor.setMode(mode);
      if (shouldRestoreEditorFocus) {
        editor.focus();
      }
      if (mode === 'live') {
        failureNotice.clearFailureNotice();
      }
    } catch (error) {
      logWebviewRenderError('applyMode', error, { requestedMode: mode, reason });

      if (mode === 'live') {
        if (!shouldAutoFallbackToSourceForLiveError(error)) {
          failureNotice.setFailureNotice('Live mode hit a transient render error. Staying in current mode; try again.', 'warning');
          currentMode = previousMode;
          updateModeUI();
          failureNotice.updateEditorNotice();
          return false;
        }

        failureNotice.setFailureNotice(failureNotice.liveModeFailureMessage, 'warning');

        try {
          editor.setMode('source');
          currentMode = 'source';
          updateModeUI();
          failureNotice.updateEditorNotice();
          if (shouldRestoreEditorFocus) {
            editor.focus();
          }
          if (post) {
            vscode.postMessage({ type: 'setMode', mode: 'source' });
          }
          return false;
        } catch (fallbackError) {
          logWebviewRenderError('applyMode.fallbackSource', fallbackError, { requestedMode: mode, reason });
          failureNotice.setFailureNotice(failureNotice.editorUpdateFailureMessage, 'error');
        }
      }

      currentMode = previousMode;
      updateModeUI();
      failureNotice.updateEditorNotice();
      return false;
    }
  }

  if (persist) {
    persistModeState();
  }

  if (post) {
    vscode.postMessage({ type: 'setMode', mode });
  }

  failureNotice.updateEditorNotice();
  return true;
};

const mountInitialEditor = () => {
  if (editor || pendingInitialText === null) {
    return;
  }
  const initialText = pendingInitialText;
  try {
    editor = createEditor({
      parent: editorHost,
      text: initialText,
      initialMode: currentMode,
      initialLineNumbers: lineNumbersVisible,
      initialGitGutter: gitChangesGutterVisible,
      initialVimMode: vimModeEnabled,
      onApplyChanges: queueChanges,
      onOpenLink: (href: string) => {
        vscode.postMessage({ type: 'openLink', href });
      },
      onSelectionChange: (state: any) => selectionMenuController.update(state),
      onRequestGitBlame: requestGitBlameForLine,
      onOpenGitRevisionForLine: openGitRevisionForLine,
      onOpenGitWorktreeForLine: openGitWorktreeForLine
    });
    gitClient?.applyBaselineToEditor(editor);
    setGitDiffLineHighlightsEnabled(editor, false);
    editor.focus();
    pendingInitialText = null;
    initialMountRecoveryAttempted = false;
    if (currentMode === 'live') {
      failureNotice.clearFailureNotice();
    }
    requestWikiLinkStatuses(initialText);
    if (pendingRevealSelection) {
      applyRevealSelectionFromHost(pendingRevealSelection);
    }
    failureNotice.updateEditorNotice();
    
    setWikiLinkRefreshContext({
      refreshDecorations: () => editor?.refreshDecorations?.()
    });
  } catch (error) {
    logWebviewRenderError('mountInitialEditor', error);

    if (currentMode === 'live') {
      if (!shouldAutoFallbackToSourceForLiveError(error)) {
        if (!initialMountRecoveryAttempted) {
          initialMountRecoveryAttempted = true;
          failureNotice.setFailureNotice('Live mode hit a transient render error while loading. Retrying...', 'warning');
          scheduleInitialEditorMount();
          return;
        }
        failureNotice.setFailureNotice('Live mode hit a transient render error while loading. Try reopening or switching modes.', 'warning');
        return;
      }

      if (!initialMountRecoveryAttempted) {
        initialMountRecoveryAttempted = true;
        failureNotice.setFailureNotice(failureNotice.liveModeFailureMessage, 'warning');
        applyMode('source', { post: true, persist: false, reason: 'render-failure' });
        scheduleInitialEditorMount();
        return;
      }
    }

    failureNotice.setFailureNotice(failureNotice.editorUpdateFailureMessage, 'error');
  }
};

const scheduleInitialEditorMount = () => {
  if (editor || initialEditorMountQueued) {
    return;
  }
  initialEditorMountQueued = true;
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      initialEditorMountQueued = false;
      mountInitialEditor();
      if (outlineController.isVisible()) {
        outlineController.refresh();
      }
      findPanelController.updateFindStatusSummary();
    });
  });
};

const handleInit = (message: any) => {
  if (!editor) {
    pendingInitialText = message.text;
    scheduleInitialEditorMount();
  } else {
    setEditorTextSafely(message.text, 'init');
  }
  if (typeof message.autoSave === 'boolean') {
    autoSaveEnabled = message.autoSave;
    updateAutoSaveUI();
  }
  if (typeof message.lineNumbers === 'boolean') {
    setLineNumbersVisible(message.lineNumbers, { post: false });
  }
  if (typeof message.gitChangesGutter === 'boolean') {
    setGitChangesGutterVisible(message.gitChangesGutter, { post: false });
  }
  if (typeof message.vimMode === 'boolean') {
    setVimModeEnabled(message.vimMode);
  }
  outlineController.setPosition(message.outlinePosition);
  if (editor && outlineController.isVisible()) {
    outlineController.refresh();
  }
  scheduleWikiLinkStatusRefresh(message.text);
  findPanelController.updateFindStatusSummary();
};

const exportHandlerContext: ExportHandlerContext = {
  vscode,
  getEditor: () => editor,
  get pendingText() { return pendingText; },
  get pendingInitialText() { return pendingInitialText; },
  get syncedText() { return syncedText; },
  get pendingDebounce() { return pendingDebounce; },
  get inFlight() { return inFlight; },
  flushChanges,
  normalizeEol,
  setPendingDebounce: (value) => { pendingDebounce = value; }
};

const exportHandler = createExportHandler(exportHandlerContext);

window.addEventListener('message', (event) => {
  const message = event.data;

  if (!message || typeof message !== 'object') {
    return;
  }

  if (message.type === 'init') {
    applyThemeSettings(message.theme);
    initialMountRecoveryAttempted = false;
    failureNotice.clearFailureNotice();
    gitClient?.resetForInit({ hideTooltip: false });
    const nextMode = hasLocalModePreference ? currentMode : message.mode;
    documentVersion = message.version;
    syncedText = normalizeEol(message.text);
    pendingText = null;
    inFlight = false;
    inFlightText = null;
    saveAfterSync = false;

    handleInit(message);
    if (hasLocalModePreference) {
      applyMode(nextMode, {
        post: true,
        persist: true,
        reason: 'init'
      });
    } else {
      applyMode(nextMode, {
        post: false,
        persist: false,
        reason: 'init'
      });
    }
    failureNotice.updateEditorNotice();
    return;
  }

  if (message.type === 'themeChanged') {
    applyThemeSettings(message.theme);
    return;
  }

  if (message.type === 'revealSelection') {
    applyRevealSelectionFromHost(message);
    return;
  }

  if (message.type === 'toggleMode') {
    applyMode(currentMode === 'live' ? 'source' : 'live', { userTriggered: true, reason: 'command' });
    return;
  }

  if (message.type === 'docChanged' && !editor && pendingInitialText !== null) {
    clearGitBlameCache({ hideTooltip: false });
    documentVersion = message.version;
    syncedText = normalizeEol(message.text);
    pendingInitialText = message.text;
    return;
  }

  if (message.type === 'docChanged' && editor) {
    clearGitBlameCache();
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

    if (inFlight && inFlightNormalized === incomingText) {
      syncedText = incomingText;
      inFlight = false;
      inFlightText = null;
      flushChanges();
      maybeSaveAfterSync();
      return;
    }

    if (pendingNormalized === incomingText) {
      syncedText = incomingText;
      pendingText = null;
      inFlight = false;
      inFlightText = null;
      flushChanges();
      maybeSaveAfterSync();
      return;
    }

    syncedText = incomingText;
    pendingText = null;
    inFlight = false;
    inFlightText = null;
    saveAfterSync = false;

    if (pendingDebounce !== null) {
      window.clearTimeout(pendingDebounce);
      pendingDebounce = null;
    }

    if (!setEditorTextSafely(message.text, 'docChanged')) {
      return;
    }
    scheduleWikiLinkStatusRefresh(message.text);
    findPanelController.updateFindStatusSummary();
    return;
  }

  if (message.type === 'applied') {
    documentVersion = message.version;
    if (inFlightText !== null) {
      syncedText = normalizeEol(inFlightText);
    }
    inFlight = false;
    inFlightText = null;
    flushChanges();
    maybeSaveAfterSync();
    if (autoSaveEnabled && !inFlight && pendingText !== null && normalizeEol(pendingText) === syncedText) {
      vscode.postMessage({ type: 'saveDocument' });
    }
    return;
  }

  if (message.type === 'autoSaveChanged') {
    autoSaveEnabled = message.enabled;
    updateAutoSaveUI();
    return;
  }

  if (message.type === 'lineNumbersChanged') {
    setLineNumbersVisible(message.enabled, { post: false });
    return;
  }

  if (message.type === 'gitChangesGutterChanged') {
    setGitChangesGutterVisible(message.enabled, { post: false });
    return;
  }

  if (message.type === 'vimModeChanged') {
    setVimModeEnabled(message.enabled);
    return;
  }

  if (message.type === 'gitBaselineChanged') {
    gitClient?.handleMessage(message, { editor });
    return;
  }

  if (message.type === 'gitBlameResult') {
    gitClient?.handleMessage(message, { editor });
    return;
  }

  if (message.type === 'outlinePositionChanged') {
    outlineController.setPosition(message.position);
    return;
  }

  if (message.type === 'resolvedImageSrc') {
    settleImageSrcRequest(message.requestId, message.resolvedUrl);
    return;
  }

  if (message.type === 'resolvedWikiLinks') {
    if (handleResolvedWikiLinks(message)) {
      editor?.refreshDecorations();
    }
    return;
  }

  if (message.type === 'savedImagePath') {
    handleSavedImagePath(message);
    return;
  }

  if (message.type === 'requestExportSnapshot') {
    if (typeof message.requestId !== 'string' || !message.requestId) {
      return;
    }
    void exportHandler.handleExportSnapshotRequest(message.requestId);
  }
});

window.addEventListener('keydown', (event) => {
  handleEditorShortcut(event, shortcutHandlerContext);
}, { capture: true });

window.addEventListener('paste', async (event) => {
  if (!editor) {
    return;
  }

  const stateAtPaste = editor.view.state;
  const selectionAtPaste = stateAtPaste.selection.main;
  const lineAtPaste = stateAtPaste.doc.lineAt(selectionAtPaste.head);
  const lineNumberAtPaste = lineAtPaste.number;
  const lineOffsetAtPaste = selectionAtPaste.head - lineAtPaste.from;

  await handleImagePaste(event, editor, {
    lineNumber: lineNumberAtPaste,
    lineOffset: lineOffsetAtPaste
  });
});

window.addEventListener('blur', () => {
  flushPendingChangesNow();
});

window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    forceFlushChanges();
  }
});

const forceFlushChanges = () => {
  if (!editor || pendingText === null) {
    return;
  }

  const nextText = pendingText;
  const message: WebviewMessage = {
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

  documentVersion++;
  vscode.postMessage(message);
};

window.addEventListener('beforeunload', () => {
  cancelPendingWikiStatusRefresh();
  clearGitBlameCache({ hideTooltip: false });

  if (pendingDebounce !== null) {
    window.clearTimeout(pendingDebounce);
    pendingDebounce = null;
  }

  forceFlushChanges();
});

window.addEventListener('resize', () => {
  findPanelController.updateAnchor();
  if (editor) {
    editor.refreshSelectionOverlay();
  }
});

const state = vscode.getState() as { mode?: string } | undefined;
if (state && (state.mode === 'live' || state.mode === 'source')) {
  applyMode(state.mode, { post: false, persist: false });
  hasLocalModePreference = true;
} else {
  updateModeUI();
}
outlineController.setPosition('right');
updateLineNumbersUI();
updateGitChangesGutterUI();
updateAutoSaveUI();

liveButton.addEventListener('click', () => {
  applyMode('live', { userTriggered: true });
});

sourceButton.addEventListener('click', () => {
  applyMode('source', { userTriggered: true });
});

const preserveEditorFocusOnModePointerToggle = (event: PointerEvent) => {
  const target = event.target;
  if (!(target instanceof Element) || !target.closest('.mode-button')) {
    return;
  }
  if (!editor || !editor.hasFocus()) {
    modeToggleShouldRestoreEditorFocus = false;
    return;
  }
  modeToggleShouldRestoreEditorFocus = true;
  event.preventDefault();
};

modeGroup.addEventListener('pointerdown', preserveEditorFocusOnModePointerToggle);

const handleFormatAction = (action: string) => {
  if (!editor) return;
  editor.insertFormat(action);
  editor.focus();
};

findPanelElements.findInput.addEventListener('input', () => {
  findPanelController.updateFindStatusSummary();
});

findPanelElements.panel.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !findPanelController.isVisible()) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  findPanelController.close();
});

findPanelElements.findInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    findPanelController.runFind(event.shiftKey, { focusEditor: false });
    return;
  }
});

findPanelElements.replaceInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    findPanelController.runReplace();
    return;
  }
});

findPanelElements.findPrevBtn.addEventListener('click', () => {
  findPanelController.runFind(true);
});

findPanelElements.findNextBtn.addEventListener('click', () => {
  findPanelController.runFind(false);
});

findPanelElements.replaceBtn.addEventListener('click', () => {
  findPanelController.runReplace();
});

findPanelElements.replaceAllBtn.addEventListener('click', () => {
  findPanelController.runReplaceAll();
});

findPanelElements.closeFindBtn.addEventListener('click', () => {
  findPanelController.close();
});

findToggleBtn.addEventListener('click', () => {
  if (findPanelController.isVisible()) {
    findPanelController.close();
    return;
  }
  findPanelController.open('find');
});

selectionMenuElements.menu.addEventListener('pointerdown', (event) => {
  event.preventDefault();
});

selectionMenuElements.menu.addEventListener('click', (event) => {
  const button = (event.target as Element).closest('.selection-inline-button') as HTMLElement | null;
  if (!button) return;
  const { action } = button.dataset;
  if (!action) return;
  selectionMenuController.handleAction(action);
});

headingDropdown.addEventListener('click', (event) => {
  const option = (event.target as Element).closest('.heading-dropdown-option') as HTMLElement | null;
  if (!option || !editor) return;
  const level = parseInt(option.dataset.level ?? '', 10);
  editor.insertFormat('heading', level);
  editor.focus();
});

bulletListBtn.addEventListener('click', () => handleFormatAction('bulletList'));
numberedListBtn.addEventListener('click', () => handleFormatAction('numberedList'));
taskBtn.addEventListener('click', () => handleFormatAction('task'));
codeBlockBtn.addEventListener('click', () => handleFormatAction('codeBlock'));
quoteBtn.addEventListener('click', () => handleFormatAction('quote'));
hrBtn.addEventListener('click', () => handleFormatAction('hr'));
linkBtn.addEventListener('click', () => handleFormatAction('link'));
wikiLinkBtn.addEventListener('click', () => handleFormatAction('wikiLink'));
imageBtn.addEventListener('click', () => handleFormatAction('image'));
autoSaveBtn.addEventListener('click', toggleAutoSave);
exportHtmlOption.addEventListener('click', () => {
  exportHandler.requestExport('html');
});
exportPdfOption.addEventListener('click', () => {
  exportHandler.requestExport('pdf');
});
outlineBtn.addEventListener('click', () => {
  outlineController.toggle();
});
lineNumbersBtn.addEventListener('click', toggleLineNumbers);
gitChangesGutterBtn.addEventListener('click', toggleGitChangesGutter);

persistModeState();
vscode.postMessage({ type: 'setMode', mode: currentMode });
vscode.postMessage({ type: 'ready' });
