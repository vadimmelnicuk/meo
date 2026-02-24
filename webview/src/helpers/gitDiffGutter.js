import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { GutterMarker, gutter } from '@codemirror/view';
import {
  buildCurrentToBaselineLineMapFromLines,
  lcsDiffRuns,
  normalizeDiffLine,
  splitDiffLines
} from '../../../src/shared/gitDiffCore';

const MAX_DIFF_TEXT_CHARS = 1024 * 1024;
const MAX_DIFF_LINES = 1200;
const MAX_DIFF_CELLS = 1_500_000;

const setGitBaselineEffect = StateEffect.define();

const emptyBaseline = Object.freeze({
  available: false,
  tracked: false,
  baseText: null,
  baseLines: null
});

function normalizeBaselineSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return emptyBaseline;
  }
  const baseText = typeof snapshot.baseText === 'string' ? snapshot.baseText : snapshot.baseText === null ? null : null;
  return {
    available: snapshot.available === true,
    tracked: snapshot.tracked === true,
    headOid: typeof snapshot.headOid === 'string' ? snapshot.headOid : snapshot.headOid === null ? null : undefined,
    baseText,
    baseLines: typeof baseText === 'string' ? splitDiffLines(baseText) : null,
    reason: typeof snapshot.reason === 'string' ? snapshot.reason : undefined
  };
}

const gitBaselineField = StateField.define({
  create() {
    return emptyBaseline;
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setGitBaselineEffect)) {
        return normalizeBaselineSnapshot(effect.value);
      }
    }
    return value;
  }
});

class GitGutterMarker extends GutterMarker {
  constructor(flags) {
    super();
    this.flags = flags;
    this.key = JSON.stringify(flags);
  }

  eq(other) {
    return other instanceof GitGutterMarker && other.key === this.key;
  }

  toDOM() {
    const el = document.createElement('span');
    el.className = 'meo-git-gutter-marker';
    if (this.flags.eofProxy) {
      el.classList.add('is-eof-proxy');
    }

    if (this.flags.added) {
      el.classList.add('is-added');
    }
    if (this.flags.modified) {
      el.classList.add('is-modified');
    }

    if (!this.flags.added && !this.flags.modified) {
      el.classList.add('is-empty');
    }

    const stripe = document.createElement('span');
    stripe.className = 'meo-git-gutter-stripe';
    el.appendChild(stripe);

    return el;
  }
}

class GitGutterSpacerMarker extends GutterMarker {
  toDOM() {
    const el = document.createElement('span');
    el.className = 'meo-git-gutter-marker meo-git-gutter-spacer';
    return el;
  }
}

const markerCache = new Map();
const spacerMarker = new GitGutterSpacerMarker();

function gitMarker(flags) {
  const key = JSON.stringify(flags);
  let marker = markerCache.get(key);
  if (!marker) {
    marker = new GitGutterMarker(flags);
    markerCache.set(key, marker);
  }
  return marker;
}

function getDocLines(doc) {
  const lines = new Array(doc.lines);
  for (let i = 1; i <= doc.lines; i += 1) {
    const line = doc.line(i);
    lines[i - 1] = normalizeDiffLine(doc.sliceString(line.from, line.to));
  }
  return lines;
}

function isTrailingEofVisualLine(doc, lineNo) {
  if (!doc || doc.length <= 0 || doc.lines <= 1 || lineNo !== doc.lines) {
    return false;
  }
  const lastLine = doc.line(doc.lines);
  return lastLine.from === lastLine.to;
}

function coalesceTrailingEofVisualLineFlag(doc, lineFlags) {
  if (!Array.isArray(lineFlags) || !isTrailingEofVisualLine(doc, doc.lines) || doc.lines < 2) {
    return lineFlags;
  }

  const trailingIndex = doc.lines - 1;
  const previousIndex = trailingIndex - 1;
  const trailingFlags = lineFlags[trailingIndex];
  if (!trailingFlags) {
    return lineFlags;
  }

  const previousFlags = lineFlags[previousIndex] ?? emptyMarkerFlags();
  const previousHadChange = !!(previousFlags.added || previousFlags.modified);
  if (trailingFlags.modified) {
    previousFlags.modified = true;
  }
  if (trailingFlags.added) {
    if (previousFlags.added) {
      previousFlags.added = true;
    } else if (!previousHadChange && !trailingFlags.modified) {
      // Pure newline-at-EOF insertion: keep the previous committed line visually
      // clean and render the change on the explicit EOF proxy row instead.
      previousFlags.trailingEofProxyOnly = true;
    } else {
      // A newline-at-EOF change is represented by CodeMirror as a synthetic empty
      // line insertion, but visually it belongs to the previous real line.
      previousFlags.modified = true;
    }
  }
  previousFlags.trailingEofProxySource = true;
  lineFlags[previousIndex] = previousFlags;
  lineFlags[trailingIndex] = undefined;
  return lineFlags;
}

function emptyMarkerFlags() {
  return {
    added: false,
    modified: false
  };
}

