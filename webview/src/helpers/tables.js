import { StateField } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { undo, redo } from '@codemirror/commands';
import { ImageWidget } from './images';
import { wikiLinkScheme } from './wikiLinks';

const sourceTableHeaderLineDeco = Decoration.line({ class: 'meo-md-source-table-header-line' });
const sourceTableHeaderCellDeco = Decoration.mark({ class: 'meo-md-source-table-header-cell' });
const tableDelimiterRegex = /^\|?\s*[:]?\-+[:]?\s*(\|\s*[:]?\-+[:]?\s*)*\|?$/;
const tableCellSelector = 'th[data-table-row][data-table-col], td[data-table-row][data-table-col]';
const tableControlSelector = '.meo-md-html-col-controls, .meo-md-html-row-controls, .meo-md-html-col-btn, .meo-md-html-row-btn';
const minColumnWidthCh = 10;
const maxColumnWidthCh = 40;

function isTableControlTarget(target) {
  return target instanceof Element && target.closest(tableControlSelector);
}

function targetElementFrom(target) {
  return target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
}

function isPrimaryModifier(event) {
  if (event.altKey) return false;
  return event.metaKey !== event.ctrlKey && (event.metaKey || event.ctrlKey);
}

function isPrimaryModifierPointerClick(event) {
  if (event.altKey || event.shiftKey) return false;
  return event.metaKey !== event.ctrlKey && (event.metaKey || event.ctrlKey);
}

function isModifierLinkActivationEvent(event) {
  return Boolean(getModifierLinkActivationHref(event));
}

function getModifierLinkActivationHref(event) {
  if (!isPrimaryModifierPointerClick(event)) return '';
  const target = targetElementFrom(event.target);
  if (!target) return '';
  const link = target.closest('[data-meo-link-href]');
  if (!(link instanceof Element)) return '';
  const href = link.getAttribute('data-meo-link-href');
  return href || '';
}

function isUndoShortcut(event) {
  return event.key.toLowerCase() === 'z' && !event.shiftKey;
}

function isRedoShortcut(event) {
  const key = event.key.toLowerCase();
  return (key === 'z' && event.shiftKey) || key === 'y';
}

// Table widget inline preview + pipe-aware row parsing are table-specific and
// live here to keep all HTML-table behavior in one helper module.
const tableInlineSchemeRe = /^[a-z][a-z0-9+.-]*:/i;
const tableInlineRawUrlRe = /^(?:[a-z][a-z0-9+.-]*:\/\/|mailto:|file:|www\.)[^\s<]+/i;
const tableInlineEscapableChars = new Set(['\\', '*', '_', '~', '`', '[', ']', '(', ')', '!', '|', '<', '>']);

function isTableInlineWhitespaceOnly(text) {
  return /^\s+$/.test(text);
}

function isTableInlineEscaped(text, index) {
  let slashCount = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i -= 1) {
    slashCount += 1;
  }
  return (slashCount % 2) === 1;
}

function isTableInlineUrlLike(text) {
  return tableInlineRawUrlRe.test(text) || tableInlineSchemeRe.test(text);
}

function tableInlineHrefFromRawUrl(text) {
  if (!text) return '';
  if (text.startsWith('www.')) return `https://${text}`;
  return text;
}

function tableInlineHrefFromWikiTarget(target) {
  const trimmed = (target ?? '').trim();
  if (!trimmed) return '';
  if (tableInlineSchemeRe.test(trimmed)) return trimmed;
  return `${wikiLinkScheme}${encodeURIComponent(trimmed)}`;
}

function decodeTableInlineEscapes(text) {
  let result = '';
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\\' && i + 1 < text.length && tableInlineEscapableChars.has(text[i + 1])) {
      result += text[i + 1];
      i += 1;
      continue;
    }
    result += text[i];
  }
  return result;
}

function findTableInlineMatchingBackticks(text, index, tickCount) {
  const marker = '`'.repeat(tickCount);
  for (let i = index; i <= text.length - tickCount; i += 1) {
    if (text.startsWith(marker, i)) return i;
  }
  return -1;
}

function parseTableInlineCodeSpan(text, index) {
  if (text[index] !== '`') return null;
  let tickCount = 1;
  while (text[index + tickCount] === '`') tickCount += 1;
  const close = findTableInlineMatchingBackticks(text, index + tickCount, tickCount);
  if (close < 0) return null;
  return {
    content: text.slice(index + tickCount, close),
    nextIndex: close + tickCount
  };
}

function consumeTableInlineAngleSection(text, index) {
  if (text[index] !== '<' || isTableInlineEscaped(text, index)) return null;
  const close = text.indexOf('>', index + 1);
  if (close < 0) return null;
  return {
    content: text.slice(index + 1, close),
    nextIndex: close + 1
  };
}

function consumeTableInlineBracketContent(text, index) {
  if (text[index] !== '[' || isTableInlineEscaped(text, index)) return null;
  let depth = 1;
  for (let i = index + 1; i < text.length;) {
    if (text[i] === '\\' && i + 1 < text.length) {
      i += 2;
      continue;
    }
    const code = parseTableInlineCodeSpan(text, i);
    if (code) {
      i = code.nextIndex;
      continue;
    }
    if (text[i] === '[' && !isTableInlineEscaped(text, i)) {
      depth += 1;
      i += 1;
      continue;
    }
    if (text[i] === ']' && !isTableInlineEscaped(text, i)) {
      depth -= 1;
      if (depth === 0) {
        return {
          content: text.slice(index + 1, i),
          nextIndex: i + 1
        };
      }
      i += 1;
      continue;
    }
    i += 1;
  }
  return null;
}

function consumeTableInlineParenContent(text, index) {
  if (text[index] !== '(' || isTableInlineEscaped(text, index)) return null;
  let depth = 1;
  for (let i = index + 1; i < text.length;) {
    if (text[i] === '\\' && i + 1 < text.length) {
      i += 2;
      continue;
    }
    const code = parseTableInlineCodeSpan(text, i);
    if (code) {
      i = code.nextIndex;
      continue;
    }
    const angle = consumeTableInlineAngleSection(text, i);
    if (angle) {
      i = angle.nextIndex;
      continue;
    }
    if (text[i] === '(' && !isTableInlineEscaped(text, i)) {
      depth += 1;
      i += 1;
      continue;
    }
    if (text[i] === ')' && !isTableInlineEscaped(text, i)) {
      depth -= 1;
      if (depth === 0) {
        return {
          content: text.slice(index + 1, i),
          nextIndex: i + 1
        };
      }
      i += 1;
      continue;
    }
    i += 1;
  }
  return null;
}

function parseTableInlineMarkdownLink(text, index, { image = false } = {}) {
  const start = image ? index + 1 : index;
  if (image) {
    if (!(text[index] === '!' && text[index + 1] === '[') || isTableInlineEscaped(text, index)) return null;
  } else if (text[index] !== '[' || isTableInlineEscaped(text, index)) {
    return null;
  }
  if (!image && text.startsWith('[[', index)) return null;

  const label = consumeTableInlineBracketContent(text, start);
  if (!label || text[label.nextIndex] !== '(') return null;
  const destination = consumeTableInlineParenContent(text, label.nextIndex);
  if (!destination) return null;

  let url = destination.content.trim();
  if (url.startsWith('<') && url.endsWith('>') && url.length >= 2) {
    url = url.slice(1, -1).trim();
  }

  return {
    label: label.content,
    url,
    nextIndex: destination.nextIndex
  };
}

