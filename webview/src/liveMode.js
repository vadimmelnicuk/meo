import { RangeSetBuilder, StateField } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting } from '@codemirror/language';
import { Decoration, EditorView, GutterMarker, WidgetType, gutterLineClass } from '@codemirror/view';
import { createElement, AlertCircle, Delete } from 'lucide';
import {
  resolveCodeLanguage,
  isFenceMarker,
  getFencedCodeInfo,
  addFenceOpeningLineMarker,
  addCodeLanguageLabel,
  addMermaidDiagram,
  addCopyCodeButton
} from './helpers/codeBlocks';
import { ImageWidget, getImageData, isImageUrl } from './helpers/images';
import { highlightStyle } from './theme';
import { collectSingleTildeStrikePairs, collectStrikethroughRanges } from './helpers/strikeMarkers';
import { headingLevelFromName, resolvedSyntaxTree } from './helpers/markdownSyntax';
import {
  getCollapsedHeadingSections,
  headingCollapseLiveExtensions
} from './helpers/headingCollapse';
import { addListMarkerDecoration, listMarkerData, detectListIndentStylesByLine } from './helpers/listMarkers';
import { addTableDecorations, addTableDecorationsForLineRange, isTableDelimiterLine, parseTableInfo } from './helpers/tables';
import {
  forEachYamlFrontmatterField,
  parseFrontmatter,
  isInsideFrontmatter,
  isInsideFrontmatterContent,
  isThematicBreakLine
} from './helpers/frontmatter';
import { isWikiLinkNode, parseWikiLinkData, getWikiLinkStatus } from './helpers/wikiLinks';

const markerDeco = Decoration.mark({ class: 'meo-md-marker' });
const activeLineMarkerDeco = Decoration.mark({ class: 'meo-md-marker-active' });
const linkMarkerDeco = Decoration.mark({ class: 'meo-md-marker meo-md-link-marker' });
const activeLinkMarkerDeco = Decoration.mark({ class: 'meo-md-marker-active meo-md-link-marker-active' });
const wikiLinkMarkerDeco = Decoration.mark({ class: 'meo-md-marker meo-md-link-marker meo-md-wiki-marker' });
const activeWikiLinkMarkerDeco = Decoration.mark({ class: 'meo-md-marker-active meo-md-link-marker-active meo-md-wiki-marker' });
const emptyWikiLinkMarkerDeco = Decoration.mark({ class: 'meo-md-marker meo-md-link-marker meo-md-wiki-marker meo-md-wiki-empty-marker' });
const strikeMarkerDeco = Decoration.mark({ class: 'meo-md-marker meo-md-strike-marker' });
const activeStrikeMarkerDeco = Decoration.mark({ class: 'meo-md-marker-active meo-md-strike-marker-active' });
const codeMarkerDeco = Decoration.mark({ class: 'meo-md-code-marker' });
const activeCodeMarkerDeco = Decoration.mark({ class: 'meo-md-code-marker-active' });
const fenceMarkerDeco = Decoration.mark({ class: 'meo-md-fence-marker' });
const hrMarkerDeco = Decoration.mark({ class: 'meo-md-hr-marker' });
const hiddenLinkUrlDeco = Decoration.mark({ class: 'meo-md-link-url-hidden' });
const collapsedHeadingBodyDeco = Decoration.replace({
  inclusiveStart: false,
  inclusiveEnd: false
});
const collapsedHeadingLineDeco = Decoration.line({ class: 'meo-md-heading-collapsed' });
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
  frontmatterContent: Decoration.line({ class: 'meo-md-frontmatter-content' }),
  frontmatterBoundary: Decoration.line({ class: 'meo-md-hr meo-md-frontmatter-boundary' }),
  hrActive: Decoration.line({ class: 'meo-md-hr-active' }),
  hr: Decoration.line({ class: 'meo-md-hr' })
};
const frontmatterKeyDeco = Decoration.mark({ class: 'meo-md-frontmatter-key' });
const frontmatterValueDeco = Decoration.mark({ class: 'meo-md-frontmatter-value' });

const listLineDecoCache = new Map();
const listIndentWidgetCache = new Map();

class ListIndentWidget extends WidgetType {
  constructor(indentColumns) {
    super();
    this.indentColumns = indentColumns;
  }

