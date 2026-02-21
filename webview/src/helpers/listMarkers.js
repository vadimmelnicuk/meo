import { StateField, RangeSetBuilder } from '@codemirror/state';
import { Decoration, WidgetType, EditorView } from '@codemirror/view';
import { base02 } from '../theme';

const sourceListMarkerDeco = Decoration.mark({ class: 'meo-md-list-prefix' });
const taskCompleteDeco = Decoration.mark({ class: 'meo-task-complete' });
const listItemRegex = /^(\s*)(?:[-+*]|\d+[.)])\s+/;
const listMarkerRegex = /^(\s*)(?:([-+*])|(\d+)([.)]))\s+(?:\[([ xX])\]\s+)?/;
const TWO_SPACE_INDENT = '  ';
const FOUR_SPACE_INDENT = '    ';
const TAB_INDENT = '\t';
const TWO_SPACE_INDENT_COLUMNS = 2;
const FOUR_SPACE_INDENT_COLUMNS = 4;

const listIndentStyle = {
  twoSpaces: {
    columns: TWO_SPACE_INDENT_COLUMNS,
    insert: TWO_SPACE_INDENT
  },
  fourSpaces: {
    columns: FOUR_SPACE_INDENT_COLUMNS,
    insert: FOUR_SPACE_INDENT
  },
  tabs: {
    columns: FOUR_SPACE_INDENT_COLUMNS,
    insert: TAB_INDENT
  }
};

const defaultListIndentStyle = listIndentStyle.twoSpaces;
const listBorderDecoCache = new Map();

function listBorderDecoration(widthColumns = 1) {
  const width = Math.max(1, widthColumns);
  let deco = listBorderDecoCache.get(width);
  if (deco) {
    return deco;
  }

  deco = Decoration.mark({
    class: 'meo-md-list-border',
    attributes: { style: `--meo-list-border-width:${width}ch;` }
  });
  listBorderDecoCache.set(width, deco);
  return deco;
}

function forEachSelectionLine(state, callback) {
  const seen = new Set();
  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from).number;
    const toPos = Math.max(range.from, range.to - (range.empty ? 0 : 1));
    const toLine = state.doc.lineAt(toPos).number;
    for (let lineNumber = fromLine; lineNumber <= toLine; lineNumber += 1) {
      if (seen.has(lineNumber)) {
        continue;
      }
      seen.add(lineNumber);
      callback(state.doc.line(lineNumber));
    }
  }
}

function isListLine(lineText) {
  return listItemRegex.test(lineText);
}

function inferListIndentStyle(listLineTexts) {
  const spaceIndents = [];
  for (const lineText of listLineTexts) {
    const match = listItemRegex.exec(lineText);
    if (!match || !match[1]) {
      continue;
    }

    const leadingWhitespace = match[1];
    if (leadingWhitespace.includes('\t')) {
      return listIndentStyle.tabs;
    }

    if (/^ +$/.test(leadingWhitespace)) {
      spaceIndents.push(leadingWhitespace.length);
    }
  }

  if (!spaceIndents.length) {
    return defaultListIndentStyle;
  }

  const isFourSpaceList = spaceIndents.every((length) => length % FOUR_SPACE_INDENT_COLUMNS === 0);
  return isFourSpaceList ? listIndentStyle.fourSpaces : defaultListIndentStyle;
}

export function detectListIndentStylesByLine(state) {
  const stylesByLine = new Map();
  let lineNo = 1;

  while (lineNo <= state.doc.lines) {
    const startLineNo = lineNo;
    const listLineTexts = [];

    while (lineNo <= state.doc.lines) {
      const line = state.doc.line(lineNo);
      const lineText = state.doc.sliceString(line.from, line.to);
      if (!isListLine(lineText)) {
        break;
      }
      listLineTexts.push(lineText);
      lineNo += 1;
    }

    if (!listLineTexts.length) {
      lineNo += 1;
      continue;
    }

    const style = inferListIndentStyle(listLineTexts);
    for (let currentLine = startLineNo; currentLine < lineNo; currentLine += 1) {
      stylesByLine.set(currentLine, style);
    }
  }

  return stylesByLine;
}

function lineIndentStyle(lineNumber, stylesByLine) {
  return stylesByLine?.get(lineNumber) ?? defaultListIndentStyle;
}

function indentationColumns(leadingWhitespace, style = defaultListIndentStyle) {
  let columns = 0;
  for (let index = 0; index < leadingWhitespace.length; index += 1) {
    columns += leadingWhitespace[index] === '\t' ? style.columns : 1;
  }
  return columns;
}

