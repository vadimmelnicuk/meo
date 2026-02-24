import { createEditor } from './editor';
import { createElement, Heading, Heading1, Heading2, Heading3, Heading4, Heading5, Heading6, List, ListOrdered, ListTodo, Save, ListTree, Hash, Code, Terminal, Quote, Minus, Table2, Link, Brackets, Image, Bold, Italic, Strikethrough, Search, ChevronUp, ChevronDown, Replace, ReplaceAll, Share, GitCompare, X } from 'lucide';
import { setImageSrcResolver } from './helpers/images';
import { createGitClient } from './helpers/gitClient';
import { createOutlineController } from './helpers/outline';
import { normalizeWikiTarget, replaceWikiLinkStatuses } from './helpers/wikiLinks';
import { defaultThemeColors, defaultThemeFonts, maxThemeLineHeight, minThemeLineHeight, themeColorKeys } from '../../src/shared/themeDefaults';

const vscode = acquireVsCodeApi();
const imageSrcCache = new Map();
const pendingImageResolvers = new Map();
const imageRequestById = new Map();
let imageRequestCounter = 0;
let wikiLinkRequestCounter = 0;
let latestWikiLinkRequestId = '';
let pendingWikiStatusRefresh = null;
const wikiStatusDebounceMs = 1000;
const vscodeEditorFontFamily = 'var(--vscode-editor-font-family)';
const liveModeFailureNoticeMessage = 'Live mode failed to render this document. Switched to Source mode.';
const editorUpdateFailureNoticeMessage = 'Editor failed to update this document. Try reopening the file.';

const normalizeThemeLineHeight = (value, fallback) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(maxThemeLineHeight, Math.max(minThemeLineHeight, value));
};

const applyThemeSettings = (theme) => {
  const rootStyle = document.documentElement.style;
  const colors = theme?.colors ?? {};

  for (const key of themeColorKeys) {
    const fallback = defaultThemeColors[key];
    const value = typeof colors[key] === 'string' ? colors[key].trim() : '';
    rootStyle.setProperty(`--meo-color-${key}`, value || fallback);
  }

  const fonts = theme?.fonts ?? {};
  const liveFont = typeof fonts.live === 'string' ? fonts.live.trim() : '';
  const sourceFont = typeof fonts.source === 'string' ? fonts.source.trim() : '';
  const liveLineHeight = normalizeThemeLineHeight(fonts.liveLineHeight, defaultThemeFonts.liveLineHeight);
  const sourceLineHeight = normalizeThemeLineHeight(fonts.sourceLineHeight, defaultThemeFonts.sourceLineHeight);
  rootStyle.setProperty('--meo-font-live', liveFont || vscodeEditorFontFamily);
  rootStyle.setProperty('--meo-font-source', sourceFont || vscodeEditorFontFamily);
  rootStyle.setProperty('--meo-line-height-live', `${liveLineHeight}`);
  rootStyle.setProperty('--meo-line-height-source', `${sourceLineHeight}`);
};
applyThemeSettings();

const isImmediateImageSrc = (url) => /^(?:https?:|data:|blob:|vscode-webview-resource:|vscode-resource:)/i.test(url);

const requestImageSrcResolution = (url) => new Promise((resolve) => {
  const waiting = pendingImageResolvers.get(url);
  if (waiting) {
    waiting.push(resolve);
    return;
  }

  pendingImageResolvers.set(url, [resolve]);
  const requestId = `img-${imageRequestCounter++}`;
  imageRequestById.set(requestId, url);
  vscode.postMessage({ type: 'resolveImageSrc', requestId, url });
});

const settleImageSrcRequest = (requestId, resolvedUrl) => {
  const rawUrl = imageRequestById.get(requestId);
  if (typeof rawUrl !== 'string') {
    return;
  }

  imageRequestById.delete(requestId);
  const finalUrl = resolvedUrl || rawUrl;
  imageSrcCache.set(rawUrl, finalUrl);
  const waiters = pendingImageResolvers.get(rawUrl) ?? [];
  pendingImageResolvers.delete(rawUrl);
  for (const resolve of waiters) {
    resolve(finalUrl);
  }
};

const resolveImageSrc = (rawUrl) => {
  const url = (rawUrl ?? '').trim();
  if (!url || isImmediateImageSrc(url)) {
    return url;
  }
  const cached = imageSrcCache.get(url);
  if (typeof cached === 'string') {
    return cached;
  }
  return requestImageSrcResolution(url);
};

setImageSrcResolver(resolveImageSrc);

const isEscapedAt = (text, index) => {
  let slashCount = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
};