  eq(other) {
    return other instanceof ListIndentWidget && other.indentColumns === this.indentColumns;
  }

  toDOM() {
    const spacer = document.createElement('span');
    spacer.className = 'meo-md-list-indent-spacer';
    spacer.style.width = `${Math.max(0, this.indentColumns)}ch`;
    return spacer;
  }
}

function listIndentWidget(indentColumns) {
  const normalized = Math.max(0, Math.round(indentColumns));
  let widget = listIndentWidgetCache.get(normalized);
  if (widget) {
    return widget;
  }
  widget = new ListIndentWidget(normalized);
  listIndentWidgetCache.set(normalized, widget);
  return widget;
}

function listLineDeco(
  contentOffsetColumns,
  indentColumns,
  guideStepColumns = 2,
  selected = false,
  isTask = false,
  taskHiddenPrefixColumns = 0
) {
  const offset = Math.max(0, contentOffsetColumns);
  const indent = Math.max(0, indentColumns);
  const guideStep = Math.max(2, guideStepColumns);
  const hiddenTaskPrefix = Math.max(0, taskHiddenPrefixColumns);
  const key = `${offset}:${indent}:${guideStep}:${selected ? 1 : 0}:${isTask ? 1 : 0}:${hiddenTaskPrefix}`;
  let deco = listLineDecoCache.get(key);
  if (deco) {
    return deco;
  }

  const classes = ['meo-md-list-line'];
  if (selected) {
    classes.push('meo-md-list-line-selected');
  }
  if (isTask) {
    classes.push('meo-md-list-line-task');
  }

  deco = Decoration.line({
    class: classes.join(' '),
    attributes: {
      style: `--meo-list-hanging-indent:${offset}ch;--meo-list-indent-columns:${indent}ch;--meo-list-guide-step:${guideStep}ch;--meo-task-hidden-prefix-columns:${hiddenTaskPrefix}ch;`
    }
  });
  listLineDecoCache.set(key, deco);
  return deco;
}

const inlineStyleDecos = {
  em: Decoration.mark({ class: 'meo-md-em' }),
  strong: Decoration.mark({ class: 'meo-md-strong' }),
  strike: Decoration.mark({ class: 'meo-md-strike' }),
  inlineCode: Decoration.mark({ class: 'meo-md-inline-code' })
};

function addFrontmatterBoundaryDecorations(builder, state, frontmatter, activeLines) {
  if (frontmatter.contentTo > frontmatter.contentFrom) {
    addLineClass(builder, state, frontmatter.contentFrom, frontmatter.contentTo, lineStyleDecos.frontmatterContent);
    forEachYamlFrontmatterField(state, frontmatter, ({ keyFrom, keyTo, valueFrom, valueTo }) => {
      addRange(builder, keyFrom, keyTo, frontmatterKeyDeco);
      if (valueFrom !== null && valueFrom < valueTo) {
        addRange(builder, valueFrom, valueTo, frontmatterValueDeco);
      }
    });
  }

  const boundaries = [
    { from: frontmatter.openingFrom, to: frontmatter.openingTo },
    { from: frontmatter.closingFrom, to: frontmatter.closingTo }
  ];

  for (const boundary of boundaries) {
    addLineClass(builder, state, boundary.from, boundary.to, lineStyleDecos.frontmatterBoundary);
    const lineNo = state.doc.lineAt(boundary.from).number;
    if (activeLines.has(lineNo)) {
      addLineClass(builder, state, boundary.from, boundary.to, lineStyleDecos.hrActive);
      addRange(builder, boundary.from, boundary.to, activeLineMarkerDeco);
    } else {
      addRange(builder, boundary.from, boundary.to, markerDeco);
    }
  }
}

function addThematicBreakDecorations(builder, state, from, to, activeLines) {
  addLineClass(builder, state, from, to, lineStyleDecos.hr);
  const lineNo = state.doc.lineAt(from).number;
  if (activeLines.has(lineNo)) {
    addLineClass(builder, state, from, to, lineStyleDecos.hrActive);
    addRange(builder, from, to, activeLineMarkerDeco);
  } else {
    addRange(builder, from, to, hrMarkerDeco);
  }
}