function parseTableInlineWikiLink(text, index) {
  if (!text.startsWith('[[', index) || isTableInlineEscaped(text, index)) return null;
  for (let i = index + 2; i < text.length - 1; i += 1) {
    if (text[i] === '\\') {
      i += 1;
      continue;
    }
    if (text[i] === ']' && text[i + 1] === ']' && !isTableInlineEscaped(text, i)) {
      const content = text.slice(index + 2, i);
      const pipeIndex = content.indexOf('|');
      const rawTarget = pipeIndex >= 0 ? content.slice(0, pipeIndex).trim() : content.trim();
      const rawAlias = pipeIndex >= 0 ? content.slice(pipeIndex + 1).trim() : '';
      return {
        target: rawTarget,
        visibleText: rawAlias || rawTarget,
        nextIndex: i + 2
      };
    }
  }
  return null;
}

function findTableInlineClosingMarker(text, startIndex, marker, { singleTilde = false } = {}) {
  const markerLen = marker.length;
  for (let i = startIndex; i <= text.length - markerLen; i += 1) {
    if (!text.startsWith(marker, i)) continue;
    if (isTableInlineEscaped(text, i)) continue;
    if (singleTilde && (text[i - 1] === '~' || text[i + 1] === '~')) continue;
    return i;
  }
  return -1;
}

function parseTableInlineDelimitedSpan(text, index) {
  const strongMarker = text.startsWith('**', index)
    ? '**'
    : (text.startsWith('__', index) ? '__' : null);
  if (strongMarker) {
    const start = index + 2;
    const close = findTableInlineClosingMarker(text, start, strongMarker);
    if (close > start) {
      const content = text.slice(start, close);
      if (!isTableInlineWhitespaceOnly(content)) {
        return { kind: 'strong', content, nextIndex: close + 2 };
      }
    }
  }

  if (text.startsWith('~~', index)) {
    const start = index + 2;
    const close = findTableInlineClosingMarker(text, start, '~~');
    if (close > start) {
      const content = text.slice(start, close);
      if (!isTableInlineWhitespaceOnly(content)) {
        return { kind: 'strike', content, nextIndex: close + 2 };
      }
    }
  }

  const emMarker = (text[index] === '*' || text[index] === '_') ? text[index] : null;
  if (emMarker && text[index + 1] !== emMarker) {
    const start = index + 1;
    const close = findTableInlineClosingMarker(text, start, emMarker);
    if (close > start) {
      const content = text.slice(start, close);
      if (!isTableInlineWhitespaceOnly(content)) {
        return { kind: 'em', content, nextIndex: close + 1 };
      }
    }
  }

  if (text[index] === '~' && text[index + 1] !== '~' && text[index - 1] !== '~') {
    const start = index + 1;
    const close = findTableInlineClosingMarker(text, start, '~', { singleTilde: true });
    if (close > start) {
      const content = text.slice(start, close);
      if (!isTableInlineWhitespaceOnly(content)) {
        return { kind: 'strike', content, nextIndex: close + 1 };
      }
    }
  }

  return null;
}

function trimTableInlineRawUrl(raw) {
  let end = raw.length;
  while (end > 0 && /[.,!?;:]/.test(raw[end - 1])) end -= 1;
  while (end > 0 && raw[end - 1] === ')') {
    const body = raw.slice(0, end);
    const opens = (body.match(/\(/g) ?? []).length;
    const closes = (body.match(/\)/g) ?? []).length;
    if (closes <= opens) break;
    end -= 1;
  }
  return raw.slice(0, end);
}

function parseTableInlineAutolink(text, index) {
  const angle = consumeTableInlineAngleSection(text, index);
  if (!angle) return null;
  const inner = angle.content.trim();
  if (!inner || /\s/.test(inner)) return null;
  const looksLikeEmail = /.+@.+\..+/.test(inner);
  if (!isTableInlineUrlLike(inner) && !looksLikeEmail) return null;
  const href = looksLikeEmail && !tableInlineSchemeRe.test(inner)
    ? `mailto:${inner}`
    : tableInlineHrefFromRawUrl(inner);
  return { label: inner, href, nextIndex: angle.nextIndex };
}

function parseTableInlineRawUrl(text, index) {
  if (isTableInlineEscaped(text, index)) return null;
  if (index > 0 && /[A-Za-z0-9]/.test(text[index - 1])) return null;
  const match = tableInlineRawUrlRe.exec(text.slice(index));
  if (!match) return null;
  const trimmed = trimTableInlineRawUrl(match[0]);
  if (!trimmed) return null;
  return {
    label: trimmed,
    href: tableInlineHrefFromRawUrl(trimmed),
    nextIndex: index + trimmed.length
  };
}

function appendTableInlinePreviewLink(parent, label, href) {
  const el = document.createElement('span');
  el.className = 'meo-md-link';
  if (href) el.setAttribute('data-meo-link-href', href);
  appendTableInlinePreviewNodes(el, label, { disableLinkParsers: true });
  parent.appendChild(el);
}

function appendTableInlinePreviewImage(parent, altText, url) {
  if (!url) {
    parent.appendChild(document.createTextNode(`![${altText}]()`));
    return;
  }
  const dom = new ImageWidget(url, decodeTableInlineEscapes(altText), '').toDOM();
  if (dom instanceof HTMLElement) {
    dom.setAttribute('data-meo-link-href', url);
  }
  parent.appendChild(dom);
}

function appendTableInlinePreviewNodes(parent, text, options = {}) {
  const { disableLinkParsers = false } = options;
  let buffer = '';
  const flushBuffer = () => {
    if (!buffer) return;
    parent.appendChild(document.createTextNode(buffer));
    buffer = '';
  };

  for (let i = 0; i < text.length;) {
    if (text[i] === '\\' && i + 1 < text.length && tableInlineEscapableChars.has(text[i + 1])) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }

    const code = parseTableInlineCodeSpan(text, i);
    if (code) {
      flushBuffer();
      const el = document.createElement('code');
      el.className = 'meo-md-inline-code';
      el.textContent = decodeTableInlineEscapes(code.content);
      parent.appendChild(el);
      i = code.nextIndex;
      continue;
    }

    const image = parseTableInlineMarkdownLink(text, i, { image: true });
    if (image) {
      flushBuffer();
      appendTableInlinePreviewImage(parent, image.label, decodeTableInlineEscapes(image.url));
      i = image.nextIndex;
      continue;
    }

    if (!disableLinkParsers) {
      const wiki = parseTableInlineWikiLink(text, i);
      if (wiki) {
        flushBuffer();
        appendTableInlinePreviewLink(parent, wiki.visibleText, tableInlineHrefFromWikiTarget(wiki.target));
        i = wiki.nextIndex;
        continue;
      }

      const link = parseTableInlineMarkdownLink(text, i);
      if (link) {
        flushBuffer();
        if (link.url) {
          appendTableInlinePreviewLink(parent, link.label, decodeTableInlineEscapes(link.url));
        } else {
          appendTableInlinePreviewNodes(parent, link.label, options);
        }
        i = link.nextIndex;
        continue;
      }

      const autolink = parseTableInlineAutolink(text, i);
      if (autolink) {
        flushBuffer();
        appendTableInlinePreviewLink(parent, autolink.label, autolink.href);
        i = autolink.nextIndex;
        continue;
      }
    }

    const span = parseTableInlineDelimitedSpan(text, i);
    if (span) {
      flushBuffer();
      if (span.kind === 'em') {
        const el = document.createElement('em');
        appendTableInlinePreviewNodes(el, span.content);
        parent.appendChild(el);
      } else if (span.kind === 'strong') {
        const el = document.createElement('strong');
        appendTableInlinePreviewNodes(el, span.content);
        parent.appendChild(el);
      } else if (span.kind === 'strike') {
        const el = document.createElement('span');
        el.className = 'meo-md-strike';
        appendTableInlinePreviewNodes(el, span.content);
        parent.appendChild(el);
      }
      i = span.nextIndex;
      continue;
    }

    if (!disableLinkParsers) {
      const rawUrl = parseTableInlineRawUrl(text, i);
      if (rawUrl) {
        flushBuffer();
        appendTableInlinePreviewLink(parent, rawUrl.label, rawUrl.href);
        i = rawUrl.nextIndex;
        continue;
      }
    }

    buffer += text[i];
    i += 1;
  }

  flushBuffer();
}