const collectWikiLinkTargets = (text) => {
  const targets = new Set();
  for (let i = 0; i < text.length - 1; i += 1) {
    if (text[i] !== '[' || text[i + 1] !== '[') {
      continue;
    }
    if ((i > 0 && text[i - 1] === '!') || isEscapedAt(text, i)) {
      continue;
    }

    const close = text.indexOf(']]', i + 2);
    if (close < 0) {
      break;
    }
    const content = text.slice(i + 2, close);
    const pipeIndex = content.indexOf('|');
    const targetRaw = (pipeIndex >= 0 ? content.slice(0, pipeIndex) : content).trim();
    const target = normalizeWikiTarget(targetRaw);
    if (target) {
      targets.add(target);
    }
    i = close + 1;
  }
  return Array.from(targets);
};

const requestWikiLinkStatuses = (text) => {
  const targets = collectWikiLinkTargets(text);
  if (!targets.length) {
    replaceWikiLinkStatuses([]);
    editor?.refreshDecorations();
    return;
  }

  const requestId = `wiki-${wikiLinkRequestCounter++}`;
  latestWikiLinkRequestId = requestId;
  vscode.postMessage({ type: 'resolveWikiLinks', requestId, targets });
};

const scheduleWikiLinkStatusRefresh = (text) => {
  if (pendingWikiStatusRefresh !== null) {
    window.clearTimeout(pendingWikiStatusRefresh);
  }
  pendingWikiStatusRefresh = window.setTimeout(() => {
    pendingWikiStatusRefresh = null;
    requestWikiLinkStatuses(text);
  }, wikiStatusDebounceMs);
};

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

const persistModeState = () => {
  vscode.setState({ mode: currentMode });
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
    vscode.postMessage({ type: 'setLineNumbers', enabled: lineNumbersVisible });
  }
};