function addForcedThematicBreakDecorations(builder, state, activeLines, frontmatter) {
  for (let lineNo = 1; lineNo <= state.doc.lines; lineNo += 1) {
    const line = state.doc.line(lineNo);
    if (!isThematicBreakLine(line.text) || isInsideFrontmatter(frontmatter, line.from)) {
      continue;
    }
    addThematicBreakDecorations(builder, state, line.from, line.to, activeLines);
  }
}

function getNodeHref(state, node) {
  const href = state.doc.sliceString(node.from, node.to).trim();
  return href || '';
}

function addLinkMark(builder, from, to, href) {
  if (!href) {
    return;
  }
  addRange(
    builder,
    from,
    to,
    Decoration.mark({
      class: 'meo-md-link',
      attributes: { 'data-meo-link-href': href }
    })
  );
}

function findChildNode(node, name) {
  const syntaxNode = node?.node ?? node;
  if (!syntaxNode?.firstChild) {
    return null;
  }
  for (let child = syntaxNode.firstChild; child; child = child.nextSibling) {
    if (child.name === name) {
      return child;
    }
  }
  return null;
}

class ClearLinkUrlWidget extends WidgetType {
  constructor(urlFrom, urlTo) {
    super();
    this.urlFrom = urlFrom;
    this.urlTo = urlTo;
  }

  eq(other) {
    return other.urlFrom === this.urlFrom && other.urlTo === this.urlTo;
  }

  toDOM() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'meo-md-link-clear-btn';
    button.title = 'Clear link URL';
    button.setAttribute('aria-label', 'Clear link URL');
    button.appendChild(createElement(Delete, { 'aria-hidden': 'true' }));
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const view = EditorView.findFromDOM(button);
      if (!view) {
        return;
      }
      view.dispatch({
        changes: { from: this.urlFrom, to: this.urlTo, insert: '' },
        selection: { anchor: this.urlFrom }
      });
      view.focus();
    });
    return button;
  }

  ignoreEvent() {
    return true;
  }
}

class MissingWikiLinkWidget extends WidgetType {
  eq(other) {
    return other instanceof MissingWikiLinkWidget;
  }

  toDOM() {
    const badge = document.createElement('span');
    badge.className = 'meo-md-wiki-missing-icon';
    badge.title = 'Wiki link target not found locally';
    badge.setAttribute('aria-label', 'Wiki link target not found locally');
    badge.appendChild(createElement(AlertCircle, { 'aria-hidden': 'true' }));
    return badge;
  }

  ignoreEvent() {
    return true;
  }
}

function addMarkdownLinkDecorations(builder, state, node, activeLines) {
  const urlNode = findChildNode(node, 'URL');
  if (!urlNode) {
    return;
  }

  const prefix = state.doc.sliceString(node.from, urlNode.from);
  const closeTextAt = prefix.lastIndexOf('](');
  if (closeTextAt <= 0) {
    return;
  }

  const textFrom = node.from + 1;
  const textTo = node.from + closeTextAt;
  if (textFrom >= textTo) {
    return;
  }
  const href = getNodeHref(state, urlNode);
  addLinkMark(builder, textFrom, textTo, href);
  if (!href) {
    return;
  }
  const urlLine = state.doc.lineAt(urlNode.from);
  const isActiveLine = activeLines.has(urlLine.number);
  if (!isActiveLine) {
    addRange(builder, urlNode.from, urlNode.to, hiddenLinkUrlDeco);
    return;
  }

  builder.push(
    Decoration.widget({
      widget: new ClearLinkUrlWidget(urlNode.from, urlNode.to),
      side: 1
    }).range(urlNode.to)
  );
}

function getEmptyImageLinkUrl(state, node) {
  const urlNode = findChildNode(node, 'URL');
  if (!urlNode) {
    return '';
  }

  const prefix = state.doc.sliceString(node.from, urlNode.from);
  const closeTextAt = prefix.lastIndexOf('](');
  if (closeTextAt < 1) {
    return '';
  }

  const textFrom = node.from + 1;
  const textTo = node.from + closeTextAt;
  if (state.doc.sliceString(textFrom, textTo).trim()) {
    return '';
  }

  const url = state.doc.sliceString(urlNode.from, urlNode.to).trim();
  return isImageUrl(url) ? url : '';
}

