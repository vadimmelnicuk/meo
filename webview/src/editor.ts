import { EditorState, Compartment, Transaction, StateEffect, StateField, RangeSetBuilder } from '@codemirror/state';
import { EditorView, keymap, highlightActiveLine, lineNumbers, highlightActiveLineGutter, scrollPastEnd, Decoration } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentMore, indentLess, undo, redo } from '@codemirror/commands';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { indentUnit, syntaxHighlighting, syntaxTree, forceParsing } from '@codemirror/language';
import { vim } from '@replit/codemirror-vim';
import { highlightStyle } from './theme';
import { liveModeExtensions } from './liveMode';
import { headingCollapseSharedExtensions, headingCollapseSourceSpacerExtensions } from './helpers/headingCollapse';
import { resolveCodeLanguage, insertCodeBlock, sourceCodeBlockField } from './helpers/codeBlocks';
import { sourceStrikeMarkerField } from './helpers/strikeMarkers';
import { sourceWikiMarkerField } from './helpers/wikiLinks';
import {
  gitDiffGutterBaselineExtensions,
  gitDiffGutterRenderExtensions,
  gitDiffGutterPlaceholderExtensions,
  setGitBaseline as applyGitBaseline
} from './helpers/gitDiffGutter';
import { gitDiffLineHighlightsField } from './helpers/gitDiffLineHighlights';
import { createGitDiffOverviewRulerController } from './helpers/gitDiffOverviewRuler';
import { createGitBlameHoverController } from './helpers/gitBlameHover';
import { mergeConflictSourceExtensions } from './helpers/mergeConflicts';
import { resolvedSyntaxTree, extractHeadings, extractHeadingSections } from './helpers/markdownSyntax';
import {
  sourceListBorderField,
  sourceListMarkerField,
  handleArrowLeftAtListContentStart,
  handleArrowRightAtListLineStart,
  handleBackspaceAtListContentStart,
  handleEnterAtListContentStart,
  handleEnterOnEmptyListItem,
  handleEnterContinueList,
  handleEnterBeforeNestedList,
  collectOrderedListRenumberChanges,
  indentListByTwoSpaces,
  outdentListByTwoSpaces
} from './helpers/listMarkers';
import { insertTable, sourceTableHeaderLineField } from './helpers/tables';
import { parseFrontmatter, sourceFrontmatterField } from './helpers/frontmatter';

declare module '@codemirror/view' {
  interface EditorView {
    EDIT_CONTEXT?: boolean;
  }
}

const setSearchQueryEffect = StateEffect.define<string>();
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

