import { RangeSetBuilder, StateField } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting } from '@codemirror/language';
import { Decoration, EditorView, GutterMarker, gutterLineClass } from '@codemirror/view';
import {
  resolveCodeLanguage,
  isFenceMarker,
  getFencedCodeInfo,
  addFenceOpeningLineMarker,
  addMermaidDiagram,
  addCopyCodeButton
} from './helpers/codeBlocks';
import { highlightStyle } from './theme';
import { collectSingleTildeStrikePairs, collectStrikethroughRanges } from './helpers/strikeMarkers';
import { headingLevelFromName, resolvedSyntaxTree } from './helpers/markdownSyntax';
import { orderedListDisplayIndex, addListMarkerDecoration } from './helpers/listMarkers';
import { addTableDecorations, addTableDecorationsForLineRange, isTableDelimiterLine, parseTableInfo } from './helpers/tables';

const markerDeco = Decoration.mark({ class: 'meo-md-marker' });
const activeLineMarkerDeco = Decoration.mark({ class: 'meo-md-marker-active' });
const strikeMarkerDeco = Decoration.mark({ class: 'meo-md-marker meo-md-strike-marker' });
const activeStrikeMarkerDeco = Decoration.mark({ class: 'meo-md-marker-active meo-md-strike-marker-active' });
const fenceMarkerDeco = Decoration.mark({ class: 'meo-md-fence-marker' });
const hrMarkerDeco = Decoration.mark({ class: 'meo-md-hr-marker' });
const tableDelimiterGutterLineClassMarker = new class extends GutterMarker {
  get elementClass() {
    return 'meo-md-hide-line-number';
  }
}();
const isTableContentLine = (lineText) => lineText.includes('|');

const lineStyleDecos = {
  h1: Decoration.line({ class: 'meo-md-h1' }),
  h2: Decoration.line({ class: 'meo-md-h2' }),
  h3: Decoration.line({ class: 'meo-md-h3' }),
  h4: Decoration.line({ class: 'meo-md-h4' }),
  h5: Decoration.line({ class: 'meo-md-h5' }),
  h6: Decoration.line({ class: 'meo-md-h6' }),
  quote: Decoration.line({ class: 'meo-md-quote' }),
  codeBlock: Decoration.line({ class: 'meo-md-code-block' }),
  list: Decoration.line({ class: 'meo-md-list-line' }),
  hr: Decoration.line({ class: 'meo-md-hr' })
};

const inlineStyleDecos = {
  em: Decoration.mark({ class: 'meo-md-em' }),
  strong: Decoration.mark({ class: 'meo-md-strong' }),
  strike: Decoration.mark({ class: 'meo-md-strike' }),
  inlineCode: Decoration.mark({ class: 'meo-md-inline-code' }),
  link: Decoration.mark({ class: 'meo-md-link' })
};

function addRange(builder, from, to, deco) {
  if (to <= from) {
    return;
  }
  builder.push(deco.range(from, to));
}

function addSingleTildeStrikeDecorations(builder, state, activeLines, existingStrikeRanges) {
  const pairs = collectSingleTildeStrikePairs(state, existingStrikeRanges);
  for (const pair of pairs) {
    addRange(builder, pair.strikeFrom, pair.strikeTo, inlineStyleDecos.strike);
    const markerDecoToUse = activeLines.has(pair.lineNo) ? activeStrikeMarkerDeco : strikeMarkerDeco;
    addRange(builder, pair.openFrom, pair.openTo, markerDecoToUse);
    addRange(builder, pair.closeFrom, pair.closeTo, markerDecoToUse);
  }
}

function collectActiveLines(state) {
  const lines = new Set();
  for (const range of state.selection.ranges) {
    // In live mode, only reveal markdown markers on the focused line.
    const focusLine = state.doc.lineAt(range.head).number;
    lines.add(focusLine);
  }
  return lines;
}

function addLineClass(builder, state, from, to, deco) {
  const startLine = state.doc.lineAt(from).number;
  const endLine = state.doc.lineAt(Math.max(from, to - 1)).number;
  for (let lineNo = startLine; lineNo <= endLine; lineNo += 1) {
    const line = state.doc.line(lineNo);
    builder.push(deco.range(line.from));
  }
}

function shouldSuppressTransientSetextHeading(state, node, activeLines) {
  const underlineLine = state.doc.lineAt(Math.max(node.to - 1, node.from));
  if (!activeLines.has(underlineLine.number)) {
    return false;
  }

  const underlineText = state.doc.sliceString(underlineLine.from, underlineLine.to);
  return /^[ \t]{0,3}-[ \t]*$/.test(underlineText);
}

