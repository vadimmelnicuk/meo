import { createElement, CaseSensitive, ChevronUp, ChevronDown, Replace, ReplaceAll, WholeWord } from 'lucide';

export interface FindPanelElements {
  panel: HTMLDivElement;
  findInput: HTMLInputElement;
  wholeWordBtn: HTMLButtonElement;
  caseSensitiveBtn: HTMLButtonElement;
  replaceInput: HTMLInputElement;
  findStatus: HTMLSpanElement;
  findPrevBtn: HTMLButtonElement;
  findNextBtn: HTMLButtonElement;
  replaceBtn: HTMLButtonElement;
  replaceAllBtn: HTMLButtonElement;
  toggleBtn: HTMLButtonElement;
}

export interface FindPanelContext {
  getEditor: () => any;
  isVisible: () => boolean;
}

export const createFindPanel = (toggleBtn: HTMLButtonElement): FindPanelElements => {
  const panel = document.createElement('div');
  panel.className = 'find-panel';
  panel.setAttribute('role', 'search');
  panel.setAttribute('aria-label', 'Find and replace');

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

  const wholeWordBtn = document.createElement('button');
  wholeWordBtn.type = 'button';
  wholeWordBtn.className = 'format-button toggle-button find-option-button';
  wholeWordBtn.title = 'Whole Word';
  wholeWordBtn.appendChild(createElement(WholeWord, { width: 16, height: 16 }));
  wholeWordBtn.setAttribute('aria-label', 'Whole Word');
  wholeWordBtn.setAttribute('aria-pressed', 'false');

  const caseSensitiveBtn = document.createElement('button');
  caseSensitiveBtn.type = 'button';
  caseSensitiveBtn.className = 'format-button toggle-button find-option-button';
  caseSensitiveBtn.title = 'Case Sensitive';
  caseSensitiveBtn.appendChild(createElement(CaseSensitive, { width: 16, height: 16 }));
  caseSensitiveBtn.setAttribute('aria-label', 'Case Sensitive');
  caseSensitiveBtn.setAttribute('aria-pressed', 'false');

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

  findInputWrap.append(findInput, findStatus);
  findRow.append(findInputWrap, wholeWordBtn, caseSensitiveBtn, findPrevBtn, findNextBtn);

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
  panel.append(findRow, replaceRow);

  return {
    panel,
    findInput,
    wholeWordBtn,
    caseSensitiveBtn,
    replaceInput,
    findStatus,
    findPrevBtn,
    findNextBtn,
    replaceBtn,
    replaceAllBtn,
    toggleBtn
  };
};