function listBorderOffsets(leadingWhitespace, style = defaultListIndentStyle) {
  const offsets = [];
  let columns = 0;
  let levelStart = 0;

  for (let index = 0; index < leadingWhitespace.length; index += 1) {
    if (columns === 0) {
      levelStart = index;
    }
    columns += leadingWhitespace[index] === '\t' ? style.columns : 1;
    if (columns >= style.columns) {
      offsets.push(levelStart);
      columns = 0;
    }
  }

  return offsets;
}

function addListIndentBorders(addRange, lineStart, leadingWhitespace, style = defaultListIndentStyle) {
  for (const offset of listBorderOffsets(leadingWhitespace, style)) {
    const char = leadingWhitespace[offset];
    const borderWidth = char === '\t' ? style.columns : 1;
    addRange(lineStart + offset, lineStart + offset + 1, listBorderDecoration(borderWidth));
  }
}

export function indentListByTwoSpaces(view) {
  const { state } = view;
  const stylesByLine = detectListIndentStylesByLine(state);
  const changes = [];

  forEachSelectionLine(state, (line) => {
    const lineText = state.doc.sliceString(line.from, line.to);
    if (!isListLine(lineText)) {
      return;
    }
    const style = lineIndentStyle(line.number, stylesByLine);
    changes.push({ from: line.from, insert: style.insert });
  });

  if (!changes.length) {
    return false;
  }

  view.dispatch({ changes });
  return true;
}

export function outdentListByTwoSpaces(view) {
  const { state } = view;
  const stylesByLine = detectListIndentStylesByLine(state);
  const changes = [];

  forEachSelectionLine(state, (line) => {
    const lineText = state.doc.sliceString(line.from, line.to);
    const listMatch = listItemRegex.exec(lineText);
    if (!listMatch || !listMatch[1].length) {
      return;
    }

    const leadingWhitespace = listMatch[1];
    const style = lineIndentStyle(line.number, stylesByLine);
    const deleteLength = leadingWhitespace.startsWith('\t')
      ? 1
      : Math.min(style.columns, leadingWhitespace.match(/^ +/)?.[0]?.length ?? 0);
    if (!deleteLength) {
      return;
    }

    changes.push({ from: line.from, to: line.from + deleteLength, insert: '' });
  });

  if (!changes.length) {
    return false;
  }

  view.dispatch({ changes });
  return true;
}

export function listMarkerData(lineText, orderedDisplayIndex = null, style = defaultListIndentStyle) {
  const match = listMarkerRegex.exec(lineText);
  if (!match) {
    return null;
  }

  const indent = match[1].length;
  const leadingWhitespace = match[1];
  const orderedNumber = match[3];
  const orderedSuffix = match[4];
  const taskState = match[5];

  let markerText = '•';
  let classes = 'meo-md-list-marker-bullet';

  if (orderedNumber && orderedSuffix) {
    markerText = `${orderedDisplayIndex ?? orderedNumber}${orderedSuffix}`;
    classes = 'meo-md-list-marker-ordered';
  }

  const markerCharLength = match[2]?.length ?? (orderedNumber?.length ?? 0) + (orderedSuffix?.length ?? 0);
  const markerEndOffset = indent + markerCharLength;
  const indentColumns = indentationColumns(leadingWhitespace, style);
  const contentOffsetColumns = indentColumns + (match[0].length - indent);

  const result = {
    fromOffset: indent,
    leadingWhitespace,
    indentLevel: Math.floor(indentColumns / style.columns),
    indentColumns,
    markerEndOffset,
    toOffset: match[0].length,
    contentOffsetColumns,
    markerText,
    classes,
    orderedNumber
  };

  if (taskState !== undefined) {
    result.taskBracketStart = markerEndOffset + 1;
    result.taskState = taskState.toLowerCase() === 'x';
  }

  return result;
}

class ListMarkerWidget extends WidgetType {
  constructor(text, classes) {
    super();
    this.text = text;
    this.classes = classes;
  }

  eq(other) {
    return other.text === this.text && other.classes === this.classes;
  }

  toDOM() {
    const marker = document.createElement('span');
    marker.className = `meo-md-list-marker ${this.classes}`;
    marker.style.color = base02;
    marker.textContent = this.text;
    return marker;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(checked, bracketStart) {
    super();
    this.checked = checked;
    this.bracketStart = bracketStart;
  }

  eq(other) {
    return other.checked === this.checked && other.bracketStart === this.bracketStart;
  }

  toDOM(view) {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'meo-task-checkbox';
    checkbox.checked = this.checked;
    checkbox.setAttribute('aria-label', this.checked ? 'Mark task as incomplete' : 'Mark task as complete');

    checkbox.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });

