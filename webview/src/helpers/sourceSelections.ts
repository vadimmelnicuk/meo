import { EditorSelection, EditorState, Prec, type Extension } from '@codemirror/state';
import { simplifySelection } from '@codemirror/commands';
import { selectNextOccurrence } from '@codemirror/search';
import { drawSelection, keymap, type Command } from '@codemirror/view';

const insertCursorAtLineEnds: Command = (view) => {
  const { state } = view;
  const positions = new Set<number>();

  for (const range of state.selection.ranges) {
    const firstLine = state.doc.lineAt(range.from);
    const lastLine = state.doc.lineAt(range.to);
    // A selection ending at the next line's start does not include that line.
    const lastNumber = !range.empty && range.to === lastLine.from
      ? lastLine.number - 1
      : lastLine.number;
    for (let number = firstLine.number; number <= lastNumber; number += 1) {
      positions.add(state.doc.line(number).to);
    }
  }

  const ranges = [...positions].sort((a, b) => a - b).map((position) => EditorSelection.cursor(position));
  view.dispatch({
    selection: EditorSelection.create(ranges),
    scrollIntoView: true,
    userEvent: 'select'
  });
  return true;
};

export function sourceSelectionExtensions(): Extension[] {
  return [
    EditorState.allowMultipleSelections.of(true),
    drawSelection(),
    Prec.high(keymap.of([
      { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true, stopPropagation: true },
      { key: 'Shift-Alt-i', run: insertCursorAtLineEnds, preventDefault: true, stopPropagation: true },
      { key: 'Escape', run: simplifySelection, stopPropagation: true }
    ]))
  ];
}
