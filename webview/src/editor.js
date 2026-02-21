import { EditorState, Compartment, Transaction, StateEffect, StateField, RangeSetBuilder } from '@codemirror/state';
import { EditorView, keymap, highlightActiveLine, lineNumbers, highlightActiveLineGutter, scrollPastEnd, Decoration } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, indentLess, undo, redo } from '@codemirror/commands';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { indentUnit, syntaxHighlighting, syntaxTree, forceParsing } from '@codemirror/language';
import { highlightStyle } from './theme';
import { liveModeExtensions } from './liveMode';
import { resolveCodeLanguage, insertCodeBlock, sourceCodeBlockField } from './helpers/codeBlocks';
import { sourceStrikeMarkerField } from './helpers/strikeMarkers';
import { sourceWikiMarkerField } from './helpers/wikiLinks';
import { resolvedSyntaxTree, extractHeadings } from './helpers/markdownSyntax';
import {
  sourceListBorderField,
  sourceListMarkerField,
  handleBackspaceAtListContentStart,
  handleEnterAtListContentStart,
  handleEnterContinueList,
  handleEnterBeforeNestedList,
  collectOrderedListRenumberChanges,
  indentListByTwoSpaces,
  outdentListByTwoSpaces
} from './helpers/listMarkers';
import { insertTable, sourceTableHeaderLineField } from './helpers/tables';
import { sourceFrontmatterField } from './helpers/frontmatter';

const setSearchQueryEffect = StateEffect.define();
const refreshDecorationsEffect = StateEffect.define();
const searchMatchMark = Decoration.mark({ class: 'meo-search-match' });

const buildSearchDecorations = (doc, query) => {
  if (!query) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder();
  const textValue = doc.toString();
  let offset = 0;
  while (offset <= textValue.length) {
    const index = textValue.indexOf(query, offset);
    if (index < 0) {
      break;
    }
    builder.add(index, index + query.length, searchMatchMark);
    offset = index + query.length;
  }
  return builder.finish();
};

const searchQueryField = StateField.define({
  create() {
    return '';
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSearchQueryEffect)) {
        return effect.value;
      }
    }
    return value;
  }
});

const searchMatchField = StateField.define({
  create() {
    return Decoration.none;
  },
  update(value, tr) {
    if (tr.docChanged) {
      const query = tr.state.field(searchQueryField);
      return buildSearchDecorations(tr.state.doc, query);
    }

    for (const effect of tr.effects) {
      if (effect.is(setSearchQueryEffect)) {
        return buildSearchDecorations(tr.state.doc, effect.value);
      }
    }

    return value;
  },
  provide(field) {
    return EditorView.decorations.from(field);
  }
});

