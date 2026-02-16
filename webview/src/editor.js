import { EditorState, Compartment, Transaction, StateField, RangeSetBuilder } from '@codemirror/state';
import { EditorView, Decoration, keymap, highlightActiveLine, lineNumbers, highlightActiveLineGutter, scrollPastEnd } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { indentUnit, syntaxHighlighting, ensureSyntaxTree, syntaxTree, forceParsing } from '@codemirror/language';
import { liveModeExtensions, listMarkerData } from './liveDecorations';
import { resolveCodeLanguage } from './codeBlockHighlight';
import { highlightStyle } from './theme';

function extractHeadings(state) {
  const headings = [];
  const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);
  
  tree.iterate({
    enter(node) {
      const headingLevel = headingLevelFromName(node.name);
      if (headingLevel !== null) {
        const line = state.doc.lineAt(node.from);
        let text = state.doc.sliceString(node.from, node.to);
        text = text.replace(/^#{1,6}\s+/, '').replace(/\s+#+$/, '').trim();
        headings.push({
          level: headingLevel,
          text,
          line: line.number,
          from: node.from
        });
      }
      if (node.name === 'SetextHeading1') {
        const line = state.doc.lineAt(node.from);
        const text = state.doc.sliceString(line.from, line.to).trim();
        headings.push({ level: 1, text, line: line.number, from: node.from });
      } else if (node.name === 'SetextHeading2') {
        const line = state.doc.lineAt(node.from);
        const text = state.doc.sliceString(line.from, line.to).trim();
        headings.push({ level: 2, text, line: line.number, from: node.from });
      }
    }
  });
  
  return headings;
}

function headingLevelFromName(name) {
  if (!name.startsWith('ATXHeading')) {
    return null;
  }
  const level = Number.parseInt(name.slice('ATXHeading'.length), 10);
  return Number.isInteger(level) && level >= 1 && level <= 6 ? level : null;
}

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

  const syncModeClasses = () => {
    if (!view) {
      return;
    }
    view.dom.classList.toggle('meo-mode-live', currentMode === 'live');
    view.dom.classList.toggle('meo-mode-source', currentMode !== 'live');
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
      keymap.of([indentWithTab, { key: 'Enter', run: handleEnterBeforeNestedList }, ...markdownKeymap, ...defaultKeymap, ...historyKeymap]),
      history(),
      highlightActiveLine(),
      lineNumbers(),
      highlightActiveLineGutter(),
      EditorView.lineWrapping,
      scrollPastEnd(),
      EditorView.domEventHandlers({
        pointerdown(event, view) {
          if (event.button !== 0) {
            return false;
          }

          const target = event.target;
          if (!(target instanceof Node) || !view.contentDOM.contains(target)) {
            return false;
          }

          if (target instanceof Element && target.closest('.meo-mermaid-zoom-controls')) {
            return false;
          }

          if (target instanceof Element && target.closest('.meo-task-checkbox')) {
            checkboxClick = { pointerId: event.pointerId };
            return false;
          }

          inlineCodeClick = {
            pointerId: event.pointerId,
            inInlineCode:
              currentMode === 'live' &&
              target instanceof Element &&
              target.closest('.meo-md-inline-code') !== null
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

          if (view.dom.releasePointerCapture && view.dom.hasPointerCapture(event.pointerId)) {
            view.dom.releasePointerCapture(event.pointerId);
          }
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
              ensureSyntaxTree(view.state, view.state.doc.length, 50);
              const node = syntaxTree(view.state).resolveInner(head, -1);
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

          if (view.dom.releasePointerCapture && view.dom.hasPointerCapture(event.pointerId)) {
            view.dom.releasePointerCapture(event.pointerId);
          }
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
      if (capturedPointerId !== null) {
        if (view.dom.releasePointerCapture && view.dom.hasPointerCapture(capturedPointerId)) {
          view.dom.releasePointerCapture(capturedPointerId);
        }
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

function handleEnterBeforeNestedList(view) {
  const { state } = view;
  const selection = state.selection.main;
  if (!selection.empty) {
    return false;
  }

  const position = selection.head;
  const line = state.doc.lineAt(position);
  if (position !== line.to || line.number >= state.doc.lines) {
    return false;
  }

  const currentText = state.doc.sliceString(line.from, line.to);
  const nextLine = state.doc.line(line.number + 1);
  const nextText = state.doc.sliceString(nextLine.from, nextLine.to);

  if (!/^[ \t]+(?:[-+*]|\d+[.)])\s+/.test(nextText)) {
    return false;
  }

  const marker = continuedListMarker(currentText);
  if (!marker) {
    return false;
  }

  const insert = `\n${marker}`;
  view.dispatch({
    changes: { from: position, insert },
    selection: { anchor: position + insert.length }
  });
  return true;
}

function continuedListMarker(lineText) {
  const taskMatch = /^([-+*])\s+\[[ xX]\]\s+\S/.exec(lineText);
  if (taskMatch) {
    return `${taskMatch[1]} [ ] `;
  }

  const bulletMatch = /^([-+*])\s+\S/.exec(lineText);
  if (bulletMatch) {
    return `${bulletMatch[1]} `;
  }

  const orderedMatch = /^(\d+)([.)])\s+\S/.exec(lineText);
  if (!orderedMatch) {
    return null;
  }

  const nextNumber = Number.parseInt(orderedMatch[1], 10) + 1;
  return `${nextNumber}${orderedMatch[2]} `;
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

function collectOrderedListRenumberChanges(state) {
  const changes = [];

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'OrderedList') {
        return;
      }

      let index = 1;
      for (let child = node.node.firstChild; child; child = child.nextSibling) {
        if (child.name !== 'ListItem') {
          continue;
        }

        const line = state.doc.lineAt(child.from);
        const lineText = state.doc.sliceString(line.from, line.to);
        const match = /^(\s*)(\d+)([.)])\s+/.exec(lineText);
        if (!match) {
          continue;
        }

        const expected = String(index);
        if (match[2] !== expected) {
          const from = line.from + match[1].length;
          changes.push({
            from,
            to: from + match[2].length,
            insert: expected
          });
        }

        index += 1;
      }
    }
  });

  return changes;
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
    sourceListBorderField
  ];
}

