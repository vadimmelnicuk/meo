import { StateField, RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import { resolvedSyntaxTree } from './markdownSyntax';

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const wikiLinkStatusByTarget = new Map();

export const wikiLinkScheme = 'meo-wiki:';

function parentNameOf(node) {
  return node?.node?.parent?.name ?? node?.parent?.name ?? '';
}

function isEscapedPosition(state, pos) {
  if (pos <= 0) {
    return false;
  }
  let slashCount = 0;
  for (let i = pos - 1; i >= 0 && state.doc.sliceString(i, i + 1) === '\\'; i -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function trimRange(state, from, to) {
  while (from < to && /\s/.test(state.doc.sliceString(from, from + 1))) {
    from += 1;
  }
  while (to > from && /\s/.test(state.doc.sliceString(to - 1, to))) {
    to -= 1;
  }
  return { from, to };
}

function wikiLinkBounds(state, node) {
  if (!node || node.name !== 'Link' || parentNameOf(node) === 'Image') {
    return null;
  }

  const fullForm = node.from + 1 < node.to
    && state.doc.sliceString(node.from, node.from + 2) === '[['
    && state.doc.sliceString(node.to - 2, node.to) === ']]';
  if (fullForm) {
    if (isEscapedPosition(state, node.from)) {
      return null;
    }
    return {
      openFrom: node.from,
      openTo: node.from + 2,
      closeFrom: node.to - 2,
      closeTo: node.to,
      contentFrom: node.from + 2,
      contentTo: node.to - 2
    };
  }

  if (node.from < 1 || node.to >= state.doc.length || isEscapedPosition(state, node.from - 1)) {
    return null;
  }
  const wrappedForm = state.doc.sliceString(node.from - 1, node.from + 1) === '[['
    && state.doc.sliceString(node.to - 1, node.to + 1) === ']]';
  if (!wrappedForm) {
    return null;
  }

  return {
    openFrom: node.from - 1,
    openTo: node.from + 1,
    closeFrom: node.to - 1,
    closeTo: node.to + 1,
    contentFrom: node.from + 1,
    contentTo: node.to - 1
  };
}

function wikiHrefFromTarget(target) {
  if (!target) {
    return '';
  }
  if (SCHEME_RE.test(target)) {
    return target;
  }
  return `${wikiLinkScheme}${encodeURIComponent(target)}`;
}

export function normalizeWikiTarget(target) {
  const normalized = (target ?? '').split('#', 1)[0]?.trim() ?? '';
  if (!normalized || SCHEME_RE.test(normalized)) {
    return '';
  }
  return normalized;
}

export function isWikiLinkNode(state, node) {
  return Boolean(wikiLinkBounds(state, node));
}

export function wikiMarkerRanges(state, node) {
  const bounds = wikiLinkBounds(state, node);
  if (!bounds) {
    return null;
  }
  return [
    { from: bounds.openFrom, to: bounds.openTo },
    { from: bounds.closeFrom, to: bounds.closeTo }
  ];
}

export function parseWikiLinkData(state, node) {
  const bounds = wikiLinkBounds(state, node);
  if (!bounds || bounds.contentFrom > bounds.contentTo) {
    return null;
  }

  const content = state.doc.sliceString(bounds.contentFrom, bounds.contentTo);
  const pipeOffset = content.indexOf('|');
  let target = trimRange(state, bounds.contentFrom, bounds.contentTo);
  let text = trimRange(state, bounds.contentFrom, bounds.contentTo);
  let hideFrom = -1;
  let hideTo = -1;

  if (pipeOffset >= 0) {
    const aliasFrom = bounds.contentFrom + pipeOffset + 1;
    const alias = trimRange(state, aliasFrom, bounds.contentTo);
    target = trimRange(state, bounds.contentFrom, bounds.contentFrom + pipeOffset);
    if (alias.from < alias.to) {
      text = alias;
      hideFrom = bounds.contentFrom;
      hideTo = alias.from;
    } else {
      text = target;
      hideFrom = bounds.contentFrom + pipeOffset;
      hideTo = bounds.contentTo;
    }
  }

  const hasTarget = target.from < target.to;
  const hasText = text.from < text.to;
  const rawTarget = hasTarget ? state.doc.sliceString(target.from, target.to).trim() : '';
  const localTarget = normalizeWikiTarget(rawTarget);

  return {
    href: hasTarget ? wikiHrefFromTarget(rawTarget) : '',
    localTarget,
    textFrom: hasText ? text.from : -1,
    textTo: hasText ? text.to : -1,
    hideFrom,
    hideTo,
    openFrom: bounds.openFrom,
    openTo: bounds.openTo,
    closeFrom: bounds.closeFrom,
    closeTo: bounds.closeTo
  };
}

export function getWikiLinkStatus(target) {
  if (!target) {
    return null;
  }
  if (!wikiLinkStatusByTarget.has(target)) {
    return null;
  }
  return wikiLinkStatusByTarget.get(target) === true;
}

export function replaceWikiLinkStatuses(entries) {
  wikiLinkStatusByTarget.clear();
  for (const entry of entries) {
    if (!entry || typeof entry.target !== 'string') {
      continue;
    }
    const target = entry.target.trim();
    if (!target) {
      continue;
    }
    wikiLinkStatusByTarget.set(target, entry.exists === true);
  }
}

const sourceWikiMarkerDeco = Decoration.mark({ class: 'meo-md-wiki-marker' });

function computeSourceWikiMarkers(state) {
  const builder = new RangeSetBuilder();
  const tree = resolvedSyntaxTree(state);

  tree.iterate({
    enter(node) {
      const ranges = wikiMarkerRanges(state, node);
      if (!ranges) {
        return;
      }
      for (const range of ranges) {
        builder.add(range.from, range.to, sourceWikiMarkerDeco);
      }
    }
  });

  return builder.finish();
}

export const sourceWikiMarkerField = StateField.define({
  create(state) {
    try {
      return computeSourceWikiMarkers(state);
    } catch {
      return Decoration.none;
    }
  },
  update(markers, transaction) {
    if (!transaction.docChanged) {
      return markers;
    }
    try {
      return computeSourceWikiMarkers(transaction.state);
    } catch {
      return markers;
    }
  },
  provide: (field) => EditorView.decorations.from(field)
});