export function createEditor({
  parent,
  text,
  onApplyChanges,
  onOpenLink,
  onSelectionChange,
  initialMode = 'source',
  initialLineNumbers = true
}) {
  // VS Code webviews can hit cross-origin window access issues in the EditContext path.
  // Disable it explicitly for stability in embedded Chromium.
  EditorView.EDIT_CONTEXT = false;

  const modeCompartment = new Compartment();
  const startMode = initialMode === 'live' ? 'live' : 'source';
  let lineNumbersVisible = initialLineNumbers !== false;
  let applyingExternal = false;
  let capturedPointerId = null;
  let inlineCodeClick = null;
  let checkboxClick = null;
  let view = null;
  let currentMode = startMode;
  let applyingRenumber = false;
  let tableInteractionActive = false;
  let onTableInteraction = null;
  let onScroll = null;
  const targetElementFrom = (target) => (
    target instanceof Element ? target : target instanceof Node ? target.parentElement : null
  );
  const isPrimaryModifierClick = (event) => (
    !event.altKey && !event.shiftKey && event.metaKey !== event.ctrlKey && (event.metaKey || event.ctrlKey)
  );
  const openLinkIfModifierClick = (event) => {
    if (currentMode !== 'live' || !isPrimaryModifierClick(event)) {
      return false;
    }
    const targetElement = targetElementFrom(event.target);
    if (!targetElement) {
      return false;
    }
    const linkElement = targetElement.closest('[data-meo-link-href]');
    if (!(linkElement instanceof Element)) {
      return false;
    }
    const href = linkElement.getAttribute('data-meo-link-href');
    if (!href) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    onOpenLink?.(href);
    return true;
  };

  const setTableInteractionActive = (active) => {
    if (!view || tableInteractionActive === active) {
      return;
    }
    tableInteractionActive = active;
    view.dom.classList.toggle('meo-table-interaction-active', active);
  };

  const syncModeClasses = () => {
    if (!view) {
      return;
    }
    view.dom.classList.toggle('meo-mode-live', currentMode === 'live');
    view.dom.classList.toggle('meo-mode-source', currentMode !== 'live');
  };

  const syncLineNumbersVisibility = () => {
    if (!view) {
      return;
    }
    view.dom.classList.toggle('meo-line-numbers-hidden', !lineNumbersVisible);
  };

  const releasePointerCaptureIfHeld = (pointerId) => {
    if (!view || pointerId === null) {
      return;
    }
    if (view.dom.releasePointerCapture && view.dom.hasPointerCapture(pointerId)) {
      view.dom.releasePointerCapture(pointerId);
    }
  };

  const syncSelectionClass = () => {
    if (!view) {
      return;
    }
    const hasSelection = view.state.selection.ranges.some((range) => !range.empty);
    view.dom.classList.toggle('has-selection', hasSelection);
  };

  const emitSelectionChange = () => {
    if (!view || typeof onSelectionChange !== 'function') {
      return;
    }

    const selection = view.state.selection.main;
    if (selection.empty) {
      onSelectionChange({ visible: false });
      return;
    }

    const from = Math.min(selection.from, selection.to);
    const to = Math.max(selection.from, selection.to);
    if (!isRegularInlineSelection(view.state, from, to)) {
      onSelectionChange({ visible: false });
      return;
    }

    const fromCoords = view.coordsAtPos(from);
    const toCoords = view.coordsAtPos(to);
    if (!fromCoords || !toCoords) {
      onSelectionChange({ visible: false });
      return;
    }

    onSelectionChange({
      visible: true,
      from,
      to,
      anchorX: fromCoords.left,
      anchorY: fromCoords.top
    });
  };

  const inlineCodeCaretPosition = (state, position) => {
    let node = syntaxTree(state).resolveInner(position, -1);
    while (node && node.name !== 'InlineCode' && node.name !== 'CodeText') {
      node = node.parent;
    }
    if (!node) {
      return null;
    }

    const text = state.doc.sliceString(node.from, node.to);
    const openTicks = (/^`+/.exec(text) ?? [''])[0].length;
    const closeTicks = (/`+$/.exec(text) ?? [''])[0].length;
    if (!openTicks || !closeTicks) {
      return null;
    }

    const min = node.from + openTicks;
    const max = node.to - closeTicks;
    if (min > max) {
      return null;
    }
    if (position < min) {
      return min;
    }
    if (position > max) {
      return max;
    }
    return null;
  };

  const selectSearchMatch = (from, to) => {
    view.dispatch({
      selection: { anchor: from, head: to },
      effects: EditorView.scrollIntoView(from, { y: 'center' })
    });
    view.focus();
  };

  const findMatch = (query, backward = false) => {
    if (!query) {
      return { found: false, current: 0, total: 0 };
    }

    const text = view.state.doc.toString();
    const selection = view.state.selection.main;
    const from = Math.min(selection.from, selection.to);
    const to = Math.max(selection.from, selection.to);
    const total = countMatches(text, query);

    if (!total) {
      return { found: false, current: 0, total };
    }

    let index = -1;
    if (backward) {
      const start = from - 1;
      if (start >= 0) {
        index = text.lastIndexOf(query, start);
      }
      if (index < 0) {
        index = text.lastIndexOf(query);
      }
    } else {
      index = text.indexOf(query, to);
      if (index < 0) {
        index = text.indexOf(query);
      }
    }

    if (index < 0) {
      return { found: false, current: 0, total };
    }

    selectSearchMatch(index, index + query.length);
    return {
      found: true,
      current: matchNumberAt(text, query, index),
      total
    };
  };

  const replaceCurrentMatch = (query, replacement) => {
    if (!query) {
      return { replaced: false, found: false, current: 0, total: 0 };
    }

    const text = view.state.doc.toString();
    const selection = view.state.selection.main;
    const from = Math.min(selection.from, selection.to);
    const to = Math.max(selection.from, selection.to);
    const selectedText = text.slice(from, to);

    if (selectedText !== query) {
      return { replaced: false, ...findMatch(query, false) };
    }

    view.dispatch({
      changes: { from, to, insert: replacement },
      selection: { anchor: from, head: from + replacement.length }
    });
    const nextMatch = findMatch(query, false);
    if (nextMatch.found) {
      return { replaced: true, ...nextMatch };
    }

    const remaining = countMatches(view.state.doc.toString(), query);
    return { replaced: true, found: false, current: 0, total: remaining };
  };

  const state = EditorState.create({
    doc: text,
    extensions: [
      EditorState.tabSize.of(4),
      indentUnit.of('  '),
      keymap.of([
        { key: 'Tab', run: (view) => indentListByTwoSpaces(view) || indentWithTab(view) },
        { key: 'Shift-Tab', run: (view) => outdentListByTwoSpaces(view) || indentLess(view) },
        { key: 'Backspace', run: deleteBackwardSmart },
        {
          key: 'Enter',
          run: (view) =>
            handleEnterAtListContentStart(view) ||
            handleEnterContinueList(view) ||
            handleEnterBeforeNestedList(view)
        },
        { key: 'Shift-Enter', run: insertTableCellLineBreak },
        ...markdownKeymap,
        ...defaultKeymap,
        ...historyKeymap
      ]),
      history(),
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      EditorView.lineWrapping,
      scrollPastEnd(),
      EditorView.domEventHandlers({
        pointerdown(event, view) {
          if (event.button !== 0) {
            return false;
          }
          if (openLinkIfModifierClick(event)) {
            return true;
          }

          const target = event.target;
          const targetElement = targetElementFrom(target);
          if (!(target instanceof Node) || !view.contentDOM.contains(target)) {
            return false;
          }

          if (targetElement && targetElement.closest('.meo-mermaid-zoom-controls')) {
            event.preventDefault();
            event.stopPropagation();
            return true;
          }

          if (targetElement && targetElement.closest('.meo-task-checkbox')) {
            checkboxClick = { pointerId: event.pointerId };
            return false;
          }

          // Let interactive HTML table widget controls handle focus/click natively.
          if (targetElement && targetElement.closest('.meo-md-html-table-wrap')) {
            inlineCodeClick = null;
            checkboxClick = null;
            return false;
          }

          inlineCodeClick = {
            pointerId: event.pointerId,
            inInlineCode:
              currentMode === 'live' &&
              targetElement &&
              targetElement.closest('.meo-md-inline-code') !== null
          };

          if (view.dom.setPointerCapture) {
            view.dom.setPointerCapture(event.pointerId);
            capturedPointerId = event.pointerId;
          }
          return false;
        },
        pointerup(event, view) {
          if (checkboxClick?.pointerId === event.pointerId) {
            checkboxClick = null;
            return false;
          }

          if (capturedPointerId !== event.pointerId) {
            return false;
          }

          releasePointerCaptureIfHeld(event.pointerId);
          capturedPointerId = null;

          if (
            inlineCodeClick?.pointerId === event.pointerId &&
            inlineCodeClick.inInlineCode &&
            currentMode === 'live'
          ) {
            const { head, empty } = view.state.selection.main;
            if (empty) {
              const clamped = inlineCodeCaretPosition(view.state, head);
              if (clamped !== null && clamped !== head) {
                view.dispatch({ selection: { anchor: clamped } });
              }
            }
          }

          if (currentMode === 'live') {
            const { head, empty } = view.state.selection.main;
            if (empty) {
              const node = resolvedSyntaxTree(view.state).resolveInner(head, -1);
              if (node.name === 'HorizontalRule') {
                const line = view.state.doc.lineAt(head);
                const lineText = view.state.doc.sliceString(line.from, line.to);
                const hrMatch = /^[ \t]*(-{3,}|\*{3,}|_{3,})/.exec(lineText);
                if (hrMatch) {
                  const cursorEnd = line.from + hrMatch[0].length;
                  if (head !== cursorEnd) {
                    view.dispatch({ selection: { anchor: cursorEnd } });
                  }
                }
              }
            }
          }

          inlineCodeClick = null;
          return false;
        },
        pointercancel(event, view) {
          if (capturedPointerId !== event.pointerId) {
            return false;
          }

          releasePointerCaptureIfHeld(event.pointerId);
          capturedPointerId = null;
          inlineCodeClick = null;
          checkboxClick = null;
          return false;
        }
      }),
      modeCompartment.of(startMode === 'live' ? liveModeExtensions() : sourceMode()),
      searchQueryField,
      searchMatchField,
      EditorView.updateListener.of((update) => {
        syncModeClasses();
        syncLineNumbersVisibility();

        if (update.selectionSet) {
          syncSelectionClass();
          emitSelectionChange();
        } else if (update.viewportChanged) {
          emitSelectionChange();
        }

        if (!update.docChanged || applyingExternal || applyingRenumber) {
          return;
        }

        const renumberChanges = collectOrderedListRenumberChanges(update.state);
        if (renumberChanges.length) {
          applyingRenumber = true;
          view.dispatch({
            changes: renumberChanges,
            annotations: Transaction.addToHistory.of(false)
          });
          applyingRenumber = false;
          onApplyChanges(view.state.doc.toString());
          return;
        }

        onApplyChanges(update.state.doc.toString());
      })
    ]
  });

  view = new EditorView({
    state,
    parent
  });
  onTableInteraction = (event) => {
    const active = Boolean(event?.detail?.active);
    setTableInteractionActive(active);
  };
  view.dom.addEventListener('meo-table-interaction', onTableInteraction);
  onScroll = () => {
    emitSelectionChange();
  };
  view.scrollDOM.addEventListener('scroll', onScroll, { passive: true });
  syncModeClasses();
  syncLineNumbersVisibility();
  syncSelectionClass();
  emitSelectionChange();

  return {
    getText() {
      return view.state.doc.toString();
    },
    selectAll() {
      view.dispatch({
        selection: {
          anchor: 0,
          head: view.state.doc.length
        }
      });
      return true;
    },
    undo() {
      return undo(view);
    },
    redo() {
      return redo(view);
    },
    findNext(query) {
      return findMatch(query, false);
    },
    findPrevious(query) {
      return findMatch(query, true);
    },
    replaceCurrent(query, replacement) {
      return replaceCurrentMatch(query, replacement);
    },
    replaceAll(query, replacement) {
      if (!query) {
        return { replaced: 0, total: 0 };
      }

      const text = view.state.doc.toString();
      const replaced = countMatches(text, query);
      if (!replaced) {
        return { replaced: 0, total: 0 };
      }

      const nextText = text.split(query).join(replacement);
      view.dispatch({
        changes: { from: 0, to: text.length, insert: nextText },
        selection: { anchor: 0 }
      });
      return { replaced, total: countMatches(nextText, query) };
    },
    countMatches(query) {
      if (!query) {
        return 0;
      }
      return countMatches(view.state.doc.toString(), query);
    },
    setSearchQuery(query) {
      const nextQuery = query ?? '';
      const currentQuery = view.state.field(searchQueryField);
      if (currentQuery === nextQuery) {
        return;
      }
      view.dispatch({
        effects: setSearchQueryEffect.of(nextQuery)
      });
    },
    hasFocus() {
      return view.hasFocus;
    },
    focus() {
      view.focus();
    },
    destroy() {
      if (onScroll) {
        view.scrollDOM.removeEventListener('scroll', onScroll);
        onScroll = null;
      }
      if (onTableInteraction) {
        view.dom.removeEventListener('meo-table-interaction', onTableInteraction);
        onTableInteraction = null;
      }
      if (capturedPointerId !== null) {
        releasePointerCaptureIfHeld(capturedPointerId);
        capturedPointerId = null;
      }
      view.destroy();
    },
    setText(textValue) {
      const currentText = view.state.doc.toString();
      const syncChange = findSyncChange(currentText, textValue);
      if (!syncChange) {
        return;
      }

      const { anchor, head } = view.state.selection.main;
      const newLength = textValue.length;
      const clampedAnchor = Math.min(anchor, newLength);
      const clampedHead = Math.min(head, newLength);
      applyingExternal = true;
      view.dispatch({
        changes: syncChange,
        selection: { anchor: clampedAnchor, head: clampedHead },
        annotations: Transaction.addToHistory.of(false)
      });
      applyingExternal = false;
      syncSelectionClass();
      emitSelectionChange();
    },
    setMode(mode) {
      const nextMode = mode === 'live' ? 'live' : 'source';
      if (nextMode === currentMode) {
        return;
      }

      const lineBlock = view.lineBlockAtHeight(view.scrollDOM.scrollTop + 1);
      const lineNumber = view.state.doc.lineAt(lineBlock.from).number;

      currentMode = nextMode;
      view.dispatch({
        effects: modeCompartment.reconfigure(nextMode === 'live' ? liveModeExtensions() : sourceMode())
      });
      forceParsing(view, view.state.doc.length, 500);
      syncModeClasses();

      let attempts = 0;
      const restoreScroll = () => {
        if (!view || ++attempts > 3) {
          return;
        }
        const targetLine = view.state.doc.line(Math.min(lineNumber, view.state.doc.lines));
        const targetTop = view.lineBlockAt(targetLine.from).top;
        const currentTop = view.scrollDOM.scrollTop;
        view.scrollDOM.scrollTop = targetTop;
        if (Math.abs(currentTop - targetTop) <= 1) {
          return;
        }
        requestAnimationFrame(restoreScroll);
      };
      requestAnimationFrame(restoreScroll);
    },
    setLineNumbers(visible) {
      const nextVisible = visible !== false;
      if (nextVisible === lineNumbersVisible) {
        return;
      }
      lineNumbersVisible = nextVisible;
      syncLineNumbersVisibility();
    },
    insertFormat(action, level) {
      const { state } = view;
      const selection = state.selection.main;
      const line = state.doc.lineAt(selection.from);
      const lineText = state.doc.sliceString(line.from, line.to);

      const existingMarker = /^(\s*)([-+*]\s+\[[ xX]\]|[-+*]|\d+[.)])\s+/.exec(lineText);
      const existingHeading = /^(\s*)(#{1,6})\s+/.exec(lineText);
      const leadingWhitespace = existingMarker?.[1] ?? existingHeading?.[1] ?? /^(\s*)/.exec(lineText)[1];

      const contentStart = line.from + leadingWhitespace.length;
      let oldMarkerLen = 0;
      if (existingMarker) {
        oldMarkerLen = existingMarker[0].length - leadingWhitespace.length;
      } else if (existingHeading) {
        oldMarkerLen = existingHeading[0].length - leadingWhitespace.length;
      }

      const isExistingTask = existingMarker && /^[-+*]\s+\[[ xX]\]/.test(existingMarker[0]);
      if (action === 'task' && isExistingTask) {
        return;
      }

      let insert = '';
      switch (action) {
        case 'heading':
          insert = `${'#'.repeat(level ?? 1)} `;
          break;
        case 'bulletList':
          insert = '- ';
          break;
        case 'numberedList':
          insert = '1. ';
          break;
        case 'task':
          insert = '- [ ] ';
          break;
        case 'codeBlock':
          return insertCodeBlock(view, selection);
        case 'inlineCode':
          return insertInlineCode(view, selection);
        case 'bold':
          return insertInlineFence(view, selection, '**');
        case 'italic':
          return insertInlineFence(view, selection, '*');
        case 'lineover':
        case 'strike':
          return insertInlineFence(view, selection, '~~');
        case 'quote':
          return insertQuote(view, selection);
        case 'hr':
          return insertHr(view, selection);
        case 'table':
          return insertTable(view, selection, level?.cols, level?.rows);
        case 'link':
          return insertLink(view, selection);
        case 'wikiLink':
          return insertWikiLink(view, selection);
        case 'image':
          return insertImage(view, selection);
      }

      const newMarkerLen = insert.length;
      const cursorOffset = selection.from - (contentStart + oldMarkerLen);
      const newCursorPos = contentStart + newMarkerLen + Math.max(0, cursorOffset);

      view.dispatch({
        changes: { from: contentStart, to: contentStart + oldMarkerLen, insert },
        selection: { anchor: newCursorPos }
      });
    },
    getHeadings() {
      return extractHeadings(view.state);
    },
    scrollToLine(lineNumber) {
      const line = view.state.doc.line(Math.min(lineNumber, view.state.doc.lines));
      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: 'center' })
      });
      view.focus();
    },
    refreshSelectionOverlay() {
      emitSelectionChange();
    },
    refreshDecorations() {
      view.dispatch({ effects: refreshDecorationsEffect.of(null) });
    }
  };
}