const sourceCodeBlockLine = Decoration.line({ class: 'meo-src-code-block' });

const sourceCodeBlockField = StateField.define({
  create(state) {
    return computeSourceCodeBlockLines(state);
  },
  update(lines, transaction) {
    if (!transaction.docChanged) {
      return lines;
    }
    return computeSourceCodeBlockLines(transaction.state);
  },
  provide: (field) => EditorView.decorations.from(field)
});

function computeSourceCodeBlockLines(state) {
  const ranges = new RangeSetBuilder();
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'FencedCode' && node.name !== 'CodeBlock') {
        return;
      }
      let line = state.doc.lineAt(node.from);
      const end = state.doc.lineAt(Math.max(node.to - 1, node.from)).number;
      while (line.number <= end) {
        ranges.add(line.from, line.from, sourceCodeBlockLine);
        if (line.number === end) {
          break;
        }
        line = state.doc.line(line.number + 1);
      }
      return false;
    }
  });
  return ranges.finish();
}

const sourceListBorderDeco = Decoration.mark({ class: 'meo-md-list-border' });

const sourceListBorderField = StateField.define({
  create(state) {
    return computeSourceListBorders(state);
  },
  update(borders, transaction) {
    return computeSourceListBorders(transaction.state);
  },
  provide: (field) => EditorView.decorations.from(field)
});

function computeSourceListBorders(state) {
  const ranges = new RangeSetBuilder();
  const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);
  tree.iterate({
    enter(node) {
      if (node.name !== 'ListItem') {
        return;
      }
      const line = state.doc.lineAt(node.from);
      const lineText = state.doc.sliceString(line.from, line.to);
      const marker = listMarkerData(lineText);
      if (!marker || marker.fromOffset === 0) {
        return;
      }
      const indentEnd = line.from + marker.fromOffset;
      for (let pos = line.from; pos < indentEnd; pos++) {
        ranges.add(pos, pos + 1, sourceListBorderDeco);
      }
    }
  });
  return ranges.finish();
}