    checkbox.addEventListener('change', () => {
      const newChar = checkbox.checked ? 'x' : ' ';
      view.dispatch({
        changes: { from: this.bracketStart + 1, to: this.bracketStart + 2, insert: newChar }
      });
    });

    return checkbox;
  }

  ignoreEvent() {
    return false;
  }
}

export function addListMarkerDecoration(
  builder,
  state,
  from,
  orderedDisplayIndex = null,
  style = defaultListIndentStyle
) {
  const line = state.doc.lineAt(from);
  const lineText = state.doc.sliceString(line.from, line.to);
  const marker = listMarkerData(lineText, orderedDisplayIndex, style);
  if (!marker) {
    return;
  }

  const indentEnd = line.from + marker.fromOffset;
  const markerEnd = line.from + marker.markerEndOffset;

  if (marker.taskBracketStart !== undefined) {
    const bracketStart = line.from + marker.taskBracketStart;
    const fullEnd = line.from + marker.toOffset - 1;
    builder.push(
      Decoration.replace({
        widget: new CheckboxWidget(marker.taskState, bracketStart),
        inclusive: false
      }).range(indentEnd, fullEnd)
    );

    if (marker.taskState) {
      const textStart = line.from + marker.toOffset;
      if (textStart < line.to) {
        builder.push(taskCompleteDeco.range(textStart, line.to));
      }
    }
  } else if (markerEnd > indentEnd) {
    builder.push(
      Decoration.replace({
        widget: new ListMarkerWidget(marker.markerText, marker.classes),
        inclusive: false
      }).range(indentEnd, markerEnd)
    );
  }

}

export function continuedListMarker(lineText) {
  const match = listMarkerRegex.exec(lineText);
  if (!match) {
    return null;
  }

  const leadingWhitespace = match[1];
  const bullet = match[2];
  const orderedNumber = match[3];
  const orderedSuffix = match[4];
  const hasTask = match[5] !== undefined;
  const marker = listMarkerData(lineText);
  if (!marker) {
    return null;
  }

  const hasContent = lineText.slice(marker.toOffset).trim().length > 0;
  if (!hasContent) {
    return null;
  }

  if (bullet && hasTask) {
    return `${leadingWhitespace}${bullet} [ ] `;
  }

  if (bullet) {
    return `${leadingWhitespace}${bullet} `;
  }

  if (!orderedNumber || !orderedSuffix) {
    return null;
  }

  const nextNumber = Number.parseInt(orderedNumber, 10) + 1;
  return `${leadingWhitespace}${nextNumber}${orderedSuffix} `;
}

export function handleEnterContinueList(view) {
  const { state } = view;
  const selection = state.selection.main;
  if (!selection.empty) {
    return false;
  }

  const position = selection.head;
  const line = state.doc.lineAt(position);
  if (position !== line.to) {
    return false;
  }

  const lineText = state.doc.sliceString(line.from, line.to);
  const marker = continuedListMarker(lineText);
  if (!marker) {
    return false;
  }

  const insert = `\n${marker}`;
  view.dispatch({
    changes: { from: position, insert },
    selection: { anchor: position + insert.length }
  });
  return true;
}

export function handleBackspaceAtListContentStart(view) {
  const { state } = view;
  const selection = state.selection.main;
  if (!selection.empty) {
    return false;
  }

  const line = state.doc.lineAt(selection.head);
  const lineText = state.doc.sliceString(line.from, line.to);
  const marker = listMarkerData(lineText);
  if (!marker || selection.head !== line.from + marker.toOffset) {
    return false;
  }

  view.dispatch({
    changes: { from: line.from, to: line.from + marker.toOffset, insert: '' },
    selection: { anchor: line.from }
  });
  return true;
}

export function handleEnterAtListContentStart(view) {
  const { state } = view;
  const selection = state.selection.main;
  if (!selection.empty) {
    return false;
  }

  const position = selection.head;
  const line = state.doc.lineAt(position);
  const lineText = state.doc.sliceString(line.from, line.to);
  const marker = listMarkerData(lineText);
  if (!marker) {
    return false;
  }

  const contentStart = line.from + marker.toOffset;
  if (position !== contentStart) {
    return false;
  }

  const content = lineText.slice(marker.toOffset).trim();
  if (!content) {
    return false;
  }

  const insert = `\n${marker.leadingWhitespace}`;
  view.dispatch({
    changes: { from: line.from, insert },
    selection: { anchor: line.from + insert.length }
  });
  return true;
}