function insertTableCellLineBreak(view) {
  const { state } = view;
  const selection = state.selection.main;
  if (!isInsideTableCell(state, selection.from) || !isInsideTableCell(state, selection.to)) {
    return false;
  }

  const insert = '<br>';
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert },
    selection: { anchor: selection.from + insert.length }
  });
  return true;
}

function deleteTableCellLineBreakBackward(view) {
  const { state } = view;
  const selection = state.selection.main;
  if (!selection.empty) {
    return false;
  }

  const pos = selection.from;
  if (!isInsideTableCell(state, pos)) {
    return false;
  }

  const from = Math.max(0, pos - 8);
  const before = state.doc.sliceString(from, pos);
  const match = /<br\s*\/?>$/i.exec(before);
  if (!match) {
    return false;
  }

  const start = pos - match[0].length;
  view.dispatch({
    changes: { from: start, to: pos },
    selection: { anchor: start }
  });
  return true;
}

function deleteBackwardSmart(view) {
  return handleBackspaceAtListContentStart(view) || deleteTableCellLineBreakBackward(view);
}

function isInsideTableCell(state, position) {
  let node = syntaxTree(state).resolveInner(position, -1);
  while (node) {
    if (node.name === 'TableCell') {
      return true;
    }
    if (node.name === 'TableDelimiter' || node.name === 'Table') {
      return false;
    }
    node = node.parent;
  }
  return false;
}