function addAtxHeadingPrefixMarkers(builder, state, from, activeLines) {
  const line = state.doc.lineAt(from);
  const text = state.doc.sliceString(line.from, line.to);
  const match = /^(#{1,6}[ \t]+)/.exec(text);
  if (!match) {
    return;
  }

  const prefixTo = line.from + match[1].length;
  if (activeLines.has(line.number)) {
    addRange(builder, line.from, prefixTo, activeLineMarkerDeco);
    return;
  }
  addRange(builder, line.from, prefixTo, markerDeco);
}

function buildDecorations(state) {
  const ranges = [];
  const activeLines = collectActiveLines(state);
  const tree = resolvedSyntaxTree(state);
  const orderedListItemCounts = new Map();
  const strikeRanges = collectStrikethroughRanges(tree);
  const parsedTableRanges = [];
  let tableDepth = 0;

  tree.iterate({
    enter: (node) => {
      if (node.name === 'Table') {
        tableDepth += 1;
      }

      if (node.name === 'OrderedList') {
        orderedListItemCounts.set(node.from, 0);
      }

      const headingLevel = headingLevelFromName(node.name);
      if (headingLevel !== null) {
        if (tableDepth === 0) {
          addAtxHeadingPrefixMarkers(ranges, state, node.from, activeLines);
          addLineClass(ranges, state, node.from, node.to, lineStyleDecos[`h${headingLevel}`]);
        }
      }

      if (node.name === 'SetextHeading1') {
        if (tableDepth === 0) {
          addLineClass(ranges, state, node.from, node.to, lineStyleDecos.h1);
        }
      } else if (node.name === 'SetextHeading2') {
        if (tableDepth === 0 && !shouldSuppressTransientSetextHeading(state, node, activeLines)) {
          addLineClass(ranges, state, node.from, node.to, lineStyleDecos.h2);
        }
      } else if (node.name === 'HorizontalRule') {
        addLineClass(ranges, state, node.from, node.to, lineStyleDecos.hr);
        if (activeLines.has(state.doc.lineAt(node.from).number)) {
          addRange(ranges, node.from, node.to, activeLineMarkerDeco);
        } else {
          addRange(ranges, node.from, node.to, hrMarkerDeco);
        }
      } else if (node.name === 'Blockquote') {
        addLineClass(ranges, state, node.from, node.to, lineStyleDecos.quote);
      } else if (node.name === 'Table') {
        const tableInfo = parseTableInfo(state, node);
        parsedTableRanges.push({ from: tableInfo.from, to: tableInfo.to });
        addTableDecorations(ranges, state, node);
      } else if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
        addLineClass(ranges, state, node.from, node.to, lineStyleDecos.codeBlock);
        if (node.name === 'FencedCode') {
          addFenceOpeningLineMarker(
            ranges,
            state,
            node.from,
            activeLines,
            addRange,
            activeLineMarkerDeco,
            fenceMarkerDeco
          );
          
          const codeInfo = getFencedCodeInfo(state, node);
          if (codeInfo === 'mermaid') {
            addMermaidDiagram(ranges, state, node);
            return;
          }
        }
        addCopyCodeButton(ranges, state, node.from, node.to);
      } else if (
        node.name === 'ListItem' ||
        node.name === 'BulletList' ||
        node.name === 'OrderedList'
      ) {
        addLineClass(ranges, state, node.from, node.to, lineStyleDecos.list);
        if (node.name === 'ListItem') {
          const orderedDisplayIndex = orderedListDisplayIndex(node, orderedListItemCounts);
          addListMarkerDecoration(ranges, state, node.from, orderedDisplayIndex);
        }
      }

      if (node.name === 'Emphasis') {
        addRange(ranges, node.from, node.to, inlineStyleDecos.em);
      } else if (node.name === 'StrongEmphasis') {
        addRange(ranges, node.from, node.to, inlineStyleDecos.strong);
      } else if (node.name === 'Strikethrough') {
        addRange(ranges, node.from, node.to, inlineStyleDecos.strike);
      } else if (node.name === 'InlineCode' || node.name === 'CodeText') {
        addRange(ranges, node.from, node.to, inlineStyleDecos.inlineCode);
      } else if (node.name === 'Link' || node.name === 'URL' || node.name === 'Autolink') {
        addRange(ranges, node.from, node.to, inlineStyleDecos.link);
      }

      if (!node.name.endsWith('Mark')) {
        return;
      }

      const line = state.doc.lineAt(node.from);
      if (tableDepth > 0 && (node.name === 'HeaderMark' || node.name === 'SetextHeadingMark')) {
        return;
      }
      if (isFenceMarker(state, node.from, node.to)) {
        // Show fence markers on all lines (not just active)
        if (activeLines.has(line.number)) {
          addRange(ranges, node.from, node.to, activeLineMarkerDeco);
        } else {
          addRange(ranges, node.from, node.to, fenceMarkerDeco);
        }
      } else if (node.name === 'StrikethroughMark') {
        if (activeLines.has(line.number)) {
          addRange(ranges, node.from, node.to, activeStrikeMarkerDeco);
        } else {
          addRange(ranges, node.from, node.to, strikeMarkerDeco);
        }
      } else if (activeLines.has(line.number)) {
        addRange(ranges, node.from, node.to, activeLineMarkerDeco);
      } else {
        addRange(ranges, node.from, node.to, markerDeco);
      }
    },
    leave: (node) => {
      if (node.name === 'Table') {
        tableDepth -= 1;
      }
    },
  });

  addFallbackTableDecorations(ranges, state, tree, parsedTableRanges);
  addSingleTildeStrikeDecorations(ranges, state, activeLines, strikeRanges);

  const result = Decoration.set(ranges, true);
  return result;
}