function addAutolinkDecorations(builder, state, node) {
  const urlNode = findChildNode(node, 'URL');
  if (!urlNode) {
    return;
  }

  addLinkMark(builder, urlNode.from, urlNode.to, getNodeHref(state, urlNode));
}

function addWikiLinkDecorations(builder, state, node, activeLines) {
  const wikiLink = parseWikiLinkData(state, node);
  if (!wikiLink) {
    return false;
  }

  const hasVisibleText = wikiLink.textFrom >= 0 && wikiLink.textTo > wikiLink.textFrom;
  if (wikiLink.href && hasVisibleText) {
    addLinkMark(builder, wikiLink.textFrom, wikiLink.textTo, wikiLink.href);
  }
  const lineNo = state.doc.lineAt(node.from).number;
  const marker = activeLines.has(lineNo)
    ? activeWikiLinkMarkerDeco
    : hasVisibleText
      ? wikiLinkMarkerDeco
      : emptyWikiLinkMarkerDeco;
  addRange(builder, wikiLink.openFrom, wikiLink.openTo, marker);
  addRange(builder, wikiLink.closeFrom, wikiLink.closeTo, marker);

  if (!activeLines.has(lineNo) && wikiLink.hideTo > wikiLink.hideFrom) {
    addRange(builder, wikiLink.hideFrom, wikiLink.hideTo, hiddenLinkUrlDeco);
  }

  const localTargetStatus = getWikiLinkStatus(wikiLink.localTarget);
  if (wikiLink.localTarget && localTargetStatus === false) {
    const iconPos = hasVisibleText ? wikiLink.textFrom : wikiLink.openTo;
    builder.push(
      Decoration.widget({
        widget: new MissingWikiLinkWidget(),
        side: -1
      }).range(iconPos)
    );
  }

  return true;
}

function addRange(builder, from, to, deco) {
  if (to <= from) {
    return;
  }
  builder.push(deco.range(from, to));
}

function addLineAwareRange(builder, activeLines, lineNo, from, to, inactiveDeco, activeDeco) {
  addRange(builder, from, to, activeLines.has(lineNo) ? activeDeco : inactiveDeco);
}