function renderTableCellInlinePreview(previewEl, value) {
  if (!(previewEl instanceof HTMLElement)) return;
  previewEl.replaceChildren();
  appendTableInlinePreviewNodes(previewEl, value ?? '');
}

function consumeTableInlineProtectedSpan(text, index, endIndex) {
  const code = parseTableInlineCodeSpan(text, index);
  if (code && code.nextIndex <= endIndex) return code.nextIndex;

  const wiki = parseTableInlineWikiLink(text, index);
  if (wiki && wiki.nextIndex <= endIndex) return wiki.nextIndex;

  const image = parseTableInlineMarkdownLink(text, index, { image: true });
  if (image && image.nextIndex <= endIndex) return image.nextIndex;

  const link = parseTableInlineMarkdownLink(text, index);
  if (link && link.nextIndex <= endIndex) return link.nextIndex;

  const angle = consumeTableInlineAngleSection(text, index);
  if (angle && angle.nextIndex <= endIndex) return angle.nextIndex;

  if (text[index] === '\\' && index + 1 < endIndex) return index + 2;
  return null;
}

function findTableRowSeparatorPipes(text, startIndex, endIndex) {
  const pipes = [];
  for (let i = startIndex; i < endIndex;) {
    const protectedNext = consumeTableInlineProtectedSpan(text, i, endIndex);
    if (protectedNext && protectedNext > i) {
      i = protectedNext;
      continue;
    }
    if (text[i] === '|' && !isTableInlineEscaped(text, i)) {
      pipes.push(i);
    }
    i += 1;
  }
  return pipes;
}

function parseTableRowCells(lineText, lineFrom = 0) {
  const leadingWhitespaceLen = /^(\s*)/.exec(lineText)?.[1].length ?? 0;
  let contentStart = leadingWhitespaceLen;
  let contentEnd = lineText.length;
  while (contentStart < contentEnd && /\s/.test(lineText[contentStart])) contentStart += 1;
  while (contentEnd > contentStart && /\s/.test(lineText[contentEnd - 1])) contentEnd -= 1;

  let innerStart = contentStart;
  let innerEnd = contentEnd;
  if (innerStart < innerEnd && lineText[innerStart] === '|') innerStart += 1;
  if (innerEnd > innerStart && lineText[innerEnd - 1] === '|') innerEnd -= 1;

  const allSeparatorPipes = findTableRowSeparatorPipes(lineText, 0, lineText.length);
  const innerPipes = allSeparatorPipes.filter((index) => index >= innerStart && index < innerEnd);

  const cells = [];
  if (innerStart < innerEnd || innerPipes.length > 0) {
    let cursor = innerStart;
    for (const pipeIndex of innerPipes) {
      cells.push(lineText.slice(cursor, pipeIndex).trim());
      cursor = pipeIndex + 1;
    }
    cells.push(lineText.slice(cursor, innerEnd).trim());
  }

  const segments = [];
  for (let i = 0; i + 1 < allSeparatorPipes.length; i += 1) {
    const rawFrom = allSeparatorPipes[i] + 1;
    const rawTo = allSeparatorPipes[i + 1];
    let from = rawFrom;
    let to = rawTo;
    if (from < to && lineText[from] === ' ') from += 1;
    if (to > from && lineText[to - 1] === ' ') to -= 1;
    if (to <= from) {
      segments.push({ from: lineFrom + rawFrom, to: lineFrom + rawTo, cellIndex: i, empty: true });
      continue;
    }
    segments.push({ from: lineFrom + from, to: lineFrom + to, cellIndex: i, empty: false });
  }

  return {
    cells: cells.length === 1 && cells[0] === '' ? [] : cells,
    pipes: allSeparatorPipes,
    segments
  };
}

function normalizeRow(cells, colCount) {
  const result = cells.slice(0, colCount);
  while (result.length < colCount) result.push('');
  return result;
}

function isValidTableRange(from, to, docLength) {
  return (
    Number.isInteger(from) &&
    Number.isInteger(to) &&
    from >= 0 &&
    from < to &&
    to <= docLength
  );
}

function parseDelimiterAlignments(lineText) {
  const alignments = [];
  const parts = lineText.split('|').filter((part) => part.trim());
  for (const part of parts) {
    const value = part.trim();
    const left = value.startsWith(':');
    const right = value.endsWith(':');
    alignments.push(left && right ? 'center' : left ? 'left' : right ? 'right' : null);
  }
  return alignments;
}

function delimiterCellForAlignment(alignment) {
  if (alignment === 'left') return ':---';
  if (alignment === 'right') return '---:';
  if (alignment === 'center') return ':---:';
  return '---';
}

function serializeTableMarkdown(indent, headerCells, alignments, rows) {
  const colCount = headerCells.length;
  const normalizedAlignments = normalizeRow(alignments, colCount).map((value) => value ?? null);
  const normalizedRows = rows.map((row) => normalizeRow(row, colCount));
  const header = `| ${headerCells.join(' | ')} |`;
  const delimiter = `| ${normalizedAlignments.map(delimiterCellForAlignment).join(' | ')} |`;
  const dataRows = normalizedRows.map((row) => `| ${row.join(' | ')} |`);
  return [header, delimiter, ...dataRows].map((line) => `${indent}${line}`).join('\n');
}

function computePreferredColumnCharWidths(headerCells, rows, colCount) {
  const widths = new Array(colCount).fill(minColumnWidthCh);
  const update = (value, col) => {
    widths[col] = Math.max(widths[col], Math.min(maxColumnWidthCh, Math.max(minColumnWidthCh, value.length + 2)));
  };

  for (let col = 0; col < colCount; col++) {
    update(headerCells[col] ?? '', col);
  }
  for (const row of rows) {
    for (let col = 0; col < colCount; col++) {
      update(row[col] ?? '', col);
    }
  }
  return widths;
}

function computePreferredColumnCharWidthsFromInputs(headerInputs, rowInputs, colCount) {
  const headerCells = normalizeRow(headerInputs.map((input) => input.value.trim()), colCount);
  const rows = rowInputs.map((inputs) => normalizeRow(inputs.map((input) => input.value.trim()), colCount));
  return computePreferredColumnCharWidths(headerCells, rows, colCount);
}

function parseTableLine(lineNo, from, to, text) {
  const { cells, pipes, segments } = parseTableRowCells(text, from);
  return { lineNo, from, to, text, cells, pipes, segments };
}

function isTableContentLine(lineText) {
  return lineText.includes('|');
}

function buildTableData(state, tableNode) {
  const startLine = state.doc.lineAt(tableNode.from);
  const endLine = state.doc.lineAt(Math.max(tableNode.to - 1, tableNode.from));
  return buildTableDataForLineRange(state, startLine.number, endLine.number);
}

