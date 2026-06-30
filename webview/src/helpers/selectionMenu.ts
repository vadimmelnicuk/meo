import { createElement, Bold, Italic, Strikethrough, Terminal, Link, Brackets, Keyboard } from 'lucide';

export interface SelectionMenuElements {
  menu: HTMLDivElement;
  suggestions: HTMLDivElement;
}

export type DiagnosticSuggestionMenuItem = {
  from: number;
  to: number;
  text: string;
};

export type SelectionMenuState = {
  visible?: boolean;
  anchorX?: number;
  anchorY?: number;
  anchorBottomY?: number;
  align?: 'center' | 'start';
  diagnosticSuggestions?: DiagnosticSuggestionMenuItem[];
};

const createSelectionActionButton = (action: string, label: string, Icon: any): HTMLButtonElement => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'selection-inline-button';
  button.dataset.action = action;
  button.title = label;
  button.setAttribute('aria-label', label);
  button.appendChild(createElement(Icon, { width: 16, height: 16 }));
  return button;
};

export const createSelectionMenu = (): SelectionMenuElements => {
  const menu = document.createElement('div');
  menu.className = 'selection-inline-menu';
  menu.setAttribute('role', 'toolbar');
  menu.setAttribute('aria-label', 'Inline markdown formatting');

  const selectionBoldBtn = createSelectionActionButton('bold', 'Bold', Bold);
  const selectionItalicBtn = createSelectionActionButton('italic', 'Italic', Italic);
  const selectionLineoverBtn = createSelectionActionButton('lineover', 'Lineover', Strikethrough);
  const selectionInlineCodeBtn = createSelectionActionButton('inlineCode', 'Inline Code', Terminal);
  const selectionLinkBtn = createSelectionActionButton('link', 'Link', Link);
  const selectionWikiLinkBtn = createSelectionActionButton('wikiLink', 'Wiki Link', Brackets);
  const selectionKbdBtn = createSelectionActionButton('kbd', 'Kbd', Keyboard);
  const suggestions = document.createElement('div');
  suggestions.className = 'selection-inline-suggestions';
  suggestions.setAttribute('role', 'group');
  suggestions.setAttribute('aria-label', 'Suggested replacements');

  menu.append(
    selectionBoldBtn,
    selectionItalicBtn,
    selectionLineoverBtn,
    selectionInlineCodeBtn,
    selectionLinkBtn,
    selectionWikiLinkBtn,
    selectionKbdBtn,
    suggestions
  );

  return { menu, suggestions };
};

export const createSelectionMenuController = (
  elements: SelectionMenuElements,
  getEditor: () => any
) => {
  let activeSuggestions: DiagnosticSuggestionMenuItem[] = [];

  const renderSuggestions = (suggestions: DiagnosticSuggestionMenuItem[] = []): void => {
    activeSuggestions = suggestions.slice(0, 1);
    elements.suggestions.replaceChildren();
    elements.suggestions.hidden = activeSuggestions.length === 0;

    for (let index = 0; index < activeSuggestions.length; index += 1) {
      const suggestion = activeSuggestions[index];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'selection-inline-suggestion';
      button.dataset.suggestionIndex = String(index);
      button.title = suggestion.text;
      button.textContent = suggestion.text;
      elements.suggestions.appendChild(button);
    }
  };

  const hide = (): void => {
    elements.menu.classList.remove('is-visible');
    elements.menu.classList.remove('is-below');
    renderSuggestions();
  };

  const topToolbarBottom = (): number => {
    const toolbar = document.querySelector('.mode-toolbar');
    if (!(toolbar instanceof HTMLElement)) {
      return 0;
    }

    return toolbar.getBoundingClientRect().bottom;
  };

  const update = (selectionState: SelectionMenuState | null): void => {
    if (!selectionState?.visible) {
      hide();
      return;
    }

    renderSuggestions(selectionState.diagnosticSuggestions ?? []);
    elements.menu.classList.add('is-visible');
    const margin = 8;
    const menuWidth = elements.menu.offsetWidth;
    const anchorX = selectionState.anchorX ?? 0;
    const rawLeft = selectionState.align === 'center' ? anchorX - (menuWidth / 2) : anchorX;
    const maxLeft = Math.max(margin, window.innerWidth - menuWidth - margin);
    const clampedLeft = Math.min(maxLeft, Math.max(margin, rawLeft));
    const menuHeight = elements.menu.offsetHeight;
    const anchorY = selectionState.anchorY ?? margin;
    const anchorBottomY = selectionState.anchorBottomY ?? anchorY;
    const gap = margin;
    const aboveTop = anchorY - gap - menuHeight;
    const shouldPlaceBelow = aboveTop < topToolbarBottom() + gap;
    const rawTop = shouldPlaceBelow ? anchorBottomY + gap : anchorY - gap;
    elements.menu.style.left = `${clampedLeft}px`;
    elements.menu.style.top = `${Math.max(margin, rawTop)}px`;
    elements.menu.classList.toggle('is-below', shouldPlaceBelow);
  };

  const handleAction = (action: string): void => {
    const editor = getEditor();
    if (!editor) return;
    editor.insertFormat(action);
    editor.focus();
  };

  const handleSuggestion = (index: number): void => {
    const editor = getEditor();
    const suggestion = activeSuggestions[index];
    if (!editor || !suggestion) return;
    editor.applyDiagnosticSuggestion(suggestion.from, suggestion.to, suggestion.text);
    hide();
    editor.focus();
  };

  return {
    hide,
    update,
    handleAction,
    handleSuggestion,
    elements
  };
};

export type SelectionMenuController = ReturnType<typeof createSelectionMenuController>;