function findSyncChange(previousText, nextText) {
  if (previousText === nextText) {
    return null;
  }

  let from = 0;
  const maxStart = Math.min(previousText.length, nextText.length);
  while (from < maxStart && previousText.charCodeAt(from) === nextText.charCodeAt(from)) {
    from += 1;
  }

  let previousTo = previousText.length;
  let nextTo = nextText.length;
  while (
    previousTo > from &&
    nextTo > from &&
    previousText.charCodeAt(previousTo - 1) === nextText.charCodeAt(nextTo - 1)
  ) {
    previousTo -= 1;
    nextTo -= 1;
  }

  return {
    from,
    to: previousTo,
    insert: nextText.slice(from, nextTo)
  };
}

function countMatches(text, query) {
  if (!query) {
    return 0;
  }

  let count = 0;
  let offset = 0;
  while (offset <= text.length) {
    const index = text.indexOf(query, offset);
    if (index < 0) {
      break;
    }
    count += 1;
    offset = index + query.length;
  }
  return count;
}

function matchNumberAt(text, query, matchStart) {
  if (!query || matchStart < 0) {
    return 0;
  }

  let count = 0;
  let offset = 0;
  while (offset <= matchStart) {
    const index = text.indexOf(query, offset);
    if (index < 0 || index > matchStart) {
      break;
    }
    count += 1;
    offset = index + query.length;
  }
  return count;
}