const liveDecorationField = StateField.define({
  create(state) {
    return buildDecorations(state);
  },
  update(decorations, transaction) {
    // Recompute on every transaction so live mode stays in sync with parser updates
    // that may arrive without direct doc/selection changes.
    const next = buildDecorations(transaction.state);

    // Guard against transient empty parse results on selection-only transactions.
    if (!transaction.docChanged && isEmptyDecorationSet(next) && !isEmptyDecorationSet(decorations)) {
      return decorations;
    }

    return next;
  },
  provide: (field) => EditorView.decorations.from(field)
});

function buildLiveLineNumberMarkers(state) {
  const builder = new RangeSetBuilder();
  const tableBlocks = detectTableBlocks(state);
  for (const block of tableBlocks) {
    for (let lineNo = block.startLineNo; lineNo <= block.endLineNo; lineNo += 1) {
      const line = state.doc.line(lineNo);
      builder.add(line.from, line.from, tableDelimiterGutterLineClassMarker);
    }
  }
  return builder.finish();
}

function detectTableBlocks(state) {
  const blocks = [];
  for (let lineNo = 2; lineNo <= state.doc.lines; lineNo += 1) {
    const delimiterLine = state.doc.line(lineNo);
    const delimiterText = state.doc.sliceString(delimiterLine.from, delimiterLine.to);
    if (!isTableDelimiterLine(delimiterText)) continue;

    const headerLineNo = lineNo - 1;
    const headerLine = state.doc.line(headerLineNo);
    const headerText = state.doc.sliceString(headerLine.from, headerLine.to);
    if (!isTableContentLine(headerText)) continue;

    let endLineNo = lineNo;
    for (let rowLineNo = lineNo + 1; rowLineNo <= state.doc.lines; rowLineNo += 1) {
      const rowLine = state.doc.line(rowLineNo);
      const rowText = state.doc.sliceString(rowLine.from, rowLine.to);
      if (!isTableContentLine(rowText)) break;
      endLineNo = rowLineNo;
    }

    blocks.push({ startLineNo: headerLineNo, endLineNo });
    lineNo = endLineNo;
  }
  return blocks;
}

function addFallbackTableDecorations(builder, state, tree, parsedTableRanges) {
  const tableBlocks = detectTableBlocks(state);
  for (const block of tableBlocks) {
    const from = state.doc.line(block.startLineNo).from;
    const to = state.doc.line(block.endLineNo).to;
    if (overlapsParsedTableRange(from, to, parsedTableRanges)) continue;
    if (isInsideCodeBlock(tree, from)) continue;
    addTableDecorationsForLineRange(builder, state, block.startLineNo, block.endLineNo);
  }
}

function overlapsParsedTableRange(from, to, ranges) {
  return ranges.some((range) => from < range.to && to > range.from);
}

function isInsideCodeBlock(tree, pos) {
  let node = tree.resolveInner(pos, 1);
  while (node) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') return true;
    node = node.parent;
  }
  return false;
}

const liveLineNumberMarkerField = StateField.define({
  create(state) {
    return buildLiveLineNumberMarkers(state);
  },
  update(markers, transaction) {
    if (!transaction.docChanged) {
      return markers;
    }
    return buildLiveLineNumberMarkers(transaction.state);
  },
  provide: (field) => gutterLineClass.from(field)
});

export function liveModeExtensions() {
  return [
    markdown({ base: markdownLanguage, addKeymap: false, codeLanguages: resolveCodeLanguage }),
    syntaxHighlighting(highlightStyle),
    liveDecorationField,
    liveLineNumberMarkerField
  ];
}

function isEmptyDecorationSet(set) {
  const cursor = set.iter();
  return cursor.value === null;
}
