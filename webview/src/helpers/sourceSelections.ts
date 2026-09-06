import { Compartment, EditorSelection, EditorState, Prec, type Extension } from '@codemirror/state';
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
  const selectionDrawing = new Compartment();
  const nativeSelection: Extension = [];
  const multipleSelections = drawSelection();

  return [
    EditorState.allowMultipleSelections.of(true),
    // Match Live's native highlight, including text with its own background.
    // CodeMirror's selection layer is only needed for additional ranges/cursors.
    selectionDrawing.of(nativeSelection),
    EditorState.transactionExtender.of((transaction) => {
      const drawing = transaction.state.selection.ranges.length > 1 ? multipleSelections : nativeSelection;
      if (selectionDrawing.get(transaction.state) === drawing) return null;
      return { effects: selectionDrawing.reconfigure(drawing) };
    }),
    Prec.high(keymap.of([
      { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true, stopPropagation: true },
      { key: 'Shift-Alt-i', run: insertCursorAtLineEnds, preventDefault: true, stopPropagation: true },
      { key: 'Escape', run: simplifySelection, stopPropagation: true }
    ]))
  ];
}