function buildTableDataForLineRange(state, startLineNo, endLineNo) {
  const startLine = state.doc.line(startLineNo);
  const endLine = state.doc.line(endLineNo);
  const lines = [];
  let delimiterIdx = -1;

  for (let lineNo = startLine.number; lineNo <= endLine.number; lineNo++) {
    const line = state.doc.line(lineNo);
    const text = state.doc.sliceString(line.from, line.to);
    if (delimiterIdx === -1 && isTableDelimiterLine(text)) {
      delimiterIdx = lines.length;
    }
    lines.push(parseTableLine(lineNo, line.from, line.to, text));
  }

  const headerLine = delimiterIdx > 0 ? lines[delimiterIdx - 1] : null;
  let lastTableLineIdx = delimiterIdx;
  if (delimiterIdx >= 0) {
    for (let idx = delimiterIdx + 1; idx < lines.length; idx += 1) {
      if (!isTableContentLine(lines[idx].text)) {
        break;
      }
      lastTableLineIdx = idx;
    }
  }

  const dataLines = delimiterIdx >= 0 ? lines.slice(delimiterIdx + 1, lastTableLineIdx + 1) : [];
  const alignments = delimiterIdx >= 0 ? parseDelimiterAlignments(lines[delimiterIdx].text) : [];
  const colCount = headerLine ? headerLine.cells.length : dataLines[0] ? dataLines[0].cells.length : 0;
  const tableFrom = headerLine ? headerLine.from : startLine.from;
  const tableTo = delimiterIdx >= 0 && lines[lastTableLineIdx] ? lines[lastTableLineIdx].to : endLine.to;
  const effectiveStartLine = headerLine ? headerLine.lineNo : startLine.number;
  const effectiveEndLine = delimiterIdx >= 0 && lines[lastTableLineIdx] ? lines[lastTableLineIdx].lineNo : endLine.number;

  return {
    from: tableFrom,
    to: tableTo,
    lines,
    delimiterIdx,
    headerLine,
    dataLines,
    alignments,
    colCount,
    startLine: effectiveStartLine,
    endLine: effectiveEndLine
  };
}

class HtmlTableWidget extends WidgetType {
  constructor(tableData) {
    super();
    this.tableData = tableData;
    this.layoutFrame = 0;
    this.pendingResizeRows = false;
    this.lastAppliedWidths = [];
    this.domRefs = null;
    this.chPx = 0;
    this.cleanupFns = [];
    this.selectionAnchor = null;
    this.selectionRange = null;
    this.selectionPointerId = null;
    this.isDraggingSelection = false;
    this.hasPendingCellEdits = false;
  }

  eq(other) {
    return (
      other instanceof HtmlTableWidget &&
      other.tableData.signature === this.tableData.signature &&
      other.tableData.indent === this.tableData.indent
    );
  }

  resolveCurrentTableRange(view, dom) {
    let pos = 0;
    try {
      pos = view.posAtDOM(dom, 0);
    } catch {
      pos = -1;
    }

    if (pos >= 0) {
      let node = syntaxTree(view.state).resolveInner(pos, 1);
      while (node) {
        if (node.name === 'Table') {
          if (this.tableData) {
            this.tableData.from = node.from;
            this.tableData.to = node.to;
          }
          return { from: node.from, to: node.to };
        }
        node = node.parent;
      }
    }

    const tableFrom = this.tableData?.from;
    const tableTo = this.tableData?.to;
    if (isValidTableRange(tableFrom, tableTo, view.state.doc.length)) {
      return { from: tableFrom, to: tableTo };
    }

    return null;
  }

  readCellMatrix() {
    if (!this.domRefs) return { headerCells: [], rows: [] };
    const { headerInputs, rowInputs } = this.domRefs;
    const headerCells = normalizeRow(headerInputs.map((input) => input.value.trim()), this.tableData.colCount);

    const rows = rowInputs.map((inputs) => normalizeRow(inputs.map((input) => input.value.trim()), this.tableData.colCount));

    return { headerCells, rows };
  }

  parseCellCoords(rowText, colText) {
    const row = Number.parseInt(rowText ?? '', 10);
    const col = Number.parseInt(colText ?? '', 10);
    if (Number.isNaN(row) || Number.isNaN(col)) return null;
    return { row, col };
  }

  findCellElement(node) {
    if (!this.domRefs || !(node instanceof Element)) return null;
    const cell = node.closest(tableCellSelector);
    if (!cell || !this.domRefs.table.contains(cell)) return null;
    return cell;
  }

  coordsFromCell(cell) {
    return this.parseCellCoords(cell.dataset.tableRow, cell.dataset.tableCol);
  }

  focusTableInput(input, caret = null) {
    if (!(input instanceof HTMLTextAreaElement)) return false;
    this.setCellEditingState(input, true);
    input.focus({ preventScroll: true });
    const nextCaret = Math.min(Math.max(caret ?? input.value.length, 0), input.value.length);
    input.setSelectionRange(nextCaret, nextCaret);
    input.closest(tableCellSelector)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    return true;
  }

  focusCellInput(cell, { updateSelection = false } = {}) {
    const input = cell.querySelector('textarea');
    if (!this.focusTableInput(input)) return false;
    if (!updateSelection) return true;
    const coords = this.coordsFromCell(cell);
    if (coords) {
      this.setSingleCellSelection(coords);
    }
    return true;
  }

  focusCellInputAt(row, col, caret = null) {
    const input = this.domRefs?.allRowInputs?.[row]?.[col];
    return this.focusTableInput(input, caret);
  }

  moveVerticalOutOfTable(container, direction, preferredColumn = 0) {
    const view = EditorView.findFromDOM(container);
    if (!view) return false;

    const range = this.resolveCurrentTableRange(view, container);
    if (!range) return false;

    const firstLine = view.state.doc.lineAt(range.from);
    const lastLine = view.state.doc.lineAt(Math.max(range.to - 1, range.from));
    const lineStep = direction === 'up' ? -1 : direction === 'down' ? 1 : 0;
    if (!lineStep) return false;
    const anchorLineNo = lineStep < 0 ? firstLine.number : lastLine.number;
    const targetLineNo = anchorLineNo + lineStep;
    if (targetLineNo < 1 || targetLineNo > view.state.doc.lines) return false;

    const targetLine = view.state.doc.line(targetLineNo);
    const targetPos = Math.min(targetLine.from + Math.max(preferredColumn, 0), targetLine.to);

    this.commit(container);
    this.exitTableInteraction(container);
    view.dispatch({
      selection: { anchor: targetPos },
      effects: EditorView.scrollIntoView(targetPos, { y: 'nearest' })
    });
    view.focus();
    return true;
  }

  normalizeSelectionRange(a, b) {
    return {
      fromRow: Math.min(a.row, b.row),
      toRow: Math.max(a.row, b.row),
      fromCol: Math.min(a.col, b.col),
      toCol: Math.max(a.col, b.col)
    };
  }

  isCellSelected(row, col, range) {
    if (!range) return false;
    return row >= range.fromRow && row <= range.toRow && col >= range.fromCol && col <= range.toCol;
  }

  applySelection(range) {
    if (!this.domRefs) return;
    this.selectionRange = range;
    const showSelectionStyle = Boolean(
      range && (range.fromRow !== range.toRow || range.fromCol !== range.toCol)
    );
    const { cellGrid } = this.domRefs;
    for (let row = 0; row < cellGrid.length; row++) {
      const cells = cellGrid[row];
      for (let col = 0; col < cells.length; col++) {
        const cell = cells[col];
        const selected = this.isCellSelected(row, col, range);
        const styledSelected = selected && showSelectionStyle;
        const isTopEdge = styledSelected && row === range.fromRow;
        const isRightEdge = styledSelected && col === range.toCol;
        const isBottomEdge = styledSelected && row === range.toRow;
        const isLeftEdge = styledSelected && col === range.fromCol;
        cell.classList.toggle('meo-md-html-table-cell-selected', styledSelected);
        cell.classList.toggle('meo-md-html-table-cell-selected-top', isTopEdge);
        cell.classList.toggle('meo-md-html-table-cell-selected-right', isRightEdge);
        cell.classList.toggle('meo-md-html-table-cell-selected-bottom', isBottomEdge);
        cell.classList.toggle('meo-md-html-table-cell-selected-left', isLeftEdge);
      }
    }
  }

  setSingleCellSelection(coords) {
    this.selectionAnchor = coords;
    this.applySelection(this.normalizeSelectionRange(coords, coords));
  }

  clearSelection() {
    this.selectionAnchor = null;
    this.applySelection(null);
  }

