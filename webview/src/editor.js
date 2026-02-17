import { EditorState, Compartment, Transaction } from '@codemirror/state';
import { EditorView, keymap, highlightActiveLine, lineNumbers, highlightActiveLineGutter, scrollPastEnd } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { indentUnit, syntaxHighlighting, syntaxTree, forceParsing } from '@codemirror/language';
import { highlightStyle } from './theme';
import { liveModeExtensions } from './liveMode';
import { resolveCodeLanguage, insertCodeBlock, sourceCodeBlockField } from './helpers/codeBlocks';
import { sourceStrikeMarkerField } from './helpers/strikeMarkers';
import { resolvedSyntaxTree, extractHeadings } from './helpers/markdownSyntax';
import { sourceListBorderField, handleEnterBeforeNestedList, collectOrderedListRenumberChanges } from './helpers/listMarkers';
import { insertTable, sourceTableHeaderLineField } from './helpers/tables';

export function createEditor({ parent, text, onApplyChanges }) {
  // VS Code webviews can hit cross-origin window access issues in the EditContext path.
  // Disable it explicitly for stability in embedded Chromium.
  EditorView.EDIT_CONTEXT = false;

  const modeCompartment = new Compartment();
  let applyingExternal = false;
  let capturedPointerId = null;
  let inlineCodeClick = null;
  let checkboxClick = null;
  let view = null;
  let currentMode = 'source';
  let applyingRenumber = false;
  let tableInteractionActive = false;
  let onTableInteraction = null;
  const targetElementFrom = (target) => (
    target instanceof Element ? target : target instanceof Node ? target.parentElement : null
  );

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

  const state = EditorState.create({
    doc: text,
    extensions: [
      indentUnit.of('	'),
      keymap.of([
        indentWithTab,
        { key: 'Backspace', run: deleteTableCellLineBreakBackward },
        { key: 'Enter', run: handleEnterBeforeNestedList },
        { key: 'Shift-Enter', run: insertTableCellLineBreak },
        ...markdownKeymap,
        ...defaultKeymap,
        ...historyKeymap
      ]),
      history(),
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      EditorView.lineWrapping,
      scrollPastEnd(),
      EditorView.domEventHandlers({
        pointerdown(event, view) {
          if (event.button !== 0) {
            return false;
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
      modeCompartment.of(sourceMode()),
      EditorView.updateListener.of((update) => {
        syncModeClasses();

        if (update.selectionSet) {
          syncSelectionClass();
        }

        if (!update.docChanged || applyingExternal || applyingRenumber) {
          return;
        }

        const renumberChanges = collectOrderedListRenumberChanges(update.state, syntaxTree(update.state));
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
  syncModeClasses();
  syncSelectionClass();

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
    hasFocus() {
      return view.hasFocus;
    },
    focus() {
      view.focus();
    },
    destroy() {
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
    },
    setMode(mode) {
      currentMode = mode;
      view.dispatch({
        effects: modeCompartment.reconfigure(mode === 'live' ? liveModeExtensions() : sourceMode())
      });
      forceParsing(view, view.state.doc.length, 500);
      syncModeClasses();
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
        case 'quote':
          return insertQuote(view, selection);
        case 'hr':
          return insertHr(view, selection);
        case 'table':
          return insertTable(view, selection);
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

function sourceMode() {
  return [
    markdown({
      base: markdownLanguage,
      addKeymap: false,
      codeLanguages: resolveCodeLanguage
    }),
    syntaxHighlighting(highlightStyle),
    sourceCodeBlockField,
    sourceListBorderField,
    sourceStrikeMarkerField,
    sourceTableHeaderLineField
  ];
}
