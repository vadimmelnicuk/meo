import { StateField } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';

const tableLineDeco = Decoration.line({ class: 'meo-md-table-line' });
const tableHeaderLineDeco = Decoration.line({ class: 'meo-md-table-header-line' });
const tableDelimLineDeco = Decoration.line({ class: 'meo-md-table-delim-line' });
const sourceTableHeaderLineDeco = Decoration.line({ class: 'meo-md-source-table-header-line' });
const tableDelimiterRegex = /^\|?\s*[:]?-+[:]?\s*(\|\s*[:]?-+[:]?\s*)+\|?$/;

const tablePipeHideDeco = Decoration.replace({});
const tableCellPadSpaceDeco = Decoration.mark({ class: 'meo-md-table-pad-space' });
const sourceTableHeaderCellDeco = Decoration.mark({ class: 'meo-md-source-table-header-cell' });
const tableCellDecoCache = new Map();
const maxCellWidthCh = 32;
const tableLineBreakRegex = /<br\s*\/?>/gi;

const tableLineBreakDeco = Decoration.replace({ 
  widget: new (class extends WidgetType {
    toDOM() { return document.createElement('br'); }
  })()
});

function tableCellDeco(width, columnCount, isLastCell) {
  const key = `${width}:${columnCount}:${isLastCell ? 1 : 0}`;
  let deco = tableCellDecoCache.get(key);
  if (!deco) {
    const safeCols = Math.max(columnCount, 1);
    const safeWidth = Math.max(width, 12);
    const responsiveMax = `min(${safeWidth}ch, calc(100% / ${safeCols}))`;
    const responsiveMin = `min(12ch, calc(100% / ${safeCols}))`;
    deco = Decoration.mark({
      class: isLastCell ? 'meo-md-table-cell meo-md-table-cell-last' : 'meo-md-table-cell',
      attributes: {
        style: `flex: 1 1 ${responsiveMax}; width: ${responsiveMax}; min-width: ${responsiveMin}; max-width: ${responsiveMax};`
      }
    });
    tableCellDecoCache.set(key, deco);
  }
  return deco;
}

function parseLineText(lineText) {
  const leading = /^(\s*)/.exec(lineText)?.[1] ?? '';
  let content = lineText.slice(leading.length).trim();
  if (content.startsWith('|')) content = content.slice(1);
  if (content.endsWith('|')) content = content.slice(0, -1);
  const rawCells = content.split('|').map(c => c.trim());
  return { leading, cells: rawCells.length === 1 && rawCells[0] === '' ? [] : rawCells };
}

function parsePipePositions(lineText, lineFrom) {
  const pipes = [];
  for (let i = 0; i < lineText.length; i++) {
    if (lineText[i] === '|') pipes.push(i);
  }
  const segments = [];
  for (let i = 0; i + 1 < pipes.length; i++) {
    let from = pipes[i] + 1;
    let to = pipes[i + 1];
    if (from < to && lineText[from] === ' ') from++;
    if (to > from && lineText[to - 1] === ' ') to--;
    if (to > from) {
      segments.push({ from: lineFrom + from, to: lineFrom + to, cellIndex: i });
    }
  }
  return { pipes, segments };
}

function parseDelimiterAlignments(lineText) {
  const alignments = [];
  const parts = lineText.split('|').filter(p => p.trim());
  for (const part of parts) {
    const t = part.trim();
    const left = t.startsWith(':');
    const right = t.endsWith(':');
    alignments.push(left && right ? 'center' : left ? 'left' : right ? 'right' : null);
  }
  return alignments;
}

function buildTableData(state, tableNode) {
  const startLine = state.doc.lineAt(tableNode.from);
  const endLine = state.doc.lineAt(Math.max(tableNode.to - 1, tableNode.from));
  const lines = [];
  let delimiterIdx = -1;
  
  for (let lineNo = startLine.number; lineNo <= endLine.number; lineNo++) {
    const line = state.doc.line(lineNo);
    const text = state.doc.sliceString(line.from, line.to);
    const isDelim = tableDelimiterRegex.test(text);
    if (isDelim && delimiterIdx === -1) delimiterIdx = lines.length;
    lines.push({ lineNo, from: line.from, to: line.to, text, isDelim });
  }
  
  const headerLine = delimiterIdx > 0 ? lines[delimiterIdx - 1] : null;
  const dataLines = delimiterIdx >= 0 ? lines.slice(delimiterIdx + 1) : [];
  const alignments = delimiterIdx >= 0 ? parseDelimiterAlignments(lines[delimiterIdx].text) : [];
  const colCount = headerLine 
    ? parseLineText(headerLine.text).cells.length 
    : dataLines[0] ? parseLineText(dataLines[0].text).cells.length : 0;
  
  return { lines, delimiterIdx, headerLine, dataLines, alignments, colCount, startLine: startLine.number, endLine: endLine.number };
}