  exitTableInteraction(container) {
    this.setTableInteractionActive(container, false);
    this.clearSelection();
  }

  setTableInteractionActive(container, active) {
    const view = EditorView.findFromDOM(container);
    if (!view) return;
    view.dom.dispatchEvent(new CustomEvent('meo-table-interaction', { detail: { active } }));
  }

  hasFocusedTableInput(container) {
    const view = EditorView.findFromDOM(container);
    if (!view) return false;
    const active = document.activeElement;
    if (!(active instanceof Element)) return false;
    if (!view.dom.contains(active)) return false;
    return active.closest('.meo-md-html-table-wrap') !== null;
  }

  selectedCellCount() {
    if (!this.selectionRange) return 0;
    const rowCount = this.selectionRange.toRow - this.selectionRange.fromRow + 1;
    const colCount = this.selectionRange.toCol - this.selectionRange.fromCol + 1;
    return rowCount * colCount;
  }

  selectedTextAsTsv() {
    if (!this.selectionRange || !this.domRefs) return '';
    const lines = [];
    for (let row = this.selectionRange.fromRow; row <= this.selectionRange.toRow; row++) {
      const values = [];
      for (let col = this.selectionRange.fromCol; col <= this.selectionRange.toCol; col++) {
        values.push(this.domRefs.allRowInputs[row][col].value.trim());
      }
      lines.push(values.join('\t'));
    }
    return lines.join('\n');
  }

  handleHistoryShortcut(event, table) {
    if (!isPrimaryModifier(event) || (!isUndoShortcut(event) && !isRedoShortcut(event))) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    const wrap = this.domRefs?.wrap ?? table;
    const view = EditorView.findFromDOM(wrap);
    if (!view) return true;
    const { scrollTop, scrollLeft } = view.scrollDOM;
    this.commit(wrap);
    if (isUndoShortcut(event)) undo(view);
    else redo(view);
    requestAnimationFrame(() => {
      view.scrollDOM.scrollTop = scrollTop;
      view.scrollDOM.scrollLeft = scrollLeft;
    });
    return true;
  }

  wireTableSelection(table) {
    const getWrap = () => this.domRefs?.wrap ?? table;

    const onWrapPointerDown = (event) => {
      if (!(event.target instanceof Node)) return;
      const wrap = getWrap();
      if (!wrap.contains(event.target)) return;
      if (isModifierLinkActivationEvent(event)) return;
      this.setTableInteractionActive(wrap, true);
    };

    const onPointerDown = (event) => {
      if (event.button !== 0) return;
      const modifierHref = getModifierLinkActivationHref(event);
      if (modifierHref) {
        event.preventDefault();
        event.stopPropagation();
        table.dispatchEvent(new CustomEvent('meo-open-link', {
          bubbles: true,
          detail: { href: modifierHref }
        }));
        return;
      }
      if (isTableControlTarget(event.target)) return;
      const cell = this.findCellElement(event.target);
      if (!cell) return;
      const current = this.coordsFromCell(cell);
      if (!current) return;
      if (event.target instanceof HTMLTextAreaElement) {
        this.selectionAnchor = current;
        this.applySelection(this.normalizeSelectionRange(current, current));
        return;
      }
      const anchor = current;
      this.selectionAnchor = anchor;
      this.applySelection(this.normalizeSelectionRange(anchor, current));
      this.selectionPointerId = event.pointerId;
      this.isDraggingSelection = true;
      table.setPointerCapture?.(event.pointerId);

      if (!(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        this.focusCellInput(cell);
      }
    };

    const onPointerMove = (event) => {
      if (!this.isDraggingSelection || this.selectionPointerId !== event.pointerId) return;
      const el = document.elementFromPoint(event.clientX, event.clientY);
      const cell = this.findCellElement(el);
      if (!cell || !this.selectionAnchor) return;
      const current = this.coordsFromCell(cell);
      if (!current) return;
      this.applySelection(this.normalizeSelectionRange(this.selectionAnchor, current));
    };

    const endPointerSelection = (event) => {
      if (this.selectionPointerId !== event.pointerId) return;
      this.isDraggingSelection = false;
      this.selectionPointerId = null;
      if (table.hasPointerCapture?.(event.pointerId)) {
        table.releasePointerCapture?.(event.pointerId);
      }
    };

    const onCopy = (event) => {
      if (this.selectedCellCount() <= 1) return;
      const text = this.selectedTextAsTsv();
      if (!text) return;
      event.preventDefault();
      event.clipboardData?.setData('text/plain', text);
    };

    const onKeyDown = (event) => {
      if (this.handleHistoryShortcut(event, table)) {
        return;
      }

      if (this.selectedCellCount() <= 1) return;
      if (event.key !== 'Backspace' && event.key !== 'Delete') return;
      if (!this.selectionRange || !this.domRefs) return;
      event.preventDefault();
      for (let row = this.selectionRange.fromRow; row <= this.selectionRange.toRow; row++) {
        for (let col = this.selectionRange.fromCol; col <= this.selectionRange.toCol; col++) {
          const input = this.domRefs.allRowInputs[row][col];
          if (input.value !== '') {
            input.value = '';
            this.refreshCellPreviewFromInput(input);
            this.hasPendingCellEdits = true;
          }
        }
      }
      this.scheduleLayout({ resizeRows: true });
    };

    const onFocusOut = (event) => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && table.contains(nextTarget)) return;
      const wrap = this.domRefs?.wrap ?? table;
      this.commit(wrap);
      this.exitTableInteraction(wrap);
    };

    const onDocumentPointerDown = (event) => {
      if (!(event.target instanceof Node)) return;
      const wrap = getWrap();
      if (wrap.contains(event.target) && isModifierLinkActivationEvent(event)) return;
      if (!wrap.contains(event.target)) {
        this.setTableInteractionActive(wrap, false);
      }
      if (isTableControlTarget(event.target)) {
        return;
      }
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !table.contains(active)) return;
      if (active === event.target || active.contains(event.target)) return;

      const targetCell = this.findCellElement(event.target);
      if (targetCell) {
        const targetInput = targetCell.querySelector('textarea');
        if (targetInput !== active) {
          event.preventDefault();
          this.focusCellInput(targetCell, { updateSelection: true });
        }
        return;
      }