const setGitChangesGutterVisible = (visible, { post = true } = {}) => {
  const nextVisible = visible !== false;
  const changed = nextVisible !== gitChangesGutterVisible;
  if (changed) {
    gitChangesGutterVisible = nextVisible;
    editor?.setGitGutterVisible(gitChangesGutterVisible);
  }
  updateGitChangesGutterUI();
  if (post && changed) {
    vscode.postMessage({ type: 'setGitChangesGutter', enabled: gitChangesGutterVisible });
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
    cell.dataset.row = row + 1;
    cell.dataset.col = col + 1;
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

const updateTableGridHighlight = (hoveredCol, hoveredRow) => {
  const cells = tableGrid.querySelectorAll('.table-grid-cell');
  cells.forEach((cell) => {
    const cellCol = parseInt(cell.dataset.col, 10);
    const cellRow = parseInt(cell.dataset.row, 10);
    cell.classList.toggle('is-highlighted', cellCol <= hoveredCol && cellRow <= hoveredRow);
  });
  tableSizeLabel.textContent = `${hoveredCol} x ${hoveredRow}`;
  selectedTableCols = hoveredCol;
  selectedTableRows = hoveredRow;
};

tableGrid.addEventListener('mouseover', (event) => {
  const cell = event.target.closest('.table-grid-cell');
  if (!cell) return;
  const col = parseInt(cell.dataset.col, 10);
  const row = parseInt(cell.dataset.row, 10);
  updateTableGridHighlight(col, row);
});

tableGrid.addEventListener('mouseleave', () => {
  updateTableGridHighlight(1, 1);
});

tableGrid.addEventListener('click', (event) => {
  const cell = event.target.closest('.table-grid-cell');
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

const requestExport = (format) => {
  if (format !== 'html' && format !== 'pdf') {
    return;
  }
  vscode.postMessage({ type: 'exportDocument', format });
};

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

const findPanel = document.createElement('div');
findPanel.className = 'find-panel';
findPanel.setAttribute('role', 'search');
findPanel.setAttribute('aria-label', 'Find and replace');

const findRow = document.createElement('div');
findRow.className = 'find-row';

const findInputWrap = document.createElement('div');
findInputWrap.className = 'find-input-wrap';

const findInput = document.createElement('input');
findInput.type = 'text';
findInput.className = 'find-input';
findInput.placeholder = 'Find';
findInput.setAttribute('aria-label', 'Find');

const findStatus = document.createElement('span');
findStatus.className = 'find-status';

const findPrevBtn = document.createElement('button');
findPrevBtn.type = 'button';
findPrevBtn.className = 'format-button';
findPrevBtn.title = 'Previous Match';
findPrevBtn.appendChild(createElement(ChevronUp, { width: 16, height: 16 }));

const findNextBtn = document.createElement('button');
findNextBtn.type = 'button';
findNextBtn.className = 'format-button';
findNextBtn.title = 'Next Match';
findNextBtn.appendChild(createElement(ChevronDown, { width: 16, height: 16 }));

const closeFindBtn = document.createElement('button');
closeFindBtn.type = 'button';
closeFindBtn.className = 'format-button';
closeFindBtn.title = 'Close Find';
closeFindBtn.appendChild(createElement(X, { width: 16, height: 16 }));

findInputWrap.append(findInput, findStatus);
findRow.append(findInputWrap, findPrevBtn, findNextBtn, closeFindBtn);

const replaceRow = document.createElement('div');
replaceRow.className = 'find-row';

const replaceInput = document.createElement('input');
replaceInput.type = 'text';
replaceInput.className = 'find-input';
replaceInput.placeholder = 'Replace';
replaceInput.setAttribute('aria-label', 'Replace');

const replaceBtn = document.createElement('button');
replaceBtn.type = 'button';
replaceBtn.className = 'format-button';
replaceBtn.title = 'Replace Current Match';
replaceBtn.appendChild(createElement(Replace, { width: 16, height: 16 }));

const replaceAllBtn = document.createElement('button');
replaceAllBtn.type = 'button';
replaceAllBtn.className = 'format-button';
replaceAllBtn.title = 'Replace All Matches';
replaceAllBtn.appendChild(createElement(ReplaceAll, { width: 16, height: 16 }));

replaceRow.append(replaceInput, replaceBtn, replaceAllBtn);
findPanel.append(findRow, replaceRow);
toolbar.append(formatGroup, rightGroup, modeGroup, findPanel);

const editorHost = document.createElement('div');
editorHost.className = 'editor-host';

const editorWrapper = document.createElement('div');
editorWrapper.className = 'editor-wrapper';

const selectionMenu = document.createElement('div');
selectionMenu.className = 'selection-inline-menu';
selectionMenu.setAttribute('role', 'toolbar');
selectionMenu.setAttribute('aria-label', 'Inline markdown formatting');

const createSelectionActionButton = (action, label, Icon) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'selection-inline-button';
  button.dataset.action = action;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.appendChild(createElement(Icon, { width: 16, height: 16 }));
  return button;
};

const selectionBoldBtn = createSelectionActionButton('bold', 'Bold', Bold);
const selectionItalicBtn = createSelectionActionButton('italic', 'Italic', Italic);
const selectionLineoverBtn = createSelectionActionButton('lineover', 'Lineover', Strikethrough);
const selectionInlineCodeBtn = createSelectionActionButton('inlineCode', 'Inline Code', Terminal);
const selectionLinkBtn = createSelectionActionButton('link', 'Link', Link);
const selectionWikiLinkBtn = createSelectionActionButton('wikiLink', 'Wiki Link', Brackets);

selectionMenu.append(
  selectionBoldBtn,
  selectionItalicBtn,
  selectionLineoverBtn,
  selectionInlineCodeBtn,
  selectionLinkBtn,
  selectionWikiLinkBtn
);

let editor = null;
const outlineController = createOutlineController({
  root,
  editorWrapper,
  outlineButton: outlineBtn,
  getEditor: () => editor
});

editorWrapper.append(editorHost, outlineController.sidebar, selectionMenu);
root.replaceChildren(toolbar);
window.requestAnimationFrame(() => {
  if (!root.contains(editorWrapper)) {
    root.append(editorWrapper);
  }
});

let documentVersion = 0;
let pendingDebounce = null;
let pendingText = null;
let syncedText = '';
let inFlight = false;
let inFlightText = null;
let saveAfterSync = false;
let currentMode = 'live';
let hasLocalModePreference = false;
let findPanelVisible = false;
let pendingInitialText = null;
let initialEditorMountQueued = false;
let initialMountRecoveryAttempted = false;
let editorFailureNoticeMessage = '';
let editorFailureNoticeKind = 'error';
let modeToggleShouldRestoreEditorFocus = false;
let gitClient = null;

const clearGitBlameCache = ({ hideTooltip = true } = {}) => {
  gitClient?.clearBlameCache({ hideTooltip });
};

const bumpLocalEditGeneration = () => {
  gitClient?.bumpLocalEditGeneration();
};

const hideSelectionMenu = () => {
  selectionMenu.classList.remove('is-visible');
};

const setEditorNotice = (_message, _kind = 'info') => {};

const clearEditorNotice = () => {};

const updateEditorNotice = () => {
  if (editorFailureNoticeMessage) {
    setEditorNotice(editorFailureNoticeMessage, editorFailureNoticeKind);
    return;
  }

  clearEditorNotice();
};

const setFailureNotice = (message, kind = 'error') => {
  editorFailureNoticeMessage = message;
  editorFailureNoticeKind = kind;
  updateEditorNotice();
};

const clearFailureNotice = () => {
  if (!editorFailureNoticeMessage) {
    return;
  }
  editorFailureNoticeMessage = '';
  editorFailureNoticeKind = 'error';
  updateEditorNotice();
};

const getErrorMessage = (error) => {
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error.message === 'string') {
    return error.message;
  }
  return '';
};

const isTransientMermaidRuntimeError = (error) => {
  const message = getErrorMessage(error).toLowerCase();
  if (!message) {
    return false;
  }
  if (!message.includes('mermaid')) {
    return false;
  }
  return (
    message.includes('runtime') ||
    message.includes('failed to load') ||
    message.includes('missing') ||
    message.includes('unavailable') ||
    message.includes('script')
  );
};

const shouldAutoFallbackToSourceForLiveError = (error) => !isTransientMermaidRuntimeError(error);

const logWebviewRenderError = (context, error, extra = {}) => {
  console.error('[MEO webview] render error', {
    context,
    mode: currentMode,
    ...extra,
    error
  });
};

const setFindStatus = (text, isError = false) => {
  findStatus.textContent = text;
  findStatus.classList.toggle('is-error', isError);
};

const updateFindPanelAnchor = () => {
  const toolbarRect = toolbar.getBoundingClientRect();
  const modeGroupRect = modeGroup.getBoundingClientRect();
  const rightOffset = Math.max(0, toolbarRect.right - modeGroupRect.right);
  findPanel.style.right = `${rightOffset}px`;
};

const updateFindStatusSummary = () => {
  if (!editor || !findPanelVisible) {
    return;
  }

  const query = findInput.value;
  editor.setSearchQuery(query);
  if (!query) {
    setFindStatus('');
    return;
  }

  const total = editor.countMatches(query);
  if (!total) {
    setFindStatus('No matches', true);
    return;
  }
  setFindStatus(`${total} matches`);
};

const closeFindPanel = () => {
  findPanelVisible = false;
  findPanel.classList.remove('is-visible');
  findToggleBtn.classList.remove('is-active');
  findInput.value = '';
  replaceInput.value = '';
  setFindStatus('');
  if (editor) {
    editor.setSearchQuery('');
    editor.focus();
  }
};

const openFindPanel = (target = 'find') => {
  updateFindPanelAnchor();
  findPanelVisible = true;
  findPanel.classList.add('is-visible');
  findToggleBtn.classList.add('is-active');
  if (editor) {
    editor.setSearchQuery(findInput.value);
  }
  updateFindStatusSummary();
  const input = target === 'replace' ? replaceInput : findInput;
  input.focus();
  input.select();
};

const applyFindResult = (result) => {
  if (!result?.found) {
    setFindStatus('No matches', true);
    return false;
  }
  setFindStatus(`${result.current}/${result.total}`);
  return true;
};

const runFind = (backward = false, options) => {
  if (!editor) {
    return false;
  }

  const query = findInput.value;
  if (!query) {
    setFindStatus('Enter text', true);
    return false;
  }

  const result = backward ? editor.findPrevious(query, options) : editor.findNext(query, options);
  return applyFindResult(result);
};

const runReplace = () => {
  if (!editor) {
    return false;
  }

  const query = findInput.value;
  if (!query) {
    setFindStatus('Enter text', true);
    return false;
  }

  const result = editor.replaceCurrent(query, replaceInput.value);
  if (!result.replaced) {
    return applyFindResult(result);
  }

  if (result.found) {
    setFindStatus(`Replaced • ${result.current}/${result.total}`);
    return true;
  }

  setFindStatus(result.total ? `Replaced • ${result.total} remaining` : 'Replaced');
  return true;
};

const runReplaceAll = () => {
  if (!editor) {
    return false;
  }

  const query = findInput.value;
  if (!query) {
    setFindStatus('Enter text', true);
    return false;
  }

  const result = editor.replaceAll(query, replaceInput.value);
  if (!result.replaced) {
    setFindStatus('No matches', true);
    return false;
  }

  setFindStatus(`Replaced ${result.replaced} matches`);
  return true;
};

const updateSelectionMenu = (selectionState) => {
  if (!selectionState?.visible) {
    hideSelectionMenu();
    return;
  }

  selectionMenu.classList.add('is-visible');
  const margin = 8;
  const halfWidth = selectionMenu.offsetWidth / 2;
  const minLeft = halfWidth + margin;
  const maxLeft = window.innerWidth - halfWidth - margin;
  const clampedLeft = Math.min(maxLeft, Math.max(minLeft, selectionState.anchorX));
  selectionMenu.style.left = `${clampedLeft}px`;
  selectionMenu.style.top = `${Math.max(margin, selectionState.anchorY - margin)}px`;
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

const applyMode = (mode, { post = true, persist = true, userTriggered = false, reason = 'user' } = {}) => {
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
        clearFailureNotice();
      }
    } catch (error) {
      logWebviewRenderError('applyMode', error, { requestedMode: mode, reason });

      if (mode === 'live') {
        if (!shouldAutoFallbackToSourceForLiveError(error)) {
          setFailureNotice('Live mode hit a transient render error. Staying in current mode; try again.', 'warning');
          currentMode = previousMode;
          updateModeUI();
          updateEditorNotice();
          return false;
        }

        setFailureNotice(liveModeFailureNoticeMessage, 'warning');

        try {
          editor.setMode('source');
          currentMode = 'source';
          updateModeUI();
          updateEditorNotice();
          if (shouldRestoreEditorFocus) {
            editor.focus();
          }
          if (post) {
            vscode.postMessage({ type: 'setMode', mode: 'source' });
          }
          return false;
        } catch (fallbackError) {
          logWebviewRenderError('applyMode.fallbackSource', fallbackError, { requestedMode: mode, reason });
          setFailureNotice(editorUpdateFailureNoticeMessage, 'error');
        }
      }

      currentMode = previousMode;
      updateModeUI();
      updateEditorNotice();
      return false;
    }
  }

  if (persist) {
    persistModeState();
  }

  if (post) {
    vscode.postMessage({ type: 'setMode', mode });
  }

  updateEditorNotice();
  return true;
};

