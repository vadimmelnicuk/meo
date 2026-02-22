import { RangeSetBuilder, StateEffect, StateField, Transaction } from '@codemirror/state';
import { EditorView, GutterMarker, gutter } from '@codemirror/view';
import { createElement, ChevronDown } from 'lucide';
import { extractHeadingSections } from './markdownSyntax';

const toggleHeadingCollapseEffect = StateEffect.define();
const expandHeadingCollapseEffect = StateEffect.define();
const emptyCollapsedHeadings = Object.freeze([]);

function isHeadingSectionCollapsible(state, section) {
  if (!section || section.collapseTo <= section.collapseFrom) {
    return false;
  }
  return state.doc.sliceString(section.collapseFrom, section.collapseTo).trim().length > 0;
}

function getCollapsibleHeadingSections(state) {
  return extractHeadingSections(state).filter((section) => isHeadingSectionCollapsible(state, section));
}

function getCollapsibleHeadingSectionMap(state) {
  const sections = getCollapsibleHeadingSections(state);
  return new Map(sections.map((section) => [section.lineFrom, section]));
}

function hasHeadingCollapseEffect(transaction) {
  return transaction.effects.some(
    (effect) => effect.is(toggleHeadingCollapseEffect) || effect.is(expandHeadingCollapseEffect)
  );
}

function hasToggleHeadingCollapseEffect(transaction) {
  return transaction.effects.some((effect) => effect.is(toggleHeadingCollapseEffect));
}

function mapCollapsedHeadingAnchors(anchors, transaction) {
  if (!anchors.length || !transaction.docChanged) {
    return anchors.slice();
  }
  return anchors.map((lineFrom) => transaction.changes.mapPos(lineFrom, 1));
}

function normalizeCollapsedHeadingAnchors(state, anchors) {
  if (!anchors.length) {
    return emptyCollapsedHeadings;
  }

  const validLineStarts = new Set(getCollapsibleHeadingSections(state).map((section) => section.lineFrom));
  const normalized = [];
  const seen = new Set();
  for (const lineFrom of anchors) {
    if (!validLineStarts.has(lineFrom) || seen.has(lineFrom)) {
      continue;
    }
    seen.add(lineFrom);
    normalized.push(lineFrom);
  }

  normalized.sort((a, b) => a - b);
  return normalized.length ? normalized : emptyCollapsedHeadings;
}

function arraysEqual(a, b) {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

function sortedNumbersFromSet(values) {
  if (!values.size) {
    return emptyCollapsedHeadings;
  }
  return Array.from(values).sort((a, b) => a - b);
}

function toggleSetNumber(values, value) {
  if (values.has(value)) {
    values.delete(value);
    return;
  }
  values.add(value);
}

const headingCollapseStateField = StateField.define({
  create() {
    return emptyCollapsedHeadings;
  },
  update(collapsedHeadings, transaction) {
    const hasEffectChange = hasHeadingCollapseEffect(transaction);
    if (!transaction.docChanged && !hasEffectChange) {
      return collapsedHeadings;
    }

    let next = mapCollapsedHeadingAnchors(collapsedHeadings, transaction);

    if (hasEffectChange) {
      const nextSet = new Set(next);
      for (const effect of transaction.effects) {
        if (effect.is(toggleHeadingCollapseEffect)) {
          toggleSetNumber(nextSet, effect.value);
          continue;
        }
        if (effect.is(expandHeadingCollapseEffect)) {
          for (const lineFrom of effect.value) {
            nextSet.delete(lineFrom);
          }
        }
      }
      next = Array.from(nextSet);
    }

    const normalized = normalizeCollapsedHeadingAnchors(transaction.state, next);
    return arraysEqual(normalized, collapsedHeadings) ? collapsedHeadings : normalized;
  }
});

const headingCollapseSharedExtension = Object.freeze([headingCollapseStateField]);

function getCollapsedHeadingAnchors(state) {
  return state.field(headingCollapseStateField, false) ?? emptyCollapsedHeadings;
}

function isHeadingCollapsed(state, lineFrom) {
  return getCollapsedHeadingAnchors(state).includes(lineFrom);
}

export function getCollapsedHeadingSections(state) {
  const collapsedLineStarts = getCollapsedHeadingAnchors(state);
  if (!collapsedLineStarts.length) {
    return emptyCollapsedHeadings;
  }

  const sectionMap = getCollapsibleHeadingSectionMap(state);
  const sections = [];
  for (const lineFrom of collapsedLineStarts) {
    const section = sectionMap.get(lineFrom);
    if (section) {
      sections.push(section);
    }
  }
  return sections.length ? sections : emptyCollapsedHeadings;
}

function collectCollapsedHeadingAnchorsForSelection(state) {
  const collapsedSections = getCollapsedHeadingSections(state);
  if (!collapsedSections.length) {
    return emptyCollapsedHeadings;
  }

  const matches = new Set();
  for (const selectionRange of state.selection.ranges) {
    const from = Math.min(selectionRange.from, selectionRange.to);
    const to = Math.max(selectionRange.from, selectionRange.to);
    for (const section of collapsedSections) {
      if (selectionRange.empty) {
        if (from > section.collapseFrom && from < section.collapseTo) {
          matches.add(section.lineFrom);
        }
        continue;
      }
      if (from < section.collapseTo && to > section.collapseFrom) {
        matches.add(section.lineFrom);
      }
    }
  }

  return sortedNumbersFromSet(matches);
}

export function headingCollapseSharedExtensions() {
  return headingCollapseSharedExtension;
}

class HeadingFoldGutterMarker extends GutterMarker {
  constructor(collapsed) {
    super();
    this.collapsed = collapsed;
  }

  eq(other) {
    return other instanceof HeadingFoldGutterMarker && other.collapsed === this.collapsed;
  }

  toDOM() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'meo-md-fold-toggle';
    button.title = this.collapsed ? 'Expand section' : 'Collapse section';
    button.setAttribute('aria-label', this.collapsed ? 'Expand section' : 'Collapse section');
    if (!this.collapsed) {
      button.classList.add('is-expanded');
    }

    const chevron = createElement(ChevronDown, {
      class: 'meo-md-fold-chevron',
      'aria-hidden': 'true',
      width: 14,
      height: 14
    });
    button.appendChild(chevron);
    return button;
  }
}