      // Defer blur/selection cleanup until after the current click event finishes.
      // `focusout` handles commit when a table input actually loses focus.
      setTimeout(() => {
        if (this.selectedCellCount() > 1) {
          this.exitTableInteraction(wrap);
          return;
        }

        const currentActive = document.activeElement;
        if (currentActive instanceof HTMLElement && table.contains(currentActive)) {
          currentActive.blur();
        } else {
          this.exitTableInteraction(wrap);
        }
      }, 0);
    };

    table.addEventListener('pointerdown', onPointerDown);
    getWrap().addEventListener('pointerdown', onWrapPointerDown, true);
    table.addEventListener('pointermove', onPointerMove);
    table.addEventListener('pointerup', endPointerSelection);
    table.addEventListener('pointercancel', endPointerSelection);
    table.addEventListener('copy', onCopy);
    table.addEventListener('keydown', onKeyDown, true);
    table.addEventListener('focusout', onFocusOut);
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    this.cleanupFns.push(() => {
      table.removeEventListener('pointerdown', onPointerDown);
      getWrap().removeEventListener('pointerdown', onWrapPointerDown, true);
      table.removeEventListener('pointermove', onPointerMove);
      table.removeEventListener('pointerup', endPointerSelection);
      table.removeEventListener('pointercancel', endPointerSelection);
      table.removeEventListener('copy', onCopy);
      table.removeEventListener('keydown', onKeyDown, true);
      table.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('pointerdown', onDocumentPointerDown, true);
    });
  }

  commit(dom) {
    if (!this.hasPendingCellEdits) return;
    this.commitMatrix(this.readCellMatrix(), dom);
  }

  commitMatrix(matrix, dom) {
    const view = EditorView.findFromDOM(dom);
    if (!view) return;

    const { headerCells, rows, alignments = this.tableData.alignments } = matrix;
    if (!headerCells.length) return;
    const range = this.resolveCurrentTableRange(view, dom);
    if (!range) return;
    const markdown = serializeTableMarkdown(this.tableData.indent, headerCells, alignments, rows);
    const current = view.state.doc.sliceString(range.from, range.to);
    if (current === markdown) {
      this.hasPendingCellEdits = false;
      return;
    }

    view.dispatch({ changes: { from: range.from, to: range.to, insert: markdown } });
    this.hasPendingCellEdits = false;
  }

  addRowAfter(dom, rowIndex) {
    const matrix = this.readCellMatrix();
    if (!matrix.headerCells.length) return;
    const insertAt = Math.min(Math.max(rowIndex + 1, 0), matrix.rows.length);
    matrix.rows.splice(insertAt, 0, new Array(matrix.headerCells.length).fill(''));
    this.commitMatrix(matrix, dom);
  }

  addRowBefore(dom, rowIndex) {
    const matrix = this.readCellMatrix();
    if (!matrix.headerCells.length) return;
    const insertAt = Math.min(Math.max(rowIndex, 0), matrix.rows.length);
    matrix.rows.splice(insertAt, 0, new Array(matrix.headerCells.length).fill(''));
    this.commitMatrix(matrix, dom);
  }

  removeRowAt(dom, rowIndex) {
    const matrix = this.readCellMatrix();
    if (matrix.rows.length <= 1) return;
    if (rowIndex < 0 || rowIndex >= matrix.rows.length) return;
    matrix.rows.splice(rowIndex, 1);
    this.commitMatrix(matrix, dom);
  }

  addColumnAfter(dom, colIndex) {
    const matrix = this.readCellMatrix();
    if (!matrix.headerCells.length) return;
    const insertAt = Math.min(Math.max(colIndex + 1, 0), matrix.headerCells.length);
    matrix.headerCells.splice(insertAt, 0, '');
    matrix.rows = matrix.rows.map((row) => {
      const next = row.slice();
      next.splice(insertAt, 0, '');
      return next;
    });
    const alignments = normalizeRow(this.tableData.alignments, matrix.headerCells.length - 1).map((value) => value ?? null);
    alignments.splice(insertAt, 0, null);
    matrix.alignments = alignments;
    this.commitMatrix(matrix, dom);
  }

  addColumnBefore(dom, colIndex) {
    const matrix = this.readCellMatrix();
    if (!matrix.headerCells.length) return;
    const insertAt = Math.min(Math.max(colIndex, 0), matrix.headerCells.length);
    matrix.headerCells.splice(insertAt, 0, '');
    matrix.rows = matrix.rows.map((row) => {
      const next = row.slice();
      next.splice(insertAt, 0, '');
      return next;
    });
    const alignments = normalizeRow(this.tableData.alignments, matrix.headerCells.length - 1).map((value) => value ?? null);
    alignments.splice(insertAt, 0, null);
    matrix.alignments = alignments;
    this.commitMatrix(matrix, dom);
  }

  removeColumnAt(dom, colIndex) {
    const matrix = this.readCellMatrix();
    if (matrix.headerCells.length <= 1) return;
    if (colIndex < 0 || colIndex >= matrix.headerCells.length) return;
    matrix.headerCells.splice(colIndex, 1);
    matrix.rows = matrix.rows.map((row) => {
      const next = row.slice();
      next.splice(colIndex, 1);
      return next;
    });
    const alignments = normalizeRow(this.tableData.alignments, matrix.headerCells.length + 1).map((value) => value ?? null);
    alignments.splice(colIndex, 1);
    matrix.alignments = alignments;
    this.commitMatrix(matrix, dom);
  }

  wireInput(input, rowEl, rowInputs, container, rowIndex, colIndex, preview) {
    const refreshPreview = () => {
      this.renderCellPreview(preview, input.value);
    };
    const getCollapsedCaretLineInfo = () => {
      const start = input.selectionStart ?? 0;
      const end = input.selectionEnd ?? start;
      if (start !== end) return null;
      const value = input.value ?? '';
      const prevNl = value.lastIndexOf('\n', Math.max(0, start - 1));
      const nextNl = value.indexOf('\n', start);
      const lineStart = prevNl + 1;
      return {
        column: start - lineStart,
        isFirstLine: lineStart === 0,
        isLastLine: nextNl < 0
      };
    };
    const onArrowVertical = (event, direction) => {
      if (event.defaultPrevented) return false;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
      if (direction !== 'up' && direction !== 'down') return false;

      const caretInfo = getCollapsedCaretLineInfo();
      if (!caretInfo) return false;

      const atBoundary = direction === 'up' ? caretInfo.isFirstLine : caretInfo.isLastLine;
      if (!atBoundary) return false;

      const nextRow = direction === 'up' ? rowIndex - 1 : rowIndex + 1;
      event.preventDefault();
      event.stopPropagation();

      const nextInput = this.domRefs?.allRowInputs?.[nextRow]?.[colIndex];
      if (nextInput instanceof HTMLTextAreaElement) {
        const nextCaret = Math.min(caretInfo.column, nextInput.value.length);
        return this.focusTableInput(nextInput, nextCaret);
      }

      return this.moveVerticalOutOfTable(container, direction, caretInfo.column);
    };

    input.addEventListener('input', () => {
      this.hasPendingCellEdits = true;
      // The preview layer is hidden while editing. Rebuilding it on each keystroke
      // recreates inline image DOM and resets image load opacity, which causes flicker.
      this.resizeRow(rowEl, rowInputs);
      this.scheduleLayout();
    });
    input.addEventListener('keydown', (event) => {
      const direction = event.key === 'ArrowUp' ? 'up' : event.key === 'ArrowDown' ? 'down' : null;
      if (direction) onArrowVertical(event, direction);
    });
    input.addEventListener('focus', () => {
      this.setCellEditingState(input, true);
      this.setTableInteractionActive(container, true);
      this.setSingleCellSelection({ row: rowIndex, col: colIndex });
    });
    input.addEventListener('blur', (event) => {
      refreshPreview();
      this.setCellEditingState(input, false);
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && container.contains(nextTarget)) return;
      this.commit(container);
      requestAnimationFrame(() => {
        if (this.hasFocusedTableInput(container)) return;
        this.setTableInteractionActive(container, false);
      });
    });
  }

  resizeRow(row, rowInputs = null) {
    if (!row) return;
    const textareas = rowInputs ?? Array.from(row.querySelectorAll('textarea'));
    if (textareas.length === 0) return;

    let maxHeight = 0;
    for (const textarea of textareas) {
      textarea.style.height = 'auto';
      maxHeight = Math.max(maxHeight, textarea.scrollHeight);
    }

    for (const textarea of textareas) {
      textarea.style.height = `${maxHeight}px`;
    }
  }

  resizeAllRows() {
    if (!this.domRefs) return;
    for (const entry of this.domRefs.rowEntries) {
      this.resizeRow(entry.row, entry.inputs);
    }
  }

  measureChPx(container) {
    if (this.chPx > 0) return this.chPx;
    const probe = document.createElement('span');
    probe.textContent = '0';
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.width = '1ch';
    container.appendChild(probe);
    this.chPx = probe.getBoundingClientRect().width || 8;
    probe.remove();
    return this.chPx;
  }

  fitColumnWidths() {
    if (!this.domRefs) return false;
    const { wrap, table, colEls, headerInputs, rowInputs } = this.domRefs;
    const chPx = this.measureChPx(wrap);
    const minPx = minColumnWidthCh * chPx;
    const maxPx = maxColumnWidthCh * chPx;
    const livePreferredCh = computePreferredColumnCharWidthsFromInputs(headerInputs, rowInputs, this.tableData.colCount);
    const preferredPx = livePreferredCh.map((ch) => Math.max(minPx, Math.min(maxPx, ch * chPx)));
    const preferredTotal = preferredPx.reduce((sum, value) => sum + value, 0);
    const total = preferredTotal || 1;

    const nextAppliedWidths = new Array(colEls.length);
    let changed = colEls.length !== this.lastAppliedWidths.length;
    for (let i = 0; i < colEls.length; i++) {
      const ratio = preferredPx[i] / total;
      const widthPermille = Math.round(ratio * 1000);
      nextAppliedWidths[i] = widthPermille;
      if (!changed && this.lastAppliedWidths[i] !== widthPermille) changed = true;
      colEls[i].style.width = `${(ratio * 100).toFixed(4)}%`;
      colEls[i].style.minWidth = '0';
      colEls[i].style.maxWidth = 'none';
    }
    this.lastAppliedWidths = nextAppliedWidths;
    wrap.style.width = `${Math.round(preferredTotal)}px`;
    wrap.style.maxWidth = '100%';
    table.style.width = '100%';
    table.style.maxWidth = '100%';
    return changed;
  }

  recalcLayout() {
    const widthsChanged = this.fitColumnWidths();
    if (this.pendingResizeRows || widthsChanged) {
      this.resizeAllRows();
    }
  }

  scheduleLayout({ resizeRows = false } = {}) {
    if (resizeRows) this.pendingResizeRows = true;
    if (this.layoutFrame) return;
    this.layoutFrame = requestAnimationFrame(() => {
      this.layoutFrame = 0;
      this.recalcLayout();
      this.pendingResizeRows = false;
    });
  }

  renderCellPreview(preview, value) {
    if (!(preview instanceof HTMLElement)) return;
    renderTableCellInlinePreview(preview, value ?? '');
  }

  refreshCellPreviewFromInput(input) {
    if (!(input instanceof HTMLTextAreaElement)) return;
    const preview = input.parentElement?.querySelector('.meo-md-html-table-cell-preview');
    this.renderCellPreview(preview, input.value);
  }

  setCellEditingState(input, isEditing) {
    const content = input?.parentElement;
    if (!(content instanceof HTMLElement)) return;
    content.classList.toggle('is-editing', isEditing);
  }

  createCellPreview(value) {
    const preview = document.createElement('div');
    preview.className = 'meo-md-html-table-cell-preview';
    preview.setAttribute('aria-hidden', 'true');
    this.renderCellPreview(preview, value);
    return preview;
  }

  createCellInput(value, rowIndex, colIndex) {
    const input = document.createElement('textarea');
    input.rows = 1;
    input.value = value;
    input.dataset.tableRow = String(rowIndex);
    input.dataset.tableCol = String(colIndex);
    return input;
  }

  createCellEditor(value, rowEl, rowInputs, container, rowIndex, colIndex) {
    const content = document.createElement('div');
    content.className = 'meo-md-html-table-cell-content';
    const preview = this.createCellPreview(value);
    const input = this.createCellInput(value, rowIndex, colIndex);
    this.wireInput(input, rowEl, rowInputs, container, rowIndex, colIndex, preview);
    content.append(preview, input);
    return { content, input };
  }

  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'meo-md-html-table-wrap';

    const table = document.createElement('table');
    table.className = 'meo-md-html-table';
    const colgroup = document.createElement('colgroup');
    const colEls = [];
    for (let col = 0; col < this.tableData.colCount; col++) {
      const colEl = document.createElement('col');
      colEls.push(colEl);
      colgroup.appendChild(colEl);
    }
    table.appendChild(colgroup);
    const rowEntries = [];
    const headerInputs = [];
    const cellGrid = [];
    const allRowInputs = [];

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    rowEntries.push({ row: headerRow, inputs: headerInputs });
    const headerCells = [];
    for (let col = 0; col < this.tableData.colCount; col++) {
      const th = document.createElement('th');
      th.dataset.tableRow = '0';
      th.dataset.tableCol = String(col);
      const { content, input } = this.createCellEditor(this.tableData.headerCells[col] ?? '', headerRow, headerInputs, wrap, 0, col);
      headerInputs.push(input);
      headerCells.push(th);
      th.appendChild(content);

      if (col === 0) {
        const leftInsertControls = document.createElement('div');
        leftInsertControls.className = 'meo-md-html-col-controls meo-md-html-col-controls-left-insert';
        const leftInsertBtn = document.createElement('button');
        leftInsertBtn.type = 'button';
        leftInsertBtn.tabIndex = -1;
        leftInsertBtn.className = 'meo-md-html-col-btn';
        leftInsertBtn.textContent = '+';
        leftInsertBtn.title = 'Add column before';
        leftInsertBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.addColumnBefore(wrap, 0);
        });
        leftInsertControls.append(leftInsertBtn);
        th.appendChild(leftInsertControls);
      }

      const colControls = document.createElement('div');
      colControls.className = 'meo-md-html-col-controls';
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.tabIndex = -1;
      removeBtn.className = 'meo-md-html-col-btn';
      removeBtn.textContent = '−';
      removeBtn.title = 'Delete left column';
      removeBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.removeColumnAt(wrap, col);
      });
      const insertBtn = document.createElement('button');
      insertBtn.type = 'button';
      insertBtn.tabIndex = -1;
      insertBtn.className = 'meo-md-html-col-btn';
      insertBtn.textContent = '+';
      insertBtn.title = 'Add column to the right';
      insertBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.addColumnAfter(wrap, col);
      });
      colControls.append(removeBtn, insertBtn);
      th.appendChild(colControls);
      headerRow.appendChild(th);
    }
    cellGrid.push(headerCells);
    allRowInputs.push(headerInputs);
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    const bodyRowInputs = [];
    for (let rowIdx = 0; rowIdx < this.tableData.rows.length; rowIdx++) {
      const tr = document.createElement('tr');
      const inputs = [];
      rowEntries.push({ row: tr, inputs });
      const bodyCells = [];
      const tableRowIndex = rowIdx + 1;
      for (let col = 0; col < this.tableData.colCount; col++) {
        const td = document.createElement('td');
        td.dataset.tableRow = String(tableRowIndex);
        td.dataset.tableCol = String(col);
        const { content, input } = this.createCellEditor(this.tableData.rows[rowIdx][col] ?? '', tr, inputs, wrap, tableRowIndex, col);
        inputs.push(input);
        bodyCells.push(td);
        td.appendChild(content);

        if (col === 0) {
          if (rowIdx === 0) {
            const topInsertControls = document.createElement('div');
            topInsertControls.className = 'meo-md-html-row-controls meo-md-html-row-controls-top-insert';
            const topInsertBtn = document.createElement('button');
            topInsertBtn.type = 'button';
            topInsertBtn.tabIndex = -1;
            topInsertBtn.className = 'meo-md-html-row-btn';
            topInsertBtn.textContent = '+';
            topInsertBtn.title = 'Add row above';
            topInsertBtn.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              this.addRowBefore(wrap, 0);
            });
            topInsertControls.append(topInsertBtn);
            td.appendChild(topInsertControls);
          }

          const rowControls = document.createElement('div');
          rowControls.className = 'meo-md-html-row-controls';
          const removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.tabIndex = -1;
          removeBtn.className = 'meo-md-html-row-btn';
          removeBtn.textContent = '−';
          removeBtn.title = 'Delete row above';
          removeBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.removeRowAt(wrap, rowIdx);
          });
          const insertBtn = document.createElement('button');
          insertBtn.type = 'button';
          insertBtn.tabIndex = -1;
          insertBtn.className = 'meo-md-html-row-btn';
          insertBtn.textContent = '+';
          insertBtn.title = 'Add row below';
          insertBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.addRowAfter(wrap, rowIdx);
          });
          rowControls.append(removeBtn, insertBtn);
          td.appendChild(rowControls);
        }
        tr.appendChild(td);
      }
      cellGrid.push(bodyCells);
      allRowInputs.push(inputs);
      bodyRowInputs.push(inputs);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    wrap.appendChild(table);
    this.domRefs = { wrap, table, colEls, rowEntries, headerInputs, rowInputs: bodyRowInputs, allRowInputs, cellGrid };
    this.wireTableSelection(table);
    this.pendingResizeRows = true;
    this.scheduleLayout({ resizeRows: true });

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        this.chPx = 0;
        this.scheduleLayout({ resizeRows: true });
      });
      observer.observe(wrap);
      const view = EditorView.findFromDOM(wrap);
      const resizeTargets = [view?.contentDOM, view?.scrollDOM, view?.dom, wrap.parentElement];
      for (const target of resizeTargets) {
        if (target && target !== wrap) observer.observe(target);
      }
      wrap._meoTableResizeObserver = observer;
    }
    return wrap;
  }

  ignoreEvent() {
    return true;
  }

  destroy(dom) {
    for (const cleanup of this.cleanupFns) cleanup();
    this.cleanupFns = [];
    dom?._meoTableResizeObserver?.disconnect();
    if (this.layoutFrame) {
      cancelAnimationFrame(this.layoutFrame);
      this.layoutFrame = 0;
    }
    this.domRefs = null;
    this.selectionAnchor = null;
    this.selectionRange = null;
    this.selectionPointerId = null;
    this.isDraggingSelection = false;
    this.hasPendingCellEdits = false;
  }
}