function insertInlineCode(view, selection) {
  const { state } = view;

  if (!selection.empty) {
    const selectedText = state.doc.sliceString(selection.from, selection.to);
    const insert = `\`${selectedText}\``;
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert },
      selection: { anchor: selection.from + insert.length }
    });
    return;
  }

  const insert = '``';
  view.dispatch({
    changes: { from: selection.from, insert },
    selection: { anchor: selection.from + 1 }
  });
}

function insertInlineFence(view, selection, marker) {
  const { state } = view;
  const markerLength = marker.length;

  if (selection.empty) {
    const insert = `${marker}${marker}`;
    view.dispatch({
      changes: { from: selection.from, insert },
      selection: { anchor: selection.from + markerLength }
    });
    return;
  }

  const from = Math.min(selection.from, selection.to);
  const to = Math.max(selection.from, selection.to);
  const hasOpenMarker =
    from >= markerLength && state.doc.sliceString(from - markerLength, from) === marker;
  const hasCloseMarker = state.doc.sliceString(to, to + markerLength) === marker;

  if (hasOpenMarker && hasCloseMarker) {
    view.dispatch({
      changes: [
        { from: to, to: to + markerLength, insert: '' },
        { from: from - markerLength, to: from, insert: '' }
      ],
      selection: {
        anchor: from - markerLength,
        head: to - markerLength
      }
    });
    return;
  }

  view.dispatch({
    changes: [
      { from: to, insert: marker },
      { from, insert: marker }
    ],
    selection: {
      anchor: from + markerLength,
      head: to + markerLength
    }
  });
}