export const createFindPanelController = (
  elements: FindPanelElements,
  getEditor: () => any,
  toolbar: HTMLElement,
  modeGroup: HTMLElement
) => {
  let visible = false;

  const isWholeWordEnabled = (): boolean => {
    return elements.wholeWordBtn.classList.contains('is-active');
  };

  const setWholeWordEnabled = (enabled: boolean): void => {
    elements.wholeWordBtn.classList.toggle('is-active', enabled);
    elements.wholeWordBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  };

  const isCaseSensitiveEnabled = (): boolean => {
    return elements.caseSensitiveBtn.classList.contains('is-active');
  };

  const setCaseSensitiveEnabled = (enabled: boolean): void => {
    elements.caseSensitiveBtn.classList.toggle('is-active', enabled);
    elements.caseSensitiveBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  };

  const getSearchOptions = (): { wholeWord: boolean; caseSensitive: boolean } => {
    return {
      wholeWord: isWholeWordEnabled(),
      caseSensitive: isCaseSensitiveEnabled()
    };
  };

  const setSearchOptions = (
    options: { wholeWord?: boolean; caseSensitive?: boolean } = {}
  ): void => {
    setWholeWordEnabled(options.wholeWord === true);
    setCaseSensitiveEnabled(options.caseSensitive === true);
  };

  const setFindStatus = (text: string, isError = false): void => {
    elements.findStatus.textContent = text;
    elements.findStatus.classList.toggle('is-error', isError);
  };

  const updateFindPanelAnchor = (): void => {
    const toolbarRect = toolbar.getBoundingClientRect();
    const modeGroupRect = modeGroup.getBoundingClientRect();
    const rightOffset = Math.max(0, toolbarRect.right - modeGroupRect.right);
    elements.panel.style.right = `${rightOffset}px`;
  };

  const updateFindStatusSummary = (): void => {
    const editor = getEditor();
    if (!editor || !visible) {
      return;
    }

    const query = elements.findInput.value;
    const searchOptions = getSearchOptions();
    editor.setSearchQuery(query, searchOptions);
    if (!query) {
      setFindStatus('');
      return;
    }

    const total = editor.countMatches(query, searchOptions);
    if (!total) {
      setFindStatus('No matches', true);
      return;
    }
    setFindStatus(`${total} matches`);
  };

  const close = (): void => {
    visible = false;
    elements.panel.classList.remove('is-visible');
    elements.toggleBtn.classList.remove('is-active');
    elements.findInput.value = '';
    elements.replaceInput.value = '';
    setFindStatus('');
    const editor = getEditor();
    if (editor) {
      editor.setSearchQuery('', getSearchOptions());
      editor.focus();
    }
  };

  const open = (target: 'find' | 'replace' = 'find'): void => {
    updateFindPanelAnchor();
    visible = true;
    elements.panel.classList.add('is-visible');
    elements.toggleBtn.classList.add('is-active');
    const editor = getEditor();
    if (editor) {
      editor.setSearchQuery(elements.findInput.value, getSearchOptions());
    }
    updateFindStatusSummary();
    const input = target === 'replace' ? elements.replaceInput : elements.findInput;
    input.focus();
    input.select();
  };

  const applyFindResult = (result: { found?: boolean; current?: number; total?: number } | null): boolean => {
    if (!result?.found) {
      setFindStatus('No matches', true);
      return false;
    }
    setFindStatus(`${result.current}/${result.total}`);
    return true;
  };

  const runFind = (backward = false, options: Record<string, unknown> = {}): boolean => {
    const editor = getEditor();
    if (!editor) {
      return false;
    }

    const query = elements.findInput.value;
    if (!query) {
      setFindStatus('Enter text', true);
      return false;
    }

    const searchOptions = { ...options, ...getSearchOptions() };
    const result = backward ? editor.findPrevious(query, searchOptions) : editor.findNext(query, searchOptions);
    return applyFindResult(result);
  };

  const runReplace = (): boolean => {
    const editor = getEditor();
    if (!editor) {
      return false;
    }

    const query = elements.findInput.value;
    if (!query) {
      setFindStatus('Enter text', true);
      return false;
    }

    const result = editor.replaceCurrent(query, elements.replaceInput.value, getSearchOptions());
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

  const runReplaceAll = (): boolean => {
    const editor = getEditor();
    if (!editor) {
      return false;
    }

    const query = elements.findInput.value;
    if (!query) {
      setFindStatus('Enter text', true);
      return false;
    }

    const result = editor.replaceAll(query, elements.replaceInput.value, getSearchOptions());
    if (!result.replaced) {
      setFindStatus('No matches', true);
      return false;
    }

    setFindStatus(`Replaced ${result.replaced} matches`);
    return true;
  };

  const isVisible = () => visible;

  const updateAnchor = () => {
    if (visible) {
      updateFindPanelAnchor();
    }
  };

  const toggleWholeWord = (): void => {
    setWholeWordEnabled(!isWholeWordEnabled());
    if (visible) {
      updateFindStatusSummary();
    }
  };

  const toggleCaseSensitive = (): void => {
    setCaseSensitiveEnabled(!isCaseSensitiveEnabled());
    if (visible) {
      updateFindStatusSummary();
    }
  };

  return {
    open,
    close,
    isVisible,
    getSearchOptions,
    setSearchOptions,
    updateAnchor,
    updateFindStatusSummary,
    toggleWholeWord,
    toggleCaseSensitive,
    runFind,
    runReplace,
    runReplaceAll,
    elements
  };
};

export type FindPanelController = ReturnType<typeof createFindPanelController>;