const setEditorTextSafely = (text, context) => {
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
        clearFailureNotice();
        return true;
      } catch (retryInLiveError) {
        logWebviewRenderError('setText.retryInLive', retryInLiveError, { context });
        if (!shouldAutoFallbackToSourceForLiveError(retryInLiveError)) {
          setFailureNotice('Live mode hit a transient render error while updating. Try again.', 'warning');
          return false;
        }
      }

      setFailureNotice(liveModeFailureNoticeMessage, 'warning');
      applyMode('source', { post: true, persist: false, reason: 'render-failure' });
      if (!editor) {
        return false;
      }
      try {
        editor.setText(text);
        return true;
      } catch (retryError) {
        logWebviewRenderError('setText.retryInSource', retryError, { context });
        setFailureNotice(editorUpdateFailureNoticeMessage, 'error');
        return false;
      }
    }

    setFailureNotice(editorUpdateFailureNoticeMessage, 'error');
    return false;
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

  if (pendingText !== null && pendingText !== syncedText) {
    flushChanges();
    return;
  }

  saveAfterSync = false;
  vscode.postMessage({ type: 'saveDocument' });
};

const requestSave = () => {
  saveAfterSync = true;
  flushPendingChangesNow();
  maybeSaveAfterSync();
};

const delay = (ms) => new Promise((resolve) => {
  window.setTimeout(resolve, ms);
});