class HeadingFoldGutterSpacerMarker extends GutterMarker {
  toDOM() {
    const spacer = document.createElement('span');
    spacer.className = 'meo-md-fold-toggle meo-md-fold-toggle-spacer';
    spacer.setAttribute('aria-hidden', 'true');
    return spacer;
  }
}

const collapsedHeadingFoldMarker = new HeadingFoldGutterMarker(true);
const expandedHeadingFoldMarker = new HeadingFoldGutterMarker(false);
const headingFoldGutterSpacerMarker = new HeadingFoldGutterSpacerMarker();

function buildHeadingFoldGutterMarkers(state) {
  const builder = new RangeSetBuilder();
  const collapsedAnchors = new Set(getCollapsedHeadingAnchors(state));
  for (const section of getCollapsibleHeadingSections(state)) {
    builder.add(
      section.lineFrom,
      section.lineFrom,
      collapsedAnchors.has(section.lineFrom) ? collapsedHeadingFoldMarker : expandedHeadingFoldMarker
    );
  }
  return builder.finish();
}

const liveHeadingFoldGutterField = StateField.define({
  create(state) {
    return buildHeadingFoldGutterMarkers(state);
  },
  update(markers, transaction) {
    if (!transaction.docChanged && !hasHeadingCollapseEffect(transaction)) {
      return markers;
    }
    return buildHeadingFoldGutterMarkers(transaction.state);
  }
});

const liveHeadingFoldGutterExtension = gutter({
  class: 'meo-md-fold-gutter',
  renderEmptyElements: true,
  initialSpacer() {
    return headingFoldGutterSpacerMarker;
  },
  markers(view) {
    return view.state.field(liveHeadingFoldGutterField);
  },
  domEventHandlers: {
    mousedown(view, line, event) {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('.meo-md-fold-toggle')) {
        return false;
      }

      const section = getCollapsibleHeadingSectionMap(view.state).get(line.from);
      event.preventDefault();
      event.stopPropagation();
      if (!section) {
        return true;
      }

      const isCollapsed = isHeadingCollapsed(view.state, section.lineFrom);
      const transactionSpec = {
        effects: toggleHeadingCollapseEffect.of(section.lineFrom),
        annotations: Transaction.addToHistory.of(false)
      };
      if (!isCollapsed) {
        transactionSpec.selection = { anchor: section.lineFrom };
      }

      view.dispatch(transactionSpec);
      view.focus();
      return true;
    }
  }
});

const liveHeadingAutoExpandSelectionExtension = EditorView.updateListener.of((update) => {
  if (update.transactions.some(hasToggleHeadingCollapseEffect)) {
    return;
  }

  const collapsedAnchors = getCollapsedHeadingAnchors(update.state);
  if (!collapsedAnchors.length) {
    return;
  }

  const expandLineStarts = collectCollapsedHeadingAnchorsForSelection(update.state);
  if (!expandLineStarts.length) {
    return;
  }

  update.view.dispatch({
    effects: expandHeadingCollapseEffect.of(expandLineStarts),
    annotations: Transaction.addToHistory.of(false)
  });
});

const headingCollapseLiveExtension = Object.freeze([
  liveHeadingFoldGutterField,
  liveHeadingFoldGutterExtension,
  liveHeadingAutoExpandSelectionExtension
]);

export function headingCollapseLiveExtensions() {
  return headingCollapseLiveExtension;
}