function buildLineFlagsFromRuns(runs, currentLineCount) {
  const lineFlags = new Array(currentLineCount);
  if (!runs) {
    return lineFlags;
  }

  let currentLineNo = 1;

  for (let i = 0; i < runs.length; i += 1) {
    const run = runs[i];
    if (run.type === 'equal') {
      currentLineNo += run.count;
      continue;
    }

    if (run.type === 'insert') {
      const next = runs[i + 1];
      if (next?.type === 'delete') {
        const pairCount = Math.min(run.count, next.count);
        for (let offset = 0; offset < pairCount; offset += 1) {
          const index = currentLineNo - 1 + offset;
          if (index < 0 || index >= currentLineCount) {
            continue;
          }
          const flags = lineFlags[index] ?? (lineFlags[index] = emptyMarkerFlags());
          flags.modified = true;
        }
        for (let offset = pairCount; offset < run.count; offset += 1) {
          const index = currentLineNo - 1 + offset;
          if (index < 0 || index >= currentLineCount) {
            continue;
          }
          const flags = lineFlags[index] ?? (lineFlags[index] = emptyMarkerFlags());
          flags.added = true;
        }
        currentLineNo += run.count;
        i += 1;
        continue;
      }

      for (let offset = 0; offset < run.count; offset += 1) {
        const index = currentLineNo - 1 + offset;
        if (index < 0 || index >= currentLineCount) {
          continue;
        }
        const flags = lineFlags[index] ?? (lineFlags[index] = emptyMarkerFlags());
        flags.added = true;
      }
      currentLineNo += run.count;
      continue;
    }

    if (run.type === 'delete') {
      const next = runs[i + 1];
      if (next?.type === 'insert') {
        const pairCount = Math.min(run.count, next.count);
        for (let offset = 0; offset < pairCount; offset += 1) {
          const index = currentLineNo - 1 + offset;
          if (index < 0 || index >= currentLineCount) {
            continue;
          }
          const flags = lineFlags[index] ?? (lineFlags[index] = emptyMarkerFlags());
          flags.modified = true;
        }
        for (let offset = pairCount; offset < next.count; offset += 1) {
          const index = currentLineNo - 1 + offset;
          if (index < 0 || index >= currentLineCount) {
            continue;
          }
          const flags = lineFlags[index] ?? (lineFlags[index] = emptyMarkerFlags());
          flags.added = true;
        }
        currentLineNo += next.count;
        i += 1;
        continue;
      }

      // Pure deletions have no current line to annotate in the gutter.
    }
  }

  return lineFlags;
}

function buildLineFlagsFromMapping(baseLines, currentLines, mapping) {
  const lineFlags = new Array(currentLines.length);
  if (!mapping) {
    return lineFlags;
  }

  for (let lineNo = 1; lineNo <= currentLines.length; lineNo += 1) {
    const mappedBaseLineNo = mapping[lineNo] ?? 0;
    if (mappedBaseLineNo <= 0) {
      lineFlags[lineNo - 1] = { ...emptyMarkerFlags(), added: true };
      continue;
    }

    const baseText = baseLines[mappedBaseLineNo - 1];
    const currentText = currentLines[lineNo - 1];
    if (baseText === currentText) {
      continue;
    }
    lineFlags[lineNo - 1] = { ...emptyMarkerFlags(), modified: true };
  }

  return lineFlags;
}

function buildDiffLineFlags(state, baseline) {
  if (!baseline?.available) {
    return null;
  }

  if (typeof baseline.baseText !== 'string') {
    if (!baseline.tracked || baseline.headOid === null) {
      const lineFlags = new Array(state.doc.lines);
      const textLength = state.doc.length;
      if (!textLength && state.doc.lines === 1 && state.doc.sliceString(0, state.doc.length) === '') {
        return lineFlags;
      }
      for (let i = 0; i < state.doc.lines; i += 1) {
        lineFlags[i] = { ...emptyMarkerFlags(), added: true };
      }
      return lineFlags;
    }
    return null;
  }

  if (state.doc.length > MAX_DIFF_TEXT_CHARS || baseline.baseText.length > MAX_DIFF_TEXT_CHARS) {
    return null;
  }

  const baseLines = Array.isArray(baseline.baseLines) ? baseline.baseLines : splitDiffLines(baseline.baseText);
  const currentLines = getDocLines(state.doc);
  const mapping = buildCurrentToBaselineLineMapFromLines(baseLines, currentLines, {
    maxLines: MAX_DIFF_LINES,
    maxCells: MAX_DIFF_CELLS
  });
  if (mapping) {
    return buildLineFlagsFromMapping(baseLines, currentLines, mapping);
  }
  const runs = lcsDiffRuns(baseLines, currentLines, {
    maxLines: MAX_DIFF_LINES,
    maxCells: MAX_DIFF_CELLS
  });
  if (!runs) {
    return null;
  }

  return buildLineFlagsFromRuns(runs, currentLines.length);
}

function buildCoalescedDiffLineFlags(state, baseline) {
  return coalesceTrailingEofVisualLineFlag(state.doc, buildDiffLineFlags(state, baseline));
}