function computeColumnWidths(tableData) {
  const { headerLine, dataLines, colCount } = tableData;
  if (colCount === 0) return [];
  
  const widths = new Array(colCount).fill(0);
  
  const update = (line) => {
    if (!line) return;
    const { cells } = parseLineText(line.text);
    for (let i = 0; i < cells.length && i < colCount; i++) {
      widths[i] = Math.max(widths[i], cells[i].length);
    }
  };
  
  update(headerLine);
  for (const line of dataLines) update(line);
  
  return widths.map(w => Math.min(Math.max(w, 12), maxCellWidthCh));
}

export function parseTableInfo(state, tableNode) {
  const data = buildTableData(state, tableNode);
  const { lines, delimiterIdx, headerLine, dataLines, alignments, colCount, startLine, endLine } = data;
  
  const parseRow = (line) => ({
    from: line.from,
    to: line.to,
    lineNo: line.lineNo,
    lineFrom: line.from,
    lineTo: line.to,
    cells: parseLineText(line.text).cells.map((content, index) => ({
      from: line.from + index,
      to: line.from + index + 1,
      content
    }))
  });
  
  return {
    from: tableNode.from,
    to: tableNode.to,
    startLine,
    endLine,
    headerRow: headerLine ? parseRow(headerLine) : null,
    delimiterRow: delimiterIdx >= 0 ? {
      from: lines[delimiterIdx].from,
      to: lines[delimiterIdx].to,
      lineNo: lines[delimiterIdx].lineNo,
      lineFrom: lines[delimiterIdx].from,
      lineTo: lines[delimiterIdx].to,
      alignments
    } : null,
    rows: dataLines.map(parseRow),
    columnCount: colCount
  };
}

export function addTableDecorations(builder, state, tableNode, activeLines, addRange) {
  const data = buildTableData(state, tableNode);
  const { lines, delimiterIdx, headerLine, dataLines, colCount } = data;
  
  if (colCount === 0) return;
  
  const widths = computeColumnWidths(data);
  const allDataLines = headerLine ? [headerLine, ...dataLines] : dataLines;
  
  for (const line of lines) {
    builder.push(tableLineDeco.range(line.from));
  }
  
  if (headerLine) {
    builder.push(tableHeaderLineDeco.range(headerLine.from));
  }
  
  if (delimiterIdx >= 0) {
    builder.push(tableDelimLineDeco.range(lines[delimiterIdx].from));
  }
  
  for (const line of allDataLines) {
    const { pipes, segments } = parsePipePositions(line.text, line.from);
    
    for (const pipeIdx of pipes) {
      const pipePos = line.from + pipeIdx;
      addRange(builder, pipePos, pipePos + 1, tablePipeHideDeco);
      
      if (pipeIdx > 0 && line.text[pipeIdx - 1] === ' ') {
        addRange(builder, line.from + pipeIdx - 1, line.from + pipeIdx, tableCellPadSpaceDeco);
      }
      if (pipeIdx + 1 < line.text.length && line.text[pipeIdx + 1] === ' ') {
        addRange(builder, line.from + pipeIdx + 1, line.from + pipeIdx + 2, tableCellPadSpaceDeco);
      }
    }
    
    const count = Math.min(segments.length, widths.length);
    for (let i = 0; i < count; i++) {
      const seg = segments[i];
      addRange(builder, seg.from, seg.to, tableCellDeco(widths[i], colCount, i === count - 1));
    }
    
    tableLineBreakRegex.lastIndex = 0;
    let match;
    while ((match = tableLineBreakRegex.exec(line.text)) !== null) {
      const from = line.from + match.index;
      const to = from + match[0].length;
      addRange(builder, from, to, tableLineBreakDeco);
    }
  }
}

function buildSourceTableHeaderDecorations(state) {
  const ranges = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'Table') return;
      const data = buildTableData(state, node);
      if (!data.headerLine) return;
      
      const line = data.headerLine;
      ranges.push(sourceTableHeaderLineDeco.range(line.from));
      
      const { segments } = parsePipePositions(line.text, line.from);
      for (const seg of segments) {
        ranges.push(sourceTableHeaderCellDeco.range(seg.from, seg.to));
      }
    }
  });
  return Decoration.set(ranges, true);
}

export const sourceTableHeaderLineField = StateField.define({
  create: buildSourceTableHeaderDecorations,
  update: (deco, tr) => tr.docChanged ? buildSourceTableHeaderDecorations(tr.state) : deco,
  provide: (field) => EditorView.decorations.from(field)
});

function formatTableRow(leading, cells) {
  return `${leading}|${cells.map(c => ` ${c.trim()} `).join('|')}|`;
}

export function insertTable(view, selection) {
  const { state } = view;
  const line = state.doc.lineAt(selection.from);
  const lineText = state.doc.sliceString(line.from, line.to);
  const leadingWhitespace = /^(\s*)/.exec(lineText)?.[1] ?? '';
  
  const table = `${leadingWhitespace}| Header 1 | Header 2 | Header 3 |
${leadingWhitespace}| --- | --- | --- |
${leadingWhitespace}| Cell 1 | Cell 2 | Cell 3 |`;
  
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: table },
    selection: { anchor: line.from + leadingWhitespace.length + 2 }
  });
}
