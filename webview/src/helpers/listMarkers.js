import { StateField, RangeSetBuilder } from '@codemirror/state';
import { Decoration, WidgetType, EditorView } from '@codemirror/view';
import { base02 } from '../theme';
import { resolvedSyntaxTree } from './markdownSyntax';

const listBorderDeco = Decoration.mark({ class: 'meo-md-list-border' });
const taskCompleteDeco = Decoration.mark({ class: 'meo-task-complete' });

export function listMarkerData(lineText, orderedDisplayIndex = null) {
  const match = /^(\s*)(?:([-+*])|(\d+)([.)]))\s+(?:\[([ xX])\]\s+)?/.exec(lineText);
  if (!match) {
    return null;
  }

  const indent = match[1].length;
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

  const result = {
    fromOffset: indent,
    markerEndOffset,
    toOffset: match[0].length,
    markerText,
    classes
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

export function addListMarkerDecoration(builder, state, from, orderedDisplayIndex = null) {
  const line = state.doc.lineAt(from);
  const lineText = state.doc.sliceString(line.from, line.to);
  const marker = listMarkerData(lineText, orderedDisplayIndex);
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

  for (let pos = line.from; pos < indentEnd; pos += 1) {
    builder.push(listBorderDeco.range(pos, pos + 1));
  }
}

export function continuedListMarker(lineText) {
  const taskMatch = /^([-+*])\s+\[[ xX]\]\s+\S/.exec(lineText);
  if (taskMatch) {
    return `${taskMatch[1]} [ ] `;
  }

  const bulletMatch = /^([-+*])\s+\S/.exec(lineText);
  if (bulletMatch) {
    return `${bulletMatch[1]} `;
  }

  const orderedMatch = /^(\d+)([.)])\s+\S/.exec(lineText);
  if (!orderedMatch) {
    return null;
  }

  const nextNumber = Number.parseInt(orderedMatch[1], 10) + 1;
  return `${nextNumber}${orderedMatch[2]} `;
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

export function collectOrderedListRenumberChanges(state, tree) {
  const changes = [];

  tree.iterate({
    enter(node) {
      if (node.name !== 'OrderedList') {
        return;
      }

      let index = 1;
      for (let child = node.node.firstChild; child; child = child.nextSibling) {
        if (child.name !== 'ListItem') {
          continue;
        }

        const line = state.doc.lineAt(child.from);
        const lineText = state.doc.sliceString(line.from, line.to);
        const match = /^(\s*)(\d+)([.)])\s+/.exec(lineText);
        if (!match) {
          continue;
        }

        const expected = String(index);
        if (match[2] !== expected) {
          const from = line.from + match[1].length;
          changes.push({
            from,
            to: from + match[2].length,
            insert: expected
          });
        }

        index += 1;
      }
    }
  });

  return changes;
}

export function orderedListDisplayIndex(node, orderedListItemCounts) {
  let parent = node.node.parent;
  while (parent && parent.name !== 'OrderedList' && parent.name !== 'BulletList') {
    parent = parent.parent;
  }

  if (parent?.name !== 'OrderedList') {
    return null;
  }

  const nextCount = (orderedListItemCounts.get(parent.from) ?? 0) + 1;
  orderedListItemCounts.set(parent.from, nextCount);
  return nextCount;
}

function computeSourceListBorders(state) {
  const ranges = new RangeSetBuilder();
  const tree = resolvedSyntaxTree(state);
  tree.iterate({
    enter(node) {
      if (node.name !== 'ListItem') {
        return;
      }
      const line = state.doc.lineAt(node.from);
      const lineText = state.doc.sliceString(line.from, line.to);
      const marker = listMarkerData(lineText);
      if (!marker || marker.fromOffset === 0) {
        return;
      }
      const indentEnd = line.from + marker.fromOffset;
      for (let pos = line.from; pos < indentEnd; pos += 1) {
        ranges.add(pos, pos + 1, listBorderDeco);
      }
    }
  });
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