function insertQuote(view, selection) {
  const { state } = view;
  const line = state.doc.lineAt(selection.from);
  const lineText = state.doc.sliceString(line.from, line.to);

  const existingQuote = /^(\s*)(>\s*)/.exec(lineText);
  if (existingQuote) {
    return;
  }

  const leadingWhitespace = /^(\s*)/.exec(lineText)[1];
  const insert = '> ';
  const contentStart = line.from + leadingWhitespace.length;
  const cursorOffset = selection.from - contentStart;

  view.dispatch({
    changes: { from: contentStart, insert },
    selection: { anchor: contentStart + insert.length + cursorOffset }
  });
}

function insertHr(view, selection) {
  const { state } = view;
  const line = state.doc.lineAt(selection.from);
  const lineText = state.doc.sliceString(line.from, line.to);
  const leadingWhitespace = /^(\s*)/.exec(lineText)[1];

  const insert = `\n${leadingWhitespace}---\n`;
  const cursorPos = line.to + insert.length;

  view.dispatch({
    changes: { from: line.to, insert },
    selection: { anchor: cursorPos }
  });
}

function insertLink(view, selection) {
  const { state } = view;

  if (!selection.empty) {
    const selectedText = state.doc.sliceString(selection.from, selection.to);
    const insert = `[${selectedText}]()`;
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert },
      selection: { anchor: selection.from + insert.length - 1 }
    });
    return;
  }

  const insert = '[]()';
  view.dispatch({
    changes: { from: selection.from, insert },
    selection: { anchor: selection.from + 3 }
  });
}

