import { createElement, Bold, Italic, Strikethrough, Terminal, Link, Brackets } from 'lucide';

export interface SelectionMenuElements {
  menu: HTMLDivElement;
}

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

  menu.append(
    selectionBoldBtn,
    selectionItalicBtn,
    selectionLineoverBtn,
    selectionInlineCodeBtn,
    selectionLinkBtn,
    selectionWikiLinkBtn
  );

  return { menu };
};

export const createSelectionMenuController = (
  elements: SelectionMenuElements,
  getEditor: () => any
) => {
  const hide = (): void => {
    elements.menu.classList.remove('is-visible');
  };

  const update = (selectionState: { visible?: boolean; anchorX?: number; anchorY?: number } | null): void => {
    if (!selectionState?.visible) {
      hide();
      return;
    }

    elements.menu.classList.add('is-visible');
    const margin = 8;
    const halfWidth = elements.menu.offsetWidth / 2;
    const minLeft = halfWidth + margin;
    const maxLeft = window.innerWidth - halfWidth - margin;
    const clampedLeft = Math.min(maxLeft, Math.max(minLeft, selectionState.anchorX ?? 0));
    elements.menu.style.left = `${clampedLeft}px`;
    elements.menu.style.top = `${Math.max(margin, (selectionState.anchorY ?? 0) - margin)}px`;
  };

  const handleAction = (action: string): void => {
    const editor = getEditor();
    if (!editor) return;
    editor.insertFormat(action);
    editor.focus();
  };

  return {
    hide,
    update,
    handleAction,
    elements
  };
};

export type SelectionMenuController = ReturnType<typeof createSelectionMenuController>;
