import { EditorState, Compartment, Transaction, StateField, RangeSetBuilder } from '@codemirror/state';
import {
  EditorView,
  Decoration,
  keymap,
  drawSelection,
  highlightActiveLine,
  lineNumbers,
  highlightActiveLineGutter
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, indentUnit, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { classHighlighter, tags } from '@lezer/highlight';
import { liveModeExtensions } from './liveDecorations';
import { resolveCodeLanguage } from './codeBlockHighlight';

export function createEditor({ parent, text, onApplyChanges }) {
  // VS Code webviews can hit cross-origin window access issues in the EditContext path.
  // Disable it explicitly for stability in embedded Chromium.
  EditorView.EDIT_CONTEXT = false;

  const modeCompartment = new Compartment();
  let applyingExternal = false;
  let capturedPointerId = null;
  let inlineCodeClick = null;
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
      keymap.of([indentWithTab, ...markdownKeymap, ...defaultKeymap, ...historyKeymap]),
      history(),
      drawSelection(),
      highlightActiveLine(),
      lineNumbers(),
      highlightActiveLineGutter(),
      EditorView.lineWrapping,
      EditorView.domEventHandlers({
        pointerdown(event, view) {
          if (event.button !== 0) {
            return false;
          }

          const target = event.target;
          if (!(target instanceof Node) || !view.contentDOM.contains(target)) {
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

      applyingExternal = true;
      view.dispatch({
        changes: syncChange,
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
      syncModeClasses();
    }
  };
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
      // Use the GFM-capable parser as the baseline source-mode language.
      base: markdownLanguage,
      addKeymap: false,
      codeLanguages: resolveCodeLanguage
    }),
    syntaxHighlighting(markdownHighlightStyle),
    syntaxHighlighting(classHighlighter),
    sourceCodeBlockField
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

export const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--vscode-editor-foreground)', fontWeight: '600' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.quote, tags.contentSeparator], color: 'var(--vscode-descriptionForeground)' },
  {
    tag: [tags.monospace, tags.processingInstruction],
    color: 'var(--vscode-textPreformat-foreground)'
  },
  { tag: tags.labelName, color: 'var(--vscode-editorCodeLens-foreground)' },
  { tag: [tags.link, tags.url], color: 'var(--vscode-textLink-foreground)' },
  { tag: tags.list, color: 'var(--vscode-editor-foreground)' },
  { tag: tags.atom, color: 'var(--vscode-descriptionForeground)' }
]);

export { classHighlighter };
