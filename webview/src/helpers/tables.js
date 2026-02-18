import { StateField } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';

const sourceTableHeaderLineDeco = Decoration.line({ class: 'meo-md-source-table-header-line' });
const sourceTableHeaderCellDeco = Decoration.mark({ class: 'meo-md-source-table-header-cell' });
const tableDelimiterRegex = /^\|?\s*[:]?\-+[:]?\s*(\|\s*[:]?\-+[:]?\s*)+\|?$/;
const tableCellSelector = 'th[data-table-row][data-table-col], td[data-table-row][data-table-col]';
const tableControlSelector = '.meo-md-html-col-controls, .meo-md-html-row-controls, .meo-md-html-col-btn, .meo-md-html-row-btn';
const minColumnWidthCh = 10;
const maxColumnWidthCh = 40;

function isTableControlTarget(target) {
  return target instanceof Element && target.closest(tableControlSelector);
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

function parseLineText(lineText) {
  const leadingWhitespaceLen = /^(\s*)/.exec(lineText)?.[1].length ?? 0;
  let content = lineText.slice(leadingWhitespaceLen).trim();
  if (content.startsWith('|')) content = content.slice(1);
  if (content.endsWith('|')) content = content.slice(0, -1);
  const rawCells = content.split('|').map((cell) => cell.trim());
  return rawCells.length === 1 && rawCells[0] === '' ? [] : rawCells;
}

function parsePipePositions(lineText, lineFrom) {
  const pipes = [];
  for (let i = 0; i < lineText.length; i++) {
    if (lineText[i] === '|') pipes.push(i);
  }

  const segments = [];
  for (let i = 0; i + 1 < pipes.length; i++) {
    const rawFrom = pipes[i] + 1;
    const rawTo = pipes[i + 1];
    let from = rawFrom;
    let to = rawTo;
    if (from < to && lineText[from] === ' ') from++;
    if (to > from && lineText[to - 1] === ' ') to--;
    if (to <= from) {
      segments.push({ from: lineFrom + rawFrom, to: lineFrom + rawTo, cellIndex: i, empty: true });
      continue;
    }
    segments.push({ from: lineFrom + from, to: lineFrom + to, cellIndex: i, empty: false });
  }

  return { pipes, segments };
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
  const cells = parseLineText(text);
  const { pipes, segments } = parsePipePositions(text, from);
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
      other.tableData.from === this.tableData.from &&
      other.tableData.to === this.tableData.to
    );
  }

  resolveCurrentTableRange(view, dom) {
    const tableFrom = this.tableData?.from;
    const tableTo = this.tableData?.to;
    if (isValidTableRange(tableFrom, tableTo, view.state.doc.length)) {
      return { from: tableFrom, to: tableTo };
    }

    let pos = 0;
    try {
      pos = view.posAtDOM(dom, 0);
    } catch {
      return null;
    }

    let node = syntaxTree(view.state).resolveInner(pos, 1);
    while (node) {
      if (node.name === 'Table') {
        return { from: node.from, to: node.to };
      }
      node = node.parent;
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

  focusCellInput(cell, { updateSelection = false } = {}) {
    const input = cell.querySelector('textarea');
    if (!(input instanceof HTMLTextAreaElement)) return false;
    input.focus({ preventScroll: true });
    const caret = input.value.length;
    input.setSelectionRange(caret, caret);
    if (!updateSelection) return true;
    const coords = this.coordsFromCell(cell);
    if (coords) {
      this.setSingleCellSelection(coords);
    }
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
    const { cellGrid } = this.domRefs;
    for (let row = 0; row < cellGrid.length; row++) {
      const cells = cellGrid[row];
      for (let col = 0; col < cells.length; col++) {
        const selected = this.isCellSelected(row, col, range);
        cells[col].classList.toggle('meo-md-html-table-cell-selected', selected);
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

  wireTableSelection(table) {
    const getWrap = () => this.domRefs?.wrap ?? table;

    const onWrapPointerDown = (event) => {
      if (!(event.target instanceof Node)) return;
      const wrap = getWrap();
      if (!wrap.contains(event.target)) return;
      this.setTableInteractionActive(wrap, true);
    };

    const onPointerDown = (event) => {
      if (event.button !== 0) return;
      if (isTableControlTarget(event.target)) return;
      const cell = this.findCellElement(event.target);
      if (!cell) return;
      const current = this.coordsFromCell(cell);
      if (!current) return;
      const anchor = current;
      this.selectionAnchor = anchor;
      this.applySelection(this.normalizeSelectionRange(anchor, current));
      this.selectionPointerId = event.pointerId;
      this.isDraggingSelection = true;
      table.setPointerCapture?.(event.pointerId);

      if (!(event.target instanceof HTMLTextAreaElement)) {
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
    table.addEventListener('focusout', onFocusOut);
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    this.cleanupFns.push(() => {
      table.removeEventListener('pointerdown', onPointerDown);
      getWrap().removeEventListener('pointerdown', onWrapPointerDown, true);
      table.removeEventListener('pointermove', onPointerMove);
      table.removeEventListener('pointerup', endPointerSelection);
      table.removeEventListener('pointercancel', endPointerSelection);
      table.removeEventListener('copy', onCopy);
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

  wireInput(input, rowEl, rowInputs, container, rowIndex, colIndex) {
    input.addEventListener('input', () => {
      this.hasPendingCellEdits = true;
      this.resizeRow(rowEl, rowInputs);
      this.scheduleLayout();
    });
    input.addEventListener('focus', () => {
      this.setTableInteractionActive(container, true);
      this.setSingleCellSelection({ row: rowIndex, col: colIndex });
    });
    input.addEventListener('blur', (event) => {
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

  createCellInput(value, rowEl, rowInputs, container, rowIndex, colIndex) {
    const input = document.createElement('textarea');
    input.rows = 1;
    input.value = value;
    input.dataset.tableRow = String(rowIndex);
    input.dataset.tableCol = String(colIndex);
    this.wireInput(input, rowEl, rowInputs, container, rowIndex, colIndex);
    return input;
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
      const input = this.createCellInput(this.tableData.headerCells[col] ?? '', headerRow, headerInputs, wrap, 0, col);
      headerInputs.push(input);
      headerCells.push(th);
      th.appendChild(input);

      if (col === 0) {
        const leftInsertControls = document.createElement('div');
        leftInsertControls.className = 'meo-md-html-col-controls meo-md-html-col-controls-left-insert';
        const leftInsertBtn = document.createElement('button');
        leftInsertBtn.type = 'button';
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
        const input = this.createCellInput(this.tableData.rows[rowIdx][col] ?? '', tr, inputs, wrap, tableRowIndex, col);
        inputs.push(input);
        bodyCells.push(td);
        td.appendChild(input);

        if (col === 0) {
          if (rowIdx === 0) {
            const topInsertControls = document.createElement('div');
            topInsertControls.className = 'meo-md-html-row-controls meo-md-html-row-controls-top-insert';
            const topInsertBtn = document.createElement('button');
            topInsertBtn.type = 'button';
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
  create: buildSourceTableHeaderDecorations,
  update: (decorations, transaction) => (
    transaction.docChanged ? buildSourceTableHeaderDecorations(transaction.state) : decorations
  ),
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