export function handleEnterBeforeNestedList(view) {
  const { state } = view;
  const selection = state.selection.main;
  if (!selection.empty) {
    return false;
  }

  const position = selection.head;
  const line = state.doc.lineAt(position);
  if (position !== line.to || line.number >= state.doc.lines) {
    return false;
  }

  const currentText = state.doc.sliceString(line.from, line.to);
  const nextLine = state.doc.line(line.number + 1);
  const nextText = state.doc.sliceString(nextLine.from, nextLine.to);

  if (!/^[ \t]+(?:[-+*]|\d+[.)])\s+/.test(nextText)) {
    return false;
  }

  const marker = continuedListMarker(currentText);
  if (!marker) {
    return false;
  }

  const insert = `\n${marker}`;
  view.dispatch({
    changes: { from: position, insert },
    selection: { anchor: position + insert.length }
  });
  return true;
}

export function collectOrderedListRenumberChanges(state) {
  const changes = [];
  const stylesByLine = detectListIndentStylesByLine(state);
  const orderedCountsByLevel = [];

  for (let lineNo = 1; lineNo <= state.doc.lines; lineNo += 1) {
    const line = state.doc.line(lineNo);
    const lineText = state.doc.sliceString(line.from, line.to);
    const style = lineIndentStyle(lineNo, stylesByLine);
    const marker = listMarkerData(lineText, null, style);

    if (!marker) {
      orderedCountsByLevel.length = 0;
      continue;
    }

    const level = marker.indentLevel;
    orderedCountsByLevel.length = level + 1;
    if (!marker.orderedNumber) {
      orderedCountsByLevel[level] = 0;
      continue;
    }

    const expected = (orderedCountsByLevel[level] ?? 0) + 1;
    orderedCountsByLevel[level] = expected;
    const expectedText = String(expected);
    if (marker.orderedNumber !== expectedText) {
      const from = line.from + marker.leadingWhitespace.length;
      changes.push({
        from,
        to: from + marker.orderedNumber.length,
        insert: expectedText
      });
    }
  }

  return changes;
}

function computeSourceListBorders(state) {
  const stylesByLine = detectListIndentStylesByLine(state);
  const ranges = new RangeSetBuilder();
  for (let lineNo = 1; lineNo <= state.doc.lines; lineNo += 1) {
    const line = state.doc.line(lineNo);
    const lineText = state.doc.sliceString(line.from, line.to);
    const style = lineIndentStyle(lineNo, stylesByLine);
    const marker = listMarkerData(lineText, null, style);
    if (!marker || marker.fromOffset === 0) {
      continue;
    }
    addListIndentBorders(
      (from, to, deco) => ranges.add(from, to, deco),
      line.from,
      marker.leadingWhitespace,
      style
    );
  }
  return ranges.finish();
}

function computeSourceListMarkers(state) {
  const stylesByLine = detectListIndentStylesByLine(state);
  const ranges = new RangeSetBuilder();
  for (let lineNo = 1; lineNo <= state.doc.lines; lineNo += 1) {
    const line = state.doc.line(lineNo);
    const lineText = state.doc.sliceString(line.from, line.to);
    const style = lineIndentStyle(lineNo, stylesByLine);
    const marker = listMarkerData(lineText, null, style);
    if (!marker) {
      continue;
    }

    const markerFrom = line.from + marker.fromOffset;
    const markerTo = line.from + marker.toOffset;
    if (markerTo > markerFrom) {
      ranges.add(markerFrom, markerTo, sourceListMarkerDeco);
    }
  }
  return ranges.finish();
}

export const sourceListBorderField = StateField.define({
  create(state) {
    return computeSourceListBorders(state);
  },
  update(borders, transaction) {
    if (!transaction.docChanged) {
      return borders;
    }
    return computeSourceListBorders(transaction.state);
  },
  provide: (field) => EditorView.decorations.from(field)
});

export const sourceListMarkerField = StateField.define({
  create(state) {
    return computeSourceListMarkers(state);
  },
  update(markers, transaction) {
    if (!transaction.docChanged) {
      return markers;
    }
    return computeSourceListMarkers(transaction.state);
  },
  provide: (field) => EditorView.decorations.from(field)
});
