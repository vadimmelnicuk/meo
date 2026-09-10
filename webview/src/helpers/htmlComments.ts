import { RangeSet, type EditorState, type Range, type StateField } from '@codemirror/state';
import type { SyntaxNodeRef } from '@lezer/common';
import { Decoration, EditorView, GutterMarker, gutter, type DecorationSet } from '@codemirror/view';
import { createElement, MessageSquare } from 'lucide';

const hiddenComment = Decoration.replace({ inclusive: false, htmlComment: true });
const editableComment = Decoration.mark({ class: 'meo-md-html-comment' });

export function htmlCommentDecorations(
  state: EditorState,
  node: SyntaxNodeRef,
  activeLines: ReadonlySet<number>
): Range<Decoration>[] {
  const ranges: Range<Decoration>[] = [];
  const text = state.doc.sliceString(node.from, node.to);
  // CommentBlock includes any text after the closing marker on its last line.
  for (const match of text.matchAll(/<!--[\s\S]*?(?:-->|$)/g)) {
    const from = node.from + match.index;
    const to = from + match[0].length;
    const firstLine = state.doc.lineAt(from).number;
    const lastLine = state.doc.lineAt(to).number;
    const active = [...activeLines].some((line) => line >= firstLine && line <= lastLine);
    // Keep a mark while editing so the live field's empty-result fallback cannot
    // restore the hidden decoration on a selection-only transaction.
    ranges.push((active ? editableComment : hiddenComment).range(from, to));
  }
  return ranges;
}

class CommentGutterMarker extends GutterMarker {
  constructor(readonly from: number) {
    super();
  }

  eq(other: GutterMarker): boolean {
    return other instanceof CommentGutterMarker && other.from === this.from;
  }

  toDOM(view: EditorView): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'meo-md-comment-toggle';
    button.title = 'Edit hidden HTML comment';
    button.setAttribute('aria-label', button.title);
    button.appendChild(createElement(MessageSquare, {
      width: 12,
      height: 12,
      'aria-hidden': 'true'
    }));
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (view.state.readOnly) return;
      view.dispatch({ selection: { anchor: this.from + 4 }, scrollIntoView: true });
      view.focus();
    });
    return button;
  }
}

export function htmlCommentGutter(field: StateField<DecorationSet>) {
  return gutter({
    class: 'meo-md-comment-gutter',
    markers(view) {
      if (view.state.readOnly) return RangeSet.empty;
      const markers: Range<GutterMarker>[] = [];
      let previousLine = -1;
      for (const cursor = view.state.field(field).iter(); cursor.value; cursor.next()) {
        if (!cursor.value.spec.htmlComment) continue;
        const lineFrom = view.state.doc.lineAt(cursor.from).from;
        if (lineFrom === previousLine) continue;
        markers.push(new CommentGutterMarker(cursor.from).range(lineFrom));
        previousLine = lineFrom;
      }
      return RangeSet.of(markers);
    }
  });
}