function addSingleTildeStrikeDecorations(builder, state, activeLines, existingStrikeRanges) {
  const pairs = collectSingleTildeStrikePairs(state, existingStrikeRanges);
  for (const pair of pairs) {
    addRange(builder, pair.strikeFrom, pair.strikeTo, inlineStyleDecos.strike);
    addLineAwareRange(
      builder,
      activeLines,
      pair.lineNo,
      pair.openFrom,
      pair.openTo,
      strikeMarkerDeco,
      activeStrikeMarkerDeco
    );
    addLineAwareRange(
      builder,
      activeLines,
      pair.lineNo,
      pair.closeFrom,
      pair.closeTo,
      strikeMarkerDeco,
      activeStrikeMarkerDeco
    );
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

function collectIndentSelectedLines(state) {
  const lines = new Set();
  for (const range of state.selection.ranges) {
    if (range.empty) {
      continue;
    }
    const from = Math.min(range.from, range.to);
    const to = Math.max(range.from, range.to);
    const startLine = state.doc.lineAt(from).number;
    const endLine = state.doc.lineAt(to - 1).number;
    for (let lineNo = startLine; lineNo <= endLine; lineNo += 1) {
      const lineStart = state.doc.line(lineNo).from;
      if (lineStart >= from && lineStart < to) {
        lines.add(lineNo);
      }
    }
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

function addListLineDecorations(builder, state, indentSelectedLines, frontmatter = null) {
  const stylesByLine = detectListIndentStylesByLine(state);
  const orderedCountsByLevel = [];

  for (let lineNo = 1; lineNo <= state.doc.lines; lineNo += 1) {
    const line = state.doc.line(lineNo);
    const lineText = state.doc.sliceString(line.from, line.to);
    const style = stylesByLine.get(lineNo);
    const marker = listMarkerData(lineText, null, style);
    if (!marker) {
      orderedCountsByLevel.length = 0;
      continue;
    }

    const level = marker.indentLevel;
    orderedCountsByLevel.length = level + 1;

    let orderedDisplayIndex = null;
    if (marker.orderedNumber) {
      orderedDisplayIndex = (orderedCountsByLevel[level] ?? 0) + 1;
      orderedCountsByLevel[level] = orderedDisplayIndex;
    } else {
      orderedCountsByLevel[level] = 0;
    }

    const inFrontmatterContent = isInsideFrontmatterContent(frontmatter, line.from);
    if (inFrontmatterContent) {
      // Preserve visible list markers inside YAML front matter, but avoid list-line
      // layout widgets/styles that reinterpret YAML indentation as Markdown layout.
      addListMarkerDecoration(builder, state, line.from, orderedDisplayIndex, style);
      continue;
    }

    if (marker.fromOffset > 0 && (marker.indentColumns ?? 0) > 0) {
      builder.push(
        Decoration.replace({
          widget: listIndentWidget(marker.indentColumns ?? 0),
          inclusive: false
        }).range(line.from, line.from + marker.fromOffset)
      );
    }

    builder.push(
      listLineDeco(
        marker.contentOffsetColumns ?? marker.toOffset,
        marker.indentColumns ?? 0,
        style?.columns ?? 2,
        indentSelectedLines.has(lineNo),
        Boolean(marker.isTask),
        marker.taskHiddenPrefixColumns ?? 0
      ).range(line.from)
    );
    addListMarkerDecoration(builder, state, line.from, orderedDisplayIndex, style);
  }
}

function buildDecorations(state) {
  const ranges = [];
  const activeLines = collectActiveLines(state);
  const indentSelectedLines = collectIndentSelectedLines(state);
  const tree = resolvedSyntaxTree(state);
  const collapsedHeadingSections = getCollapsedHeadingSections(state);
  const strikeRanges = collectStrikethroughRanges(tree);
  const parsedTableRanges = [];
  let tableDepth = 0;

  let frontmatter = null;
  try {
    frontmatter = parseFrontmatter(state);
    if (frontmatter) {
      addFrontmatterBoundaryDecorations(ranges, state, frontmatter, activeLines);
    }
  } catch {
    frontmatter = null;
  }
  addForcedThematicBreakDecorations(ranges, state, activeLines, frontmatter);

  tree.iterate({
    enter: (node) => {
      if (node.name === 'Table') {
        tableDepth += 1;
      }

      const headingLevel = headingLevelFromName(node.name);
      if (headingLevel !== null) {
        if (tableDepth === 0 && !isInsideFrontmatter(frontmatter, node.from)) {
          addAtxHeadingPrefixMarkers(ranges, state, node.from, activeLines);
          addLineClass(ranges, state, node.from, node.to, lineStyleDecos[`h${headingLevel}`]);
        }
      }

      if (node.name === 'Blockquote') {
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

          addCodeLanguageLabel(ranges, state, node, activeLines);

          const codeInfo = getFencedCodeInfo(state, node);
          if (codeInfo === 'mermaid') {
            addMermaidDiagram(ranges, state, node);
            return;
          }
        }
        addCopyCodeButton(ranges, state, node.from, node.to);
      }

      if (node.name === 'Emphasis') {
        addRange(ranges, node.from, node.to, inlineStyleDecos.em);
      } else if (node.name === 'StrongEmphasis') {
        addRange(ranges, node.from, node.to, inlineStyleDecos.strong);
      } else if (node.name === 'Strikethrough') {
        addRange(ranges, node.from, node.to, inlineStyleDecos.strike);
      } else if (node.name === 'InlineCode' || node.name === 'CodeText') {
        addRange(ranges, node.from, node.to, inlineStyleDecos.inlineCode);
      } else if (node.name === 'Link') {
        if (addWikiLinkDecorations(ranges, state, node, activeLines)) {
          return;
        }
        const emptyImageUrl = getEmptyImageLinkUrl(state, node);
        if (emptyImageUrl) {
          const line = state.doc.lineAt(node.from);
          if (!activeLines.has(line.number)) {
            const linkSelection = state.selection.ranges.some(
              (r) => r.from < node.to && r.to > node.from
            );
            if (!linkSelection) {
              ranges.push(
                Decoration.replace({
                  widget: new ImageWidget(emptyImageUrl, '', ''),
                  inclusive: false
                }).range(node.from, node.to)
              );
              return;
            }
          }
        }
        addMarkdownLinkDecorations(ranges, state, node, activeLines);
      } else if (node.name === 'Autolink') {
        addAutolinkDecorations(ranges, state, node);
      } else if (node.name === 'URL') {
        const parentName = node.node.parent?.name ?? '';
        if (parentName !== 'Link' && parentName !== 'Autolink') {
          addLinkMark(ranges, node.from, node.to, getNodeHref(state, node));
        }
      } else if (node.name === 'Image') {
        const line = state.doc.lineAt(node.from);
        if (activeLines.has(line.number)) {
          return;
        }
        const imageSelection = state.selection.ranges.some(
          (r) => r.from < node.to && r.to > node.from
        );
        if (imageSelection) {
          return;
        }
        const { url, altText, linkUrl } = getImageData(state, node);
        if (url) {
          ranges.push(
            Decoration.replace({
              widget: new ImageWidget(url, altText, linkUrl),
              inclusive: false
            }).range(node.from, node.to)
          );
        }
      }

      if (!node.name.endsWith('Mark')) {
        return;
      }

      const line = state.doc.lineAt(node.from);
      if (tableDepth > 0 && node.name === 'HeaderMark') {
        return;
      }
      if (isFenceMarker(state, node.from, node.to)) {
        // Show fence markers on all lines (not just active)
        addLineAwareRange(ranges, activeLines, line.number, node.from, node.to, fenceMarkerDeco, activeLineMarkerDeco);
      } else if (node.name === 'StrikethroughMark') {
        addLineAwareRange(ranges, activeLines, line.number, node.from, node.to, strikeMarkerDeco, activeStrikeMarkerDeco);
      } else if (node.name === 'CodeMark') {
        addLineAwareRange(ranges, activeLines, line.number, node.from, node.to, codeMarkerDeco, activeCodeMarkerDeco);
      } else if (node.name === 'LinkMark') {
        const parentName = node.node.parent?.name ?? '';
        if (parentName === 'Image') {
          const { url } = getImageData(state, node.node.parent);
          if (!url) {
            return;
          }
        } else if (parentName === 'Link') {
          if (isWikiLinkNode(state, node.node.parent)) {
            return;
          }
          const urlNode = findChildNode(node.node.parent, 'URL');
          if (!urlNode) {
            return;
          }
          const href = getNodeHref(state, urlNode);
          if (!href) {
            return;
          }
        }
        addLineAwareRange(ranges, activeLines, line.number, node.from, node.to, linkMarkerDeco, activeLinkMarkerDeco);
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
  addListLineDecorations(ranges, state, indentSelectedLines, frontmatter);
  for (const section of collapsedHeadingSections) {
    addLineClass(ranges, state, section.lineFrom, section.lineTo, collapsedHeadingLineDeco);
    addRange(ranges, section.collapseFrom, section.collapseTo, collapsedHeadingBodyDeco);
  }

  const result = Decoration.set(ranges, true);
  return result;
}

function safeBuildDecorations(state, fallback, context, extra = {}) {
  try {
    return buildDecorations(state);
  } catch (error) {
    console.error('[MEO liveMode] decoration build failed', {
      context,
      docLength: state.doc.length,
      ...extra,
      error
    });
    return fallback;
  }
}

const liveDecorationField = StateField.define({
  create(state) {
    return safeBuildDecorations(state, Decoration.none, 'create');
  },
  update(decorations, transaction) {
    // Recompute on every transaction so live mode stays in sync with parser updates
    // that may arrive without direct doc/selection changes.
    const next = safeBuildDecorations(transaction.state, decorations, 'update', {
      docChanged: transaction.docChanged,
      selection: transaction.selection
    });

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
    if (isThematicBreakLine(delimiterText)) continue;
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
    markdown({
      base: markdownLanguage,
      addKeymap: false,
      codeLanguages: resolveCodeLanguage,
      extensions: [{ remove: ['SetextHeading'] }]
    }),
    syntaxHighlighting(highlightStyle),
    liveDecorationField,
    liveLineNumberMarkerField,
    ...headingCollapseLiveExtensions()
  ];
}

function isEmptyDecorationSet(set) {
  const cursor = set.iter();
  return cursor.value === null;
}