const searchMatchField = StateField.define<any>({
  create() {
    return Decoration.none;
  },
  update(value: any, tr: Transaction) {
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
  provide(field: any) {
    return EditorView.decorations.from(field);
  }
});

export function createEditor({
  parent,
  text,
  onApplyChanges,
  onOpenLink,
  onSelectionChange,
  onRequestGitBlame,
  onOpenGitRevisionForLine,
  onOpenGitWorktreeForLine,
  initialMode = 'source',
  initialLineNumbers = true,
  initialGitGutter = true,
  initialVimMode = false
}) {
  // VS Code webviews can hit cross-origin window access issues in the EditContext path.
  // Disable it explicitly for stability in embedded Chromium.
  (EditorView as any).EDIT_CONTEXT = false;

  const modeCompartment = new Compartment();
  const gitGutterCompartment = new Compartment();
  const vimCompartment = new Compartment();
  const startMode = initialMode === 'live' ? 'live' : 'source';
  let lineNumbersVisible = initialLineNumbers !== false;
  let gitGutterVisible = initialGitGutter !== false;
  let vimModeEnabled = initialVimMode === true;
  let applyingExternal = false;
  let capturedPointerId = null;
  let inlineCodeClick = null;
  let checkboxClick = null;
  let frontmatterBoundaryClick = null;
  let view = null;
  let currentMode = startMode;
  let applyingRenumber = false;
  // External syncs may carry stale selections in their history entries.
  // Preserve the user's current cursor once on the next undo of such a change.
  let pendingExternalUndoSelectionPreserve = false;
  let tableInteractionActive = false;
  let onTableInteraction = null;
  let onTableOpenLink = null;
  let onScroll = null;
  let gitBlameHover = null;
  let gitDiffOverviewRuler = null;
  const vimExtensionsForState = () => (vimModeEnabled && currentMode === 'source' ? vim() : []);
  const initialCursorPos = (() => {
    if (!text) {
      return 0;
    }
    const firstLineEnd = text.indexOf('\n');
    return firstLineEnd === -1 ? text.length : firstLineEnd;
  })();
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
  const isLiveMode = (editorView) => editorView.dom.classList.contains('meo-mode-live');
  const isPlainPrimaryPointerEvent = (event) => (
    event.button === 0 && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey
  );
  const frontmatterBoundaryCursorEnd = (state, pos) => {
    const frontmatter = parseFrontmatter(state);
    if (!frontmatter) {
      return null;
    }
    const line = state.doc.lineAt(pos);
    const openingLineNo = state.doc.lineAt(frontmatter.openingFrom).number;
    const closingLineNo = state.doc.lineAt(frontmatter.closingFrom).number;
    if (line.number !== openingLineNo && line.number !== closingLineNo) {
      return null;
    }
    const lineText = state.doc.sliceString(line.from, line.to);
    const markerStart = lineText.indexOf('---');
    return markerStart >= 0 ? line.from + markerStart + 3 : null;
  };
  const trackFrontmatterBoundaryClick = (event, editorView) => {
    frontmatterBoundaryClick = null;
    if (!isLiveMode(editorView) || !isPlainPrimaryPointerEvent(event)) {
      return;
    }
    const clickedPos = editorView.posAtCoords({ x: event.clientX, y: event.clientY });
    if (clickedPos === null) {
      return;
    }
    const cursorEnd = frontmatterBoundaryCursorEnd(editorView.state, clickedPos);
    if (cursorEnd === null) {
      return;
    }
    frontmatterBoundaryClick = {
      pointerId: event.pointerId,
      cursorEnd
    };
  };

  const setTableInteractionActive = (active) => {
    if (!view || tableInteractionActive === active) {
      return;
    }
    tableInteractionActive = active;
    view.dom.classList.toggle('meo-table-interaction-active', active);
  };
  const tableEntryCellSelector = 'th[data-table-row][data-table-col], td[data-table-row][data-table-col]';
  const tableEntryProbeOffsetsY = [1, 4, 8, 12, 18];
  const focusTableEntryInput = (input) => {
    if (!(input instanceof HTMLTextAreaElement)) {
      return false;
    }
    input.focus({ preventScroll: true });
    const caret = input.value.length;
    input.setSelectionRange(caret, caret);
    input.closest(tableEntryCellSelector)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    return true;
  };
  const findTableEntryInput = (wrap, hit, direction) => {
    const cell = hit.closest(tableEntryCellSelector);
    if (cell instanceof HTMLElement && wrap.contains(cell)) {
      const cellInput = cell.querySelector('textarea');
      if (cellInput instanceof HTMLTextAreaElement) {
        return cellInput;
      }
    }

    if (direction === 'down') {
      const first = wrap.querySelector('textarea');
      return first instanceof HTMLTextAreaElement ? first : null;
    }

    const inputs = wrap.querySelectorAll('textarea');
    const last = inputs.length ? inputs[inputs.length - 1] : null;
    return last instanceof HTMLTextAreaElement ? last : null;
  };

  const tryEnterAdjacentTable = (editorView, direction) => {
    if ((direction !== 'down' && direction !== 'up') || currentMode !== 'live' || tableInteractionActive) {
      return false;
    }

    const selection = editorView.state.selection.main;
    if (!selection.empty) {
      return false;
    }

    const caretRect = editorView.coordsAtPos(selection.head);
    if (!caretRect) {
      return false;
    }

    const contentRect = editorView.contentDOM.getBoundingClientRect();
    if (!contentRect || contentRect.width <= 0 || contentRect.height <= 0) {
      return false;
    }

    const clampX = (x) => Math.min(Math.max(x, contentRect.left + 1), contentRect.right - 1);
    const probeXs = [
      clampX(caretRect.left + 1),
      clampX(contentRect.left + Math.min(24, Math.max(8, contentRect.width * 0.05)))
    ];

    for (const offsetY of tableEntryProbeOffsetsY) {
      const y = direction === 'down'
        ? caretRect.bottom + offsetY
        : caretRect.top - offsetY;
      if (y < 0 || y >= window.innerHeight) {
        if (direction === 'down' && y >= window.innerHeight) break;
        continue;
      }
      for (const x of probeXs) {
        const hit = document.elementFromPoint(x, y);
        if (!(hit instanceof Element)) {
          continue;
        }
        const wrap = hit.closest('.meo-md-html-table-wrap');
        if (!(wrap instanceof HTMLElement) || !editorView.dom.contains(wrap)) {
          continue;
        }
        const input = findTableEntryInput(wrap, hit, direction);
        if (!focusTableEntryInput(input)) {
          continue;
        }
        return true;
      }
    }

    return false;
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

  const syncGitGutterVisibility = () => {
    if (!view) {
      return;
    }
    const shouldShowGitGutter = gitGutterVisible && currentMode === 'source';
    view.dom.classList.toggle('meo-git-gutter-hidden', !shouldShowGitGutter);
    if (!shouldShowGitGutter) {
      gitBlameHover?.hide();
    }
    gitDiffOverviewRuler?.refresh();
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

  const selectSearchMatch = (from, to, { focusEditor = true } = {}) => {
    view.dispatch({
      selection: { anchor: from, head: to },
      effects: EditorView.scrollIntoView(from, { y: 'center' })
    });
    if (focusEditor) {
      view.focus();
    }
  };

  const applyRevealSelection = (anchor, head = anchor, { focusEditor = true, align = 'center' } = {}) => {
    const max = view.state.doc.length;
    const nextAnchor = Math.max(0, Math.min(anchor, max));
    const nextHead = Math.max(0, Math.min(head, max));
    const y = align === 'top' ? 'start' : 'center';
    const selection = view.state.selection.main;

    if (selection.anchor === nextAnchor && selection.head === nextHead) {
      view.dispatch({
        effects: EditorView.scrollIntoView(nextAnchor, { y })
      });
      if (focusEditor) {
        view.focus();
      }
      return;
    }

    view.dispatch({
      selection: { anchor: nextAnchor, head: nextHead },
      effects: EditorView.scrollIntoView(nextAnchor, { y })
    });
    if (focusEditor) {
      view.focus();
    }
  };

  const findMatch = (query, backward = false, { focusEditor = true } = {}) => {
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

    selectSearchMatch(index, index + query.length, { focusEditor });
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
    selection: { anchor: initialCursorPos },
    extensions: [
      EditorState.tabSize.of(4),
      indentUnit.of('  '),
      vimCompartment.of(vimExtensionsForState()),
      keymap.of([
        { key: 'Tab', run: (view) => indentListByTwoSpaces(view) || indentMore(view) },
        { key: 'Shift-Tab', run: (view) => outdentListByTwoSpaces(view) || indentLess(view) },
        { key: 'Backspace', run: deleteBackwardSmart },
        { key: 'ArrowLeft', run: (view) => isLiveMode(view) && handleArrowLeftAtListContentStart(view) },
        { key: 'ArrowRight', run: (view) => isLiveMode(view) && handleArrowRightAtListLineStart(view) },
        {
          key: 'Enter',
          run: (view) =>
            handleEnterOnEmptyListItem(view) ||
            handleEnterAtListContentStart(view) ||
            handleEnterContinueList(view) ||
            handleEnterBeforeNestedList(view)
        },
        { key: 'Shift-Enter', run: insertTableCellLineBreak },
        { key: 'ArrowUp', run: (view) => tryEnterAdjacentTable(view, 'up') },
        { key: 'ArrowDown', run: (view) => tryEnterAdjacentTable(view, 'down') },
        ...markdownKeymap,
        ...defaultKeymap,
        ...historyKeymap
      ]),
      history(),
      lineNumbers(),
      ...gitDiffGutterBaselineExtensions(),
      gitGutterCompartment.of(startMode === 'live' ? gitDiffGutterPlaceholderExtensions() : gitDiffGutterRenderExtensions()),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      EditorView.lineWrapping,
      scrollPastEnd(),
      EditorView.domEventHandlers({
        pointerdown(event, view) {
          if (event.button !== 0) {
            frontmatterBoundaryClick = null;
            return false;
          }
          if (openLinkIfModifierClick(event)) {
            frontmatterBoundaryClick = null;
            return true;
          }

          const target = event.target;
          const targetElement = targetElementFrom(target);
          if (!(target instanceof Node) || !view.contentDOM.contains(target)) {
            return false;
          }

          trackFrontmatterBoundaryClick(event, view);

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
            frontmatterBoundaryClick = null;
            checkboxClick = null;
            return false;
          }

          if (capturedPointerId !== event.pointerId) {
            if (frontmatterBoundaryClick?.pointerId === event.pointerId) {
              frontmatterBoundaryClick = null;
            }
            return false;
          }

          releasePointerCaptureIfHeld(event.pointerId);
          capturedPointerId = null;

          if (
            inlineCodeClick?.pointerId === event.pointerId &&
            inlineCodeClick.inInlineCode &&
            isLiveMode(view)
          ) {
            const { head, empty } = view.state.selection.main;
            if (empty) {
              const clamped = inlineCodeCaretPosition(view.state, head);
              if (clamped !== null && clamped !== head) {
                view.dispatch({ selection: { anchor: clamped } });
              }
            }
          }

          if (frontmatterBoundaryClick?.pointerId === event.pointerId) {
            if (isLiveMode(view)) {
              const selection = view.state.selection.main;
              if (selection.empty && selection.head !== frontmatterBoundaryClick.cursorEnd) {
                view.dispatch({ selection: { anchor: frontmatterBoundaryClick.cursorEnd } });
              }
            }
            frontmatterBoundaryClick = null;
          }

          if (isLiveMode(view)) {
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
            if (frontmatterBoundaryClick?.pointerId === event.pointerId) {
              frontmatterBoundaryClick = null;
            }
            return false;
          }

          releasePointerCaptureIfHeld(event.pointerId);
          capturedPointerId = null;
          frontmatterBoundaryClick = null;
          inlineCodeClick = null;
          checkboxClick = null;
          return false;
        }
      }),
      ...headingCollapseSharedExtensions(),
      modeCompartment.of(startMode === 'live' ? liveModeExtensions() : sourceMode()),
      searchQueryField,
      searchMatchField,
      EditorView.updateListener.of((update) => {
        syncModeClasses();
        syncLineNumbersVisibility();
        syncGitGutterVisibility();

        if (update.selectionSet) {
          syncSelectionClass();
          emitSelectionChange();
        } else if (update.viewportChanged) {
          emitSelectionChange();
        }

        if (!update.docChanged || applyingExternal || applyingRenumber) {
          return;
        }

        gitBlameHover?.hide();

        pendingExternalUndoSelectionPreserve = false;

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
  onTableOpenLink = (event) => {
    const href = event?.detail?.href;
    if (typeof href !== 'string' || !href) {
      return;
    }
    onOpenLink?.(href);
  };
  view.dom.addEventListener('meo-open-link', onTableOpenLink);
  onScroll = () => {
    emitSelectionChange();
    gitBlameHover?.hide();
  };
  view.scrollDOM.addEventListener('scroll', onScroll, { passive: true });
  if (typeof onRequestGitBlame === 'function') {
    gitBlameHover = createGitBlameHoverController({
      view,
      getMode: () => currentMode,
      requestBlame: onRequestGitBlame,
      openRevisionForLine: onOpenGitRevisionForLine,
      openWorktreeForLine: onOpenGitWorktreeForLine
    });
  }
  gitDiffOverviewRuler = createGitDiffOverviewRulerController({
    view,
    getMode: () => currentMode,
    isGitChangesVisible: () => gitGutterVisible
  });
  syncModeClasses();
  syncLineNumbersVisibility();
  syncGitGutterVisibility();
  syncSelectionClass();
  emitSelectionChange();

  return {
    view,
    state: view.state,
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
      const shouldPreserveSelection = pendingExternalUndoSelectionPreserve;
      const { anchor, head } = view.state.selection.main;
      const applied = undo(view);
      if (!applied) {
        return false;
      }
      if (!shouldPreserveSelection) {
        return true;
      }

      pendingExternalUndoSelectionPreserve = false;
      const nextAnchor = Math.min(anchor, view.state.doc.length);
      const nextHead = Math.min(head, view.state.doc.length);
      const selection = view.state.selection.main;
      if (selection.anchor === nextAnchor && selection.head === nextHead) {
        return true;
      }

      view.dispatch({
        selection: { anchor: nextAnchor, head: nextHead },
        annotations: Transaction.addToHistory.of(false)
      });
      return true;
    },
    redo() {
      return redo(view);
    },
    findNext(query, options) {
      return findMatch(query, false, options);
    },
    findPrevious(query, options) {
      return findMatch(query, true, options);
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
      gitBlameHover?.destroy();
      gitBlameHover = null;
      gitDiffOverviewRuler?.destroy();
      gitDiffOverviewRuler = null;
      if (onScroll) {
        view.scrollDOM.removeEventListener('scroll', onScroll);
        onScroll = null;
      }
      if (onTableInteraction) {
        view.dom.removeEventListener('meo-table-interaction', onTableInteraction);
        onTableInteraction = null;
      }
      if (onTableOpenLink) {
        view.dom.removeEventListener('meo-open-link', onTableOpenLink);
        onTableOpenLink = null;
      }
      if (capturedPointerId !== null) {
        releasePointerCaptureIfHeld(capturedPointerId);
        capturedPointerId = null;
      }
      view.destroy();
    },
    setText(textValue) {
      gitBlameHover?.hide();
      const currentText = view.state.doc.toString();
      const syncChange = findSyncChange(currentText, textValue);
      if (!syncChange) {
        return;
      }

      const { anchor, head } = view.state.selection.main;
      const newLength = textValue.length;
      const mappedAnchor = Math.min(mapPositionThroughChange(anchor, syncChange), newLength);
      const mappedHead = Math.min(mapPositionThroughChange(head, syncChange), newLength);
      applyingExternal = true;
      view.dispatch({
        changes: syncChange,
        selection: { anchor: mappedAnchor, head: mappedHead }
      });
      applyingExternal = false;
      pendingExternalUndoSelectionPreserve = true;
      syncSelectionClass();
      emitSelectionChange();
    },
    setMode(mode) {
      gitBlameHover?.hide();
      const nextMode = mode === 'live' ? 'live' : 'source';
      if (nextMode === currentMode) {
        return;
      }

      const lineBlock = view.lineBlockAtHeight(view.scrollDOM.scrollTop + 1);
      const lineNumber = view.state.doc.lineAt(lineBlock.from).number;

      const previousMode = currentMode;
      currentMode = nextMode;
      try {
        view.dispatch({
          effects: [
            modeCompartment.reconfigure(nextMode === 'live' ? liveModeExtensions() : sourceMode()),
            gitGutterCompartment.reconfigure(
              nextMode === 'live' ? gitDiffGutterPlaceholderExtensions() : gitDiffGutterRenderExtensions()
            ),
            vimCompartment.reconfigure(vimExtensionsForState())
          ]
        });
        forceParsing(view, view.state.doc.length, 500);
      } catch (error) {
        currentMode = previousMode;
        syncModeClasses();
        throw error;
      }
      syncModeClasses();
      syncGitGutterVisibility();

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
    setGitGutterVisible(visible) {
      const nextVisible = visible !== false;
      if (nextVisible === gitGutterVisible) {
        return;
      }
      gitGutterVisible = nextVisible;
      syncGitGutterVisibility();
    },
    setVimMode(enabled) {
      const nextEnabled = enabled === true;
      if (nextEnabled === vimModeEnabled) {
        return;
      }
      vimModeEnabled = nextEnabled;
      view.dispatch({
        effects: vimCompartment.reconfigure(vimExtensionsForState())
      });
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
    moveHeadingSection(sourceHeadingFrom, targetHeadingFrom, placement) {
      if (placement !== 'before' && placement !== 'after') {
        return false;
      }

      const sections = extractHeadingSections(view.state);
      const source = sections.find((heading) => heading.from === sourceHeadingFrom);
      const target = sections.find((heading) => heading.from === targetHeadingFrom);
      if (!source || !target) {
        return false;
      }

      const insertionPoint = placement === 'before' ? target.sectionFrom : target.sectionTo;
      if (insertionPoint > source.sectionFrom && insertionPoint < source.sectionTo) {
        return false;
      }

      const currentText = view.state.doc.toString();
      const movedText = currentText.slice(source.sectionFrom, source.sectionTo);
      if (!movedText) {
        return false;
      }

      const textWithoutSource = currentText.slice(0, source.sectionFrom) + currentText.slice(source.sectionTo);
      const sourceLength = source.sectionTo - source.sectionFrom;
      const adjustedInsertionPoint = insertionPoint >= source.sectionTo ? insertionPoint - sourceLength : insertionPoint;
      const nextText =
        textWithoutSource.slice(0, adjustedInsertionPoint) +
        movedText +
        textWithoutSource.slice(adjustedInsertionPoint);

      if (nextText === currentText) {
        return false;
      }

      const nextAnchor = Math.min(adjustedInsertionPoint, nextText.length);
      view.dispatch({
        changes: { from: 0, to: currentText.length, insert: nextText },
        selection: { anchor: nextAnchor },
        effects: EditorView.scrollIntoView(nextAnchor, { y: 'start' })
      });
      return true;
    },
    scrollToLine(lineNumber, align = 'center') {
      const line = view.state.doc.line(Math.min(lineNumber, view.state.doc.lines));
      applyRevealSelection(line.from, line.from, { focusEditor: true, align });
    },
    revealSelection(anchor, head, options) {
      applyRevealSelection(anchor, head, options);
    },
    refreshSelectionOverlay() {
      emitSelectionChange();
    },
    refreshDecorations() {
      view.dispatch({ effects: refreshDecorationsEffect.of(null) });
    },
    setGitBaseline(snapshot) {
      applyGitBaseline(view, snapshot);
      gitBlameHover?.hide();
      gitDiffOverviewRuler?.refresh();
    },
    clearGitUiTransientState() {
      gitBlameHover?.hide();
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

// Map a position through a single replace change so external syncs keep the cursor nearby.
function mapPositionThroughChange(position, change) {
  const insertLength = change.insert.length;
  const deletedLength = change.to - change.from;
  const delta = insertLength - deletedLength;

  if (position <= change.from) {
    return position;
  }

  if (position >= change.to) {
    return position + delta;
  }

  return change.from + insertLength;
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
    let from = Math.min(selection.from, selection.to);
    let to = Math.max(selection.from, selection.to);
    while (to > from && state.doc.sliceString(to - 1, to) === '\n') {
      to -= 1;
    }
    const selectedText = state.doc.sliceString(from, to);
    const insert = `\`${selectedText}\``;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length }
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
  let to = Math.max(selection.from, selection.to);
  while (to > from && state.doc.sliceString(to - 1, to) === '\n') {
    to -= 1;
  }
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
  const trimmed = lineText.trim();

  if (!trimmed) {
    const insert = '---';
    const cursorPos = line.from + insert.length;
    view.dispatch({
      changes: { from: line.from, to: line.to, insert },
      selection: { anchor: cursorPos }
    });
  } else {
    const insert = '\n---';
    const cursorPos = line.to + insert.length;
    view.dispatch({
      changes: { from: line.to, insert },
      selection: { anchor: cursorPos }
    });
  }
}

function insertLink(view, selection) {
  const { state } = view;

  if (!selection.empty) {
    let from = Math.min(selection.from, selection.to);
    let to = Math.max(selection.from, selection.to);
    while (to > from && state.doc.sliceString(to - 1, to) === '\n') {
      to -= 1;
    }
    const selectedText = state.doc.sliceString(from, to);
    const insert = `[${selectedText}]()`;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length - 1 }
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
    let from = Math.min(selection.from, selection.to);
    let to = Math.max(selection.from, selection.to);
    while (to > from && state.doc.sliceString(to - 1, to) === '\n') {
      to -= 1;
    }
    const selectedText = state.doc.sliceString(from, to);
    const insert = `![${selectedText}]()`;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length - 1 }
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
    let from = Math.min(selection.from, selection.to);
    let to = Math.max(selection.from, selection.to);
    while (to > from && state.doc.sliceString(to - 1, to) === '\n') {
      to -= 1;
    }
    const selectedText = state.doc.sliceString(from, to);
    const insert = `[[${selectedText}]]`;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length }
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
    sourceFrontmatterField,
    gitDiffLineHighlightsField,
    ...headingCollapseSourceSpacerExtensions(),
    ...mergeConflictSourceExtensions()
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
  const trimmedText = text.trim();
  if (!trimmedText) {
    return false;
  }
  if (trimmedText.includes('\n')) {
    return false;
  }
  if (hasBlockedInlineAncestor(state, from) || hasBlockedInlineAncestor(state, to - 1)) {
    return false;
  }
  return true;
}
