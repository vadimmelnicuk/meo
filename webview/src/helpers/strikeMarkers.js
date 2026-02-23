import { StateField, RangeSetBuilder } from '@codemirror/state';
import { EditorView, Decoration } from '@codemirror/view';
import { resolvedSyntaxTree } from './markdownSyntax';

function isEscaped(text, index) {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

export function collectStrikethroughRanges(tree) {
  const ranges = [];
  tree.iterate({
    enter(node) {
      if (node.name === 'Strikethrough') {
        ranges.push({ from: node.from, to: node.to });
      }
    }
  });
  return ranges;
}

export function collectSingleTildeStrikePairs(state, strikeRanges = []) {
  const pairs = [];
  let overlapIndex = 0;

  for (let lineNo = 1; lineNo <= state.doc.lines; lineNo += 1) {
    const line = state.doc.line(lineNo);
    const text = line.text;
    if (!text.includes('~')) {
      continue;
    }
    let index = 0;

    while (index < text.length) {
      if (text[index] !== '~' || isEscaped(text, index)) {
        index += 1;
        continue;
      }
      if (text[index - 1] === '~' || text[index + 1] === '~') {
        index += 1;
        continue;
      }

      let close = -1;
      for (let i = index + 1; i < text.length; i += 1) {
        if (text[i] !== '~' || isEscaped(text, i)) {
          continue;
        }
        if (text[i - 1] === '~' || text[i + 1] === '~') {
          continue;
        }
        close = i;
        break;
      }

      if (close === -1 || close <= index + 1) {
        index += 1;
        continue;
      }

      const strikeFrom = line.from + index + 1;
      const strikeTo = line.from + close;
      while (overlapIndex < strikeRanges.length && strikeRanges[overlapIndex].to <= strikeFrom) {
        overlapIndex += 1;
      }

      let overlaps = false;
      for (let i = overlapIndex; i < strikeRanges.length; i += 1) {
        const range = strikeRanges[i];
        if (range.from >= strikeTo) {
          break;
        }
        if (strikeFrom < range.to && strikeTo > range.from) {
          overlaps = true;
          break;
        }
      }

      if (!overlaps) {
        pairs.push({
          lineNo,
          openFrom: line.from + index,
          openTo: line.from + index + 1,
          closeFrom: line.from + close,
          closeTo: line.from + close + 1,
          strikeFrom,
          strikeTo
        });
      }

      index = close + 1;
    }
  }

  return pairs;
}

const sourceStrikeMarkerDeco = Decoration.mark({ class: 'meo-md-strike-marker' });

function computeSourceStrikeMarkers(state) {
  const ranges = new RangeSetBuilder();
  const tree = resolvedSyntaxTree(state);
  const strikeRanges = collectStrikethroughRanges(tree);
  tree.iterate({
    enter(node) {
      if (node.name !== 'StrikethroughMark') {
        return;
      }
      ranges.add(node.from, node.to, sourceStrikeMarkerDeco);
    }
  });

  const pairs = collectSingleTildeStrikePairs(state, strikeRanges);
  for (const pair of pairs) {
    ranges.add(pair.openFrom, pair.openTo, sourceStrikeMarkerDeco);
    ranges.add(pair.closeFrom, pair.closeTo, sourceStrikeMarkerDeco);
  }

  return ranges.finish();
}

export const sourceStrikeMarkerField = StateField.define({
  create(state) {
    try {
      return computeSourceStrikeMarkers(state);
    } catch {
      return Decoration.none;
    }
  },
  update(markers, transaction) {
    if (!transaction.docChanged) {
      return markers;
    }
    try {
      return computeSourceStrikeMarkers(transaction.state);
    } catch {
      return markers;
    }
  },
  provide: (field) => EditorView.decorations.from(field)
});