function buildGitGutterMarkersFromLineFlags(state, lineFlags) {
  const builder = new RangeSetBuilder();
  if (!lineFlags) {
    return builder.finish();
  }
  const trailingEofProxyFlags = (
    isTrailingEofVisualLine(state.doc, state.doc.lines) && state.doc.lines > 1
      ? (() => {
          const prevFlags = lineFlags[state.doc.lines - 2];
          if (!prevFlags || (!prevFlags.added && !prevFlags.modified)) {
            if (!prevFlags?.trailingEofProxyOnly) {
              return null;
            }
          }
          // Preferred path: explicitly tagged by EOF-row coalescing. Fallback path:
          // if the last real line is changed and the document has a synthetic EOF row,
          // mirror a proxy marker there so hover/click has a concrete DOM target.
          if (!prevFlags.trailingEofProxySource && lineFlags[state.doc.lines - 1]) {
            return null;
          }
          return {
            added: prevFlags.trailingEofProxyOnly ? false : !!prevFlags.added,
            modified: prevFlags.trailingEofProxyOnly ? true : !!prevFlags.modified,
            eofProxy: true
          };
        })()
      : null
  );

  for (let lineNo = 1; lineNo <= state.doc.lines; lineNo += 1) {
    if (isTrailingEofVisualLine(state.doc, lineNo)) {
      if (trailingEofProxyFlags) {
        const line = state.doc.line(lineNo);
        builder.add(line.from, line.from, gitMarker(trailingEofProxyFlags));
      }
      continue;
    }
    const flags = lineFlags[lineNo - 1];
    if (!flags) {
      continue;
    }
    if (flags.trailingEofProxyOnly) {
      continue;
    }
    const line = state.doc.line(lineNo);
    builder.add(line.from, line.from, gitMarker(flags));
  }

  return builder.finish();
}

const gitDiffLineFlagsField = StateField.define({
  create(state) {
    return buildCoalescedDiffLineFlags(state, state.field(gitBaselineField));
  },
  update(value, tr) {
    let baselineChanged = false;
    for (const effect of tr.effects) {
      if (effect.is(setGitBaselineEffect)) {
        baselineChanged = true;
        break;
      }
    }
    if (!tr.docChanged && !baselineChanged) {
      return value;
    }
    const baseline = tr.state.field(gitBaselineField);
    return buildCoalescedDiffLineFlags(tr.state, baseline);
  }
});

const gitDiffGutterField = StateField.define({
  create(state) {
    return buildGitGutterMarkersFromLineFlags(state, state.field(gitDiffLineFlagsField));
  },
  update(value, tr) {
    let baselineChanged = false;
    for (const effect of tr.effects) {
      if (effect.is(setGitBaselineEffect)) {
        baselineChanged = true;
        break;
      }
    }
    if (!tr.docChanged && !baselineChanged) {
      return value;
    }
    return buildGitGutterMarkersFromLineFlags(tr.state, tr.state.field(gitDiffLineFlagsField));
  }
});

const gitDiffGutterExtension = gutter({
  class: 'meo-git-gutter',
  renderEmptyElements: true,
  initialSpacer() {
    return spacerMarker;
  },
  markers(view) {
    return view.state.field(gitDiffGutterField);
  }
});

const gitGutterPlaceholderExtension = gutter({
  class: 'meo-git-gutter',
  initialSpacer() {
    return spacerMarker;
  }
});

export function gitDiffGutterBaselineExtensions() {
  return [gitBaselineField, gitDiffLineFlagsField];
}

export function gitDiffGutterRenderExtensions() {
  return [gitDiffGutterField, gitDiffGutterExtension];
}

export function gitDiffGutterPlaceholderExtensions() {
  return [gitGutterPlaceholderExtension];
}

export function gitDiffGutterExtensions() {
  return [...gitDiffGutterBaselineExtensions(), ...gitDiffGutterRenderExtensions()];
}

export function getGitDiffOverviewSegments(state) {
  const lineFlags = state.field(gitDiffLineFlagsField, false);
  if (!Array.isArray(lineFlags) || !lineFlags.length) {
    return [];
  }

  const segments = [];
  let active = null;

  const flush = () => {
    if (!active) {
      return;
    }
    segments.push(active);
    active = null;
  };

  for (let lineNo = 1; lineNo <= lineFlags.length; lineNo += 1) {
    const flags = lineFlags[lineNo - 1];
    const added = !!flags?.added;
    const modified = !!flags?.modified || !!flags?.trailingEofProxyOnly;
    if (!added && !modified) {
      flush();
      continue;
    }

    if (
      active &&
      active.toLine + 1 === lineNo &&
      active.added === added &&
      active.modified === modified
    ) {
      active.toLine = lineNo;
      continue;
    }

    flush();
    active = { fromLine: lineNo, toLine: lineNo, added, modified };
  }

  flush();
  return segments;
}

export function setGitBaseline(view, snapshot) {
  view.dispatch({
    effects: setGitBaselineEffect.of(snapshot)
  });
}