export function isTableDelimiterLine(lineText) {
  return tableDelimiterRegex.test(lineText);
}

export function parseTableInfo(state, tableNode) {
  const data = buildTableData(state, tableNode);
  const { from, to, lines, delimiterIdx, headerLine, dataLines, alignments, colCount, startLine, endLine } = data;

  const parseRow = (line) => ({
    from: line.from,
    to: line.to,
    lineNo: line.lineNo,
    lineFrom: line.from,
    lineTo: line.to,
    cells: line.cells.map((content, index) => ({
      from: line.segments[index]?.from ?? line.from,
      to: line.segments[index]?.to ?? line.from,
      content
    }))
  });

  return {
    from,
    to,
    startLine,
    endLine,
    headerRow: headerLine ? parseRow(headerLine) : null,
    delimiterRow: delimiterIdx >= 0
      ? {
        from: lines[delimiterIdx].from,
        to: lines[delimiterIdx].to,
        lineNo: lines[delimiterIdx].lineNo,
        lineFrom: lines[delimiterIdx].from,
        lineTo: lines[delimiterIdx].to,
        alignments
      }
      : null,
    rows: dataLines.map(parseRow),
    columnCount: colCount
  };
}

export function addTableDecorations(builder, state, tableNode) {
  const data = buildTableData(state, tableNode);
  addTableWidgetDecoration(builder, data);
}