const getCurrentExportText = () => {
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

const getExportStyleEnvironment = () => {
  const rootStyles = getComputedStyle(document.documentElement);
  const bodyStyles = getComputedStyle(document.body);
  const editorEl = document.querySelector('.cm-editor');
  const editorStyles = editorEl ? getComputedStyle(editorEl) : null;

  const colorVar = (name, fallback = '') => {
    const value = rootStyles.getPropertyValue(name).trim();
    return value || fallback;
  };

  const fontSizeRaw = (editorStyles?.fontSize || bodyStyles.fontSize || '').trim();
  const parsedFontSize = Number.parseFloat(fontSizeRaw);
  const lineHeightLiveRaw = rootStyles.getPropertyValue('--meo-line-height-live').trim();
  const lineHeightSourceRaw = rootStyles.getPropertyValue('--meo-line-height-source').trim();
  const parsedLiveLineHeight = Number.parseFloat(lineHeightLiveRaw);
  const parsedSourceLineHeight = Number.parseFloat(lineHeightSourceRaw);
  const meoThemeColors = {};
  for (const key of themeColorKeys) {
    const value = rootStyles.getPropertyValue(`--meo-color-${key}`).trim();
    if (value) {
      meoThemeColors[key] = value;
    }
  }

  return {
    editorBackgroundColor: colorVar('--vscode-editor-background', bodyStyles.backgroundColor || ''),
    editorForegroundColor: colorVar('--vscode-editor-foreground', bodyStyles.color || ''),
    codeBlockBackgroundColor: colorVar('--vscode-textCodeBlock-background', ''),
    sideBarBackgroundColor: colorVar('--vscode-sideBar-background', ''),
    panelBorderColor: colorVar('--vscode-panel-border', ''),
    editorFontFamily: (editorStyles?.fontFamily || bodyStyles.fontFamily || '').trim(),
    editorFontSizePx: Number.isFinite(parsedFontSize) ? parsedFontSize : undefined,
    liveFontFamily: colorVar('--meo-font-live', ''),
    sourceFontFamily: colorVar('--meo-font-source', ''),
    liveLineHeight: Number.isFinite(parsedLiveLineHeight) ? parsedLiveLineHeight : undefined,
    sourceLineHeight: Number.isFinite(parsedSourceLineHeight) ? parsedSourceLineHeight : undefined,
    meoThemeColors
  };
};

const waitForExportSyncIdle = async (timeoutMs = 15000) => {
  const startedAt = Date.now();

  while (true) {
    if (!inFlight && pendingText !== null && pendingText !== syncedText) {
      flushChanges();
    }

    if (!inFlight && (pendingText === null || pendingText === syncedText)) {
      return;
    }

    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error('Timed out waiting for editor sync before export');
    }

    await delay(25);
  }
};