function insertImage(view, selection) {
  const { state } = view;

  if (!selection.empty) {
    const selectedText = state.doc.sliceString(selection.from, selection.to);
    const insert = `![${selectedText}]()`;
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert },
      selection: { anchor: selection.from + insert.length - 1 }
    });
    return;
  }

  const insert = '![]()';
  view.dispatch({
    changes: { from: selection.from, insert },
    selection: { anchor: selection.from + 4 }
  });
}

function insertWikiLink(view, selection) {
  const { state } = view;

  if (!selection.empty) {
    const selectedText = state.doc.sliceString(selection.from, selection.to);
    const insert = `[[${selectedText}]]`;
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert },
      selection: { anchor: selection.from + insert.length }
    });
    return;
  }

  const insert = '[[]]';
  view.dispatch({
    changes: { from: selection.from, insert },
    selection: { anchor: selection.from + 2 }
  });
}

function sourceMode() {
  return [
    markdown({
      base: markdownLanguage,
      addKeymap: false,
      codeLanguages: resolveCodeLanguage,
      extensions: [{ remove: ['SetextHeading'] }]
    }),
    syntaxHighlighting(highlightStyle),
    sourceCodeBlockField,
    sourceListBorderField,
    sourceListMarkerField,
    sourceStrikeMarkerField,
    sourceWikiMarkerField,
    sourceTableHeaderLineField,
    sourceFrontmatterField
  ];
}

const blockedInlineSelectionAncestors = new Set([
  'FencedCode',
  'CodeBlock',
  'CodeText',
  'InlineCode',
  'URL',
  'Autolink',
  'HTMLBlock',
  'HTMLTag',
  'TableDelimiter'
]);

function hasBlockedInlineAncestor(state, position) {
  let node = syntaxTree(state).resolveInner(position, 1);
  while (node) {
    if (blockedInlineSelectionAncestors.has(node.name)) {
      return true;
    }
    node = node.parent;
  }
  return false;
}

function isRegularInlineSelection(state, from, to) {
  if (to <= from) {
    return false;
  }
  const text = state.doc.sliceString(from, to);
  if (!text.trim()) {
    return false;
  }
  if (text.includes('\n')) {
    return false;
  }
  if (hasBlockedInlineAncestor(state, from) || hasBlockedInlineAncestor(state, to - 1)) {
    return false;
  }
  return true;
}