export function addTableDecorationsForLineRange(builder, state, startLineNo, endLineNo) {
  const data = buildTableDataForLineRange(state, startLineNo, endLineNo);
  addTableWidgetDecoration(builder, data);
}

function addTableWidgetDecoration(builder, data) {
  const { from, to, headerLine, dataLines, alignments, colCount } = data;
  if (colCount === 0 || !headerLine) return;

  const indent = /^(\s*)/.exec(headerLine.text)?.[1] ?? '';
  const normalizedAlignments = normalizeRow(alignments, colCount).map((value) => value ?? null);
  const headerCells = normalizeRow(headerLine.cells, colCount);
  const rows = dataLines.map((line) => normalizeRow(line.cells, colCount));
  const signature = JSON.stringify({
    colCount,
    headerCells,
    rows,
    normalizedAlignments
  });

  builder.push(
    Decoration.replace({
      block: true,
      widget: new HtmlTableWidget(
        { from, to, indent, colCount, alignments: normalizedAlignments, headerCells, rows, signature }
      )
    }).range(from, to)
  );
}

function buildSourceTableHeaderDecorations(state) {
  const ranges = [];
  const tree = syntaxTree(state);
  const parsedTableRanges = [];
  const decoratedHeaderLines = new Set();

  tree.iterate({
    enter(node) {
      if (node.name !== 'Table') return;

      const data = buildTableData(state, node);
      if (!data.headerLine) return;
      parsedTableRanges.push({ from: data.from, to: data.to });

      addSourceHeaderLineDecorations(ranges, data.headerLine);
      decoratedHeaderLines.add(data.headerLine.lineNo);
    }
  });

  for (let lineNo = 2; lineNo <= state.doc.lines; lineNo += 1) {
    const delimiterLine = state.doc.line(lineNo);
    const delimiterText = state.doc.sliceString(delimiterLine.from, delimiterLine.to);
    if (!isTableDelimiterLine(delimiterText)) continue;

    const headerLineNo = lineNo - 1;
    if (decoratedHeaderLines.has(headerLineNo)) continue;
    const headerLine = state.doc.line(headerLineNo);
    const headerText = state.doc.sliceString(headerLine.from, headerLine.to);
    if (!isTableContentLine(headerText)) continue;
    if (overlapsParsedTableRange(headerLine.from, delimiterLine.to, parsedTableRanges)) continue;
    if (isPositionInsideCodeBlock(tree, headerLine.from)) continue;

    const parsedHeaderLine = parseTableLine(headerLineNo, headerLine.from, headerLine.to, headerText);
    addSourceHeaderLineDecorations(ranges, parsedHeaderLine);
    decoratedHeaderLines.add(headerLineNo);
  }

  return Decoration.set(ranges, true);
}

function addSourceHeaderLineDecorations(ranges, line) {
  ranges.push(sourceTableHeaderLineDeco.range(line.from));
  for (const seg of line.segments) {
    ranges.push(sourceTableHeaderCellDeco.range(seg.from, seg.to));
  }
}

function overlapsParsedTableRange(from, to, ranges) {
  return ranges.some((range) => from < range.to && to > range.from);
}

function isPositionInsideCodeBlock(tree, pos) {
  let node = tree.resolveInner(pos, 1);
  while (node) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') return true;
    node = node.parent;
  }
  return false;
}

export const sourceTableHeaderLineField = StateField.define({
  create(state) {
    try {
      return buildSourceTableHeaderDecorations(state);
    } catch {
      return Decoration.none;
    }
  },
  update(decorations, transaction) {
    if (!transaction.docChanged) {
      return decorations;
    }
    try {
      return buildSourceTableHeaderDecorations(transaction.state);
    } catch {
      return decorations;
    }
  },
  provide: (field) => EditorView.decorations.from(field)
});

export function insertTable(view, selection, cols = 3, rows = 2) {
  const line = view.state.doc.lineAt(selection.from);
  const lineText = view.state.doc.sliceString(line.from, line.to);
  const leadingWhitespace = /^(\s*)/.exec(lineText)?.[1] ?? '';

  const headerCells = Array.from({ length: cols }, () => '  ').join('|');
  const separatorCells = Array.from({ length: cols }, () => ' --- ').join('|');
  const bodyRows = Array.from({ length: rows }, () => {
    const cells = Array.from({ length: cols }, () => '  ').join('|');
    return `${leadingWhitespace}|${cells}|`;
  }).join('\n');

  const table = `${leadingWhitespace}|${headerCells}|\n${leadingWhitespace}|${separatorCells}|\n${bodyRows}`;

  view.dispatch({
    changes: { from: line.from, to: line.to, insert: table },
    selection: { anchor: line.from + leadingWhitespace.length + 2 }
  });
}