const handleExportSnapshotRequest = async (requestId) => {
  try {
    if (pendingDebounce !== null) {
      window.clearTimeout(pendingDebounce);
      pendingDebounce = null;
    }

    flushChanges();
    await waitForExportSyncIdle();

    vscode.postMessage({
      type: 'exportSnapshot',
      requestId,
      text: getCurrentExportText(),
      environment: getExportStyleEnvironment()
    });
  } catch (error) {
    vscode.postMessage({
      type: 'exportSnapshotError',
      requestId,
      message: error instanceof Error ? error.message : 'Failed to collect export snapshot'
    });
  }
};

const isPrimaryModifier = (event) => {
  return event.metaKey !== event.ctrlKey && (event.metaKey || event.ctrlKey);
};

const isShortcutKey = (event, key, code) => {
  return event.key.toLowerCase() === key || event.code === code;
};

const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);

const normalizeEol = (text) => text.replace(/\r\n?/g, '\n');

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

gitClient = createGitClient({
  vscode,
  getCurrentEditorText: () => getCurrentEditorText(),
  getSyncedText: () => syncedText,
  clearTransientUi: () => editor?.clearGitUiTransientState?.()
});

const requestGitBlameForLine = ({ lineNumber }) => {
  if (!gitClient) {
    return Promise.resolve({ kind: 'unavailable', reason: 'error' });
  }
  return gitClient.requestBlameForLine({ lineNumber });
};

const openGitRevisionForLine = ({ lineNumber }) => {
  gitClient?.openRevisionForLine({ lineNumber });
};

const openGitWorktreeForLine = ({ lineNumber }) => {
  gitClient?.openWorktreeForLine({ lineNumber });
};

const handleEditorShortcut = (event) => {
  if (!editor || event.isComposing) {
    return false;
  }
  const hasPrimaryModifier = isPrimaryModifier(event);
  const editorFocused = editor.hasFocus();
  const vimSourceFocused = vimModeEnabled && currentMode === 'source' && editorFocused;
  const vimWinsCtrlConflicts = vimSourceFocused && !isMac;
  const isPlainAltShiftChord =
    event.altKey &&
    event.shiftKey &&
    !event.metaKey &&
    !event.ctrlKey;
  const isModeToggleShortcut = isPlainAltShiftChord && isShortcutKey(event, 'm', 'KeyM');

  if (isModeToggleShortcut) {
    event.preventDefault();
    event.stopPropagation();
    applyMode(currentMode === 'live' ? 'source' : 'live', { userTriggered: true, reason: 'shortcut' });
    return true;
  }

  // Let VS Code host keybindings (including user remaps) win over Vim for common non-Ctrl chords.
  // We can't introspect arbitrary user keybindings from the webview, so preserve these classes of
  // shortcuts by stopping propagation before CodeMirror/Vim sees them.
  if (
    vimSourceFocused &&
    (
      isPlainAltShiftChord ||
      (isMac && event.metaKey && !event.ctrlKey)
    )
  ) {
    event.stopPropagation();
    return false;
  }

  if (hasPrimaryModifier && isShortcutKey(event, 's', 'KeyS') && !event.altKey) {
    event.preventDefault();
    event.stopPropagation();
    requestSave();
    return true;
  }

  if (hasPrimaryModifier && isShortcutKey(event, 'f', 'KeyF') && !event.altKey) {
    if (vimWinsCtrlConflicts) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    openFindPanel('find');
    return true;
  }

  if (
    hasPrimaryModifier &&
    (
      (isMac && isShortcutKey(event, 'f', 'KeyF') && event.altKey) ||
      (!isMac && isShortcutKey(event, 'h', 'KeyH') && !event.altKey)
    )
  ) {
    if (vimWinsCtrlConflicts) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    openFindPanel('replace');
    return true;
  }

  if (!editorFocused) {
    return false;
  }

  if (!hasPrimaryModifier) {
    return false;
  }

  if (isShortcutKey(event, 'a', 'KeyA') && !event.altKey) {
    if (vimWinsCtrlConflicts) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    editor.selectAll();
    return true;
  }

  if (isShortcutKey(event, 'z', 'KeyZ') && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    event.stopPropagation();
    editor.undo();
    return true;
  }

  const redoByShiftZ = isShortcutKey(event, 'z', 'KeyZ') && event.shiftKey;
  const redoByY = isShortcutKey(event, 'y', 'KeyY');
  if ((redoByShiftZ || redoByY) && !event.altKey) {
    if (vimWinsCtrlConflicts && redoByY) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    editor.redo();
    return true;
  }

  const key = typeof event.key === 'string' ? event.key : '';
  const isBareModifier =
    key === 'Meta' ||
    key === 'Control' ||
    key === 'Shift' ||
    key === 'Alt';
  const isClipboardShortcut =
    !event.altKey &&
    (isShortcutKey(event, 'c', 'KeyC') ||
      isShortcutKey(event, 'x', 'KeyX') ||
      isShortcutKey(event, 'v', 'KeyV'));
  if (!isBareModifier && !isClipboardShortcut && pendingText !== null && pendingText !== syncedText) {
    // Let native clipboard copy/cut/paste complete first. Flushing on Cmd/Ctrl+V can race
    // CodeMirror/browser paste handling in the webview, especially in source mode.
    // Keep the host editor/extension shortcut working, but flush our debounce first.
    flushPendingChangesNow();
  }

  return false;
};

const queueChanges = (nextText) => {
  bumpLocalEditGeneration();
  pendingText = nextText;

  if (pendingDebounce !== null) {
    window.clearTimeout(pendingDebounce);
  }

  pendingDebounce = window.setTimeout(() => {
    pendingDebounce = null;
    flushChanges();
  }, 1000);

  if (outlineController.isVisible()) {
    outlineController.refresh();
  }
  scheduleWikiLinkStatusRefresh(nextText);
  updateFindStatusSummary();
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
      onOpenLink: (href) => {
        vscode.postMessage({ type: 'openLink', href });
      },
      onSelectionChange: updateSelectionMenu,
      onRequestGitBlame: requestGitBlameForLine,
      onOpenGitRevisionForLine: openGitRevisionForLine,
      onOpenGitWorktreeForLine: openGitWorktreeForLine
    });
    gitClient?.applyBaselineToEditor(editor);
    editor.focus();
    pendingInitialText = null;
    initialMountRecoveryAttempted = false;
    if (currentMode === 'live') {
      clearFailureNotice();
    }
    requestWikiLinkStatuses(initialText);
    updateEditorNotice();
  } catch (error) {
    logWebviewRenderError('mountInitialEditor', error);

    if (currentMode === 'live') {
      if (!shouldAutoFallbackToSourceForLiveError(error)) {
        if (!initialMountRecoveryAttempted) {
          initialMountRecoveryAttempted = true;
          setFailureNotice('Live mode hit a transient render error while loading. Retrying...', 'warning');
          scheduleInitialEditorMount();
          return;
        }
        setFailureNotice('Live mode hit a transient render error while loading. Try reopening or switching modes.', 'warning');
        return;
      }

      if (!initialMountRecoveryAttempted) {
        initialMountRecoveryAttempted = true;
        setFailureNotice(liveModeFailureNoticeMessage, 'warning');
        applyMode('source', { post: true, persist: false, reason: 'render-failure' });
        scheduleInitialEditorMount();
        return;
      }
    }

    setFailureNotice(editorUpdateFailureNoticeMessage, 'error');
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
      updateFindStatusSummary();
    });
  });
};

const handleInit = (message) => {
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
  updateFindStatusSummary();
};

window.addEventListener('message', (event) => {
  const message = event.data;

  if (!message || typeof message !== 'object') {
    return;
  }

  if (message.type === 'init') {
    applyThemeSettings(message.theme);
    initialMountRecoveryAttempted = false;
    clearFailureNotice();
    gitClient?.resetForInit({ hideTooltip: false });
    const nextMode = hasLocalModePreference ? currentMode : message.mode;
    documentVersion = message.version;
    syncedText = message.text;
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
    updateEditorNotice();
    return;
  }

  if (message.type === 'themeChanged') {
    applyThemeSettings(message.theme);
    return;
  }

  if (message.type === 'toggleMode') {
    applyMode(currentMode === 'live' ? 'source' : 'live', { userTriggered: true, reason: 'command' });
    return;
  }

  if (message.type === 'docChanged' && !editor && pendingInitialText !== null) {
    clearGitBlameCache({ hideTooltip: false });
    documentVersion = message.version;
    syncedText = message.text;
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

    if (!setEditorTextSafely(message.text, 'docChanged')) {
      return;
    }
    scheduleWikiLinkStatusRefresh(message.text);
    updateFindStatusSummary();
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
    if (message.requestId !== latestWikiLinkRequestId) {
      return;
    }
    replaceWikiLinkStatuses(message.results ?? []);
    editor?.refreshDecorations();
    return;
  }

  if (message.type === 'requestExportSnapshot') {
    if (typeof message.requestId !== 'string' || !message.requestId) {
      return;
    }
    void handleExportSnapshotRequest(message.requestId);
  }
});

window.addEventListener('keydown', (event) => {
  handleEditorShortcut(event);
}, { capture: true });

window.addEventListener('blur', () => {
  flushPendingChangesNow();
});

window.addEventListener('beforeunload', () => {
  if (pendingWikiStatusRefresh !== null) {
    window.clearTimeout(pendingWikiStatusRefresh);
    pendingWikiStatusRefresh = null;
  }
  clearGitBlameCache({ hideTooltip: false });
  flushPendingChangesNow();
});

window.addEventListener('resize', () => {
  if (findPanelVisible) {
    updateFindPanelAnchor();
  }
  if (editor) {
    editor.refreshSelectionOverlay();
  }
});

const state = vscode.getState();
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

const preserveEditorFocusOnModePointerToggle = (event) => {
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

const handleFormatAction = (action) => {
  if (!editor) return;
  editor.insertFormat(action);
  editor.focus();
};

findInput.addEventListener('input', () => {
  updateFindStatusSummary();
});

findPanel.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !findPanelVisible) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  closeFindPanel();
});

findInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    runFind(event.shiftKey, { focusEditor: false });
    return;
  }
});

replaceInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    runReplace();
    return;
  }
});

findPrevBtn.addEventListener('click', () => {
  runFind(true);
});

findNextBtn.addEventListener('click', () => {
  runFind(false);
});

replaceBtn.addEventListener('click', () => {
  runReplace();
});

replaceAllBtn.addEventListener('click', () => {
  runReplaceAll();
});

closeFindBtn.addEventListener('click', () => {
  closeFindPanel();
});

findToggleBtn.addEventListener('click', () => {
  if (findPanelVisible) {
    closeFindPanel();
    return;
  }
  openFindPanel('find');
});

selectionMenu.addEventListener('pointerdown', (event) => {
  event.preventDefault();
});

selectionMenu.addEventListener('click', (event) => {
  const button = event.target.closest('.selection-inline-button');
  if (!button || !editor) {
    return;
  }
  const { action } = button.dataset;
  if (!action) {
    return;
  }
  editor.insertFormat(action);
  editor.focus();
});

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
quoteBtn.addEventListener('click', () => handleFormatAction('quote'));
hrBtn.addEventListener('click', () => handleFormatAction('hr'));
linkBtn.addEventListener('click', () => handleFormatAction('link'));
wikiLinkBtn.addEventListener('click', () => handleFormatAction('wikiLink'));
imageBtn.addEventListener('click', () => handleFormatAction('image'));
autoSaveBtn.addEventListener('click', toggleAutoSave);
exportHtmlOption.addEventListener('click', () => {
  requestExport('html');
});
exportPdfOption.addEventListener('click', () => {
  requestExport('pdf');
});
outlineBtn.addEventListener('click', () => {
  outlineController.toggle();
});
lineNumbersBtn.addEventListener('click', toggleLineNumbers);
gitChangesGutterBtn.addEventListener('click', toggleGitChangesGutter);

persistModeState();
vscode.postMessage({ type: 'setMode', mode: currentMode });
vscode.postMessage({ type: 'ready' });
