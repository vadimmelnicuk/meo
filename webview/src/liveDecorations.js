import { StateField } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { resolveCodeLanguage } from './codeBlockHighlight';
import { markdownHighlightStyle } from './editor.js';
import { monokaiHighlightStyle } from './monokai';

const markerDeco = Decoration.mark({ class: 'meo-md-marker' });
const activeLineMarkerDeco = Decoration.mark({ class: 'meo-md-marker-active' });
const fenceMarkerDeco = Decoration.mark({ class: 'meo-md-fence-marker' });

const lineStyleDecos = {
  h1: Decoration.line({ class: 'meo-md-h1' }),
  h2: Decoration.line({ class: 'meo-md-h2' }),
  h3: Decoration.line({ class: 'meo-md-h3' }),
  h4: Decoration.line({ class: 'meo-md-h4' }),
  h5: Decoration.line({ class: 'meo-md-h5' }),
  h6: Decoration.line({ class: 'meo-md-h6' }),
  quote: Decoration.line({ class: 'meo-md-quote' }),
  codeBlock: Decoration.line({ class: 'meo-md-code-block' }),
  list: Decoration.line({ class: 'meo-md-list-line' })
};

const inlineStyleDecos = {
  em: Decoration.mark({ class: 'meo-md-em' }),
  strong: Decoration.mark({ class: 'meo-md-strong' }),
  strike: Decoration.mark({ class: 'meo-md-strike' }),
  inlineCode: Decoration.mark({ class: 'meo-md-inline-code' }),
  link: Decoration.mark({ class: 'meo-md-link' })
};

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
    marker.textContent = this.text;
    return marker;
  }
}

class CopyCodeButtonWidget extends WidgetType {
  constructor(codeContent) {
    super();
    this.codeContent = codeContent;
  }

  eq(other) {
    return other.codeContent === this.codeContent;
  }

  toDOM() {
    const container = document.createElement('span');
    container.className = 'meo-copy-code-btn';
    container.setAttribute('aria-label', 'Copy code');
    container.setAttribute('role', 'button');
    container.setAttribute('tabindex', '0');
    container.textContent = 'copy';

    const updateText = (copied) => {
      container.textContent = copied ? 'copied' : 'copy';
      container.classList.toggle('copied', copied);
    };

    container.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(this.codeContent);
        updateText(true);
        setTimeout(() => updateText(false), 2000);
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    });

    container.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(this.codeContent);
          updateText(true);
          setTimeout(() => updateText(false), 2000);
        } catch (err) {
          console.error('Failed to copy:', err);
        }
      }
    });

    return container;
  }

  ignoreEvent(event) {
    return event !== 'pointerover' && event !== 'pointerout';
  }
}



function addRange(builder, from, to, deco) {
  if (to <= from) {
    return;
  }
  builder.push(deco.range(from, to));
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

function headingLevelFromName(name) {
  if (!name.startsWith('ATXHeading')) {
    return null;
  }
  const level = Number.parseInt(name.slice('ATXHeading'.length), 10);
  return Number.isInteger(level) && level >= 1 && level <= 6 ? level : null;
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

function isFenceMarker(state, from, to) {
  const text = state.doc.sliceString(from, to);
  return /^`{3,}$/.test(text) || /^~{3,}$/.test(text);
}

function addFenceOpeningLineMarker(builder, state, from, activeLines) {
  const line = state.doc.lineAt(from);
  const text = state.doc.sliceString(line.from, line.to);
  if (!/^[ \t]{0,3}(?:`{3,}|~{3,})/.test(text)) {
    return;
  }

  // Show fence markers on all lines (not just active)
  if (activeLines.has(line.number)) {
    addRange(builder, line.from, line.to, activeLineMarkerDeco);
    return;
  }
  addRange(builder, line.from, line.to, fenceMarkerDeco);
}

function addCopyCodeButton(builder, state, from, to) {
  const startLine = state.doc.lineAt(from);
  const endLine = state.doc.lineAt(Math.max(to - 1, from));

  let codeContent = '';
  for (let lineNum = startLine.number + 1; lineNum <= endLine.number; lineNum++) {
    const line = state.doc.line(lineNum);
    const lineText = state.doc.sliceString(line.from, line.to);

    if (lineNum === endLine.number) {
      const fenceMatch = /^[ \t]*[`~]{3,}.*$/.exec(lineText);
      if (fenceMatch) {
        continue;
      }
    }

    if (codeContent) {
      codeContent += '\n';
    }
    codeContent += lineText;
  }

  if (!codeContent) {
    return;
  }

  const widget = new CopyCodeButtonWidget(codeContent);
  builder.push(
    Decoration.widget({
      widget,
      side: 1,
      class: 'meo-copy-code-btn'
    }).range(startLine.to)
  );
}

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

  if (taskState !== undefined) {
    markerText = taskState.toLowerCase() === 'x' ? '[x]' : '[ ]';
    classes = 'meo-md-list-marker-task';
  }

  const markerCharLength = match[2]?.length ?? (orderedNumber?.length ?? 0) + (orderedSuffix?.length ?? 0);
  const markerEndOffset = indent + markerCharLength;

  return {
    fromOffset: indent,
    markerEndOffset,
    toOffset: match[0].length,
    markerText,
    classes
  };
}

function addListMarkerDecoration(builder, state, from, activeLines, orderedDisplayIndex = null) {
  const line = state.doc.lineAt(from);
  const lineText = state.doc.sliceString(line.from, line.to);
  const marker = listMarkerData(lineText, orderedDisplayIndex);
  if (!marker) {
    return;
  }

  const indentEnd = line.from + marker.fromOffset;
  const markerEnd = line.from + marker.markerEndOffset;

  if (!activeLines.has(line.number)) {
    if (markerEnd > indentEnd) {
      builder.push(
        Decoration.replace({
          widget: new ListMarkerWidget(marker.markerText, marker.classes),
          inclusive: false
        }).range(indentEnd, markerEnd)
      );
    }
  }

  if (marker.fromOffset > 0) {
    for (let pos = line.from; pos < indentEnd; pos++) {
      builder.push(
        Decoration.mark({ class: 'meo-md-list-border' }).range(pos, pos + 1)
      );
    }
  }
}

function buildDecorations(state) {
  const ranges = [];
  const activeLines = collectActiveLines(state);
  const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);
  const orderedListItemCounts = new Map();

  tree.iterate({
    enter: (node) => {
      if (node.name === 'OrderedList') {
        orderedListItemCounts.set(node.from, 0);
      }

      const headingLevel = headingLevelFromName(node.name);
      if (headingLevel !== null) {
        addAtxHeadingPrefixMarkers(ranges, state, node.from, activeLines);
        addLineClass(ranges, state, node.from, node.to, lineStyleDecos[`h${headingLevel}`]);
      }

      if (node.name === 'SetextHeading1') {
        addLineClass(ranges, state, node.from, node.to, lineStyleDecos.h1);
      } else if (node.name === 'SetextHeading2') {
        if (!shouldSuppressTransientSetextHeading(state, node, activeLines)) {
          addLineClass(ranges, state, node.from, node.to, lineStyleDecos.h2);
        }
      } else if (node.name === 'Blockquote') {
        addLineClass(ranges, state, node.from, node.to, lineStyleDecos.quote);
      } else if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
        addLineClass(ranges, state, node.from, node.to, lineStyleDecos.codeBlock);
        if (node.name === 'FencedCode') {
          addFenceOpeningLineMarker(ranges, state, node.from, activeLines);
        }
        addCopyCodeButton(ranges, state, node.from, node.to);
      } else if (
        node.name === 'ListItem' ||
        node.name === 'BulletList' ||
        node.name === 'OrderedList'
      ) {
        addLineClass(ranges, state, node.from, node.to, lineStyleDecos.list);
        if (node.name === 'ListItem') {
          let orderedDisplayIndex = null;
          let parent = node.node.parent;
          while (parent && parent.name !== 'OrderedList' && parent.name !== 'BulletList') {
            parent = parent.parent;
          }

          if (parent?.name === 'OrderedList') {
            const nextCount = (orderedListItemCounts.get(parent.from) ?? 0) + 1;
            orderedListItemCounts.set(parent.from, nextCount);
            orderedDisplayIndex = nextCount;
          }

          addListMarkerDecoration(ranges, state, node.from, activeLines, orderedDisplayIndex);
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
      if (isFenceMarker(state, node.from, node.to)) {
        // Show fence markers on all lines (not just active)
        if (activeLines.has(line.number)) {
          addRange(ranges, node.from, node.to, activeLineMarkerDeco);
        } else {
          addRange(ranges, node.from, node.to, fenceMarkerDeco);
        }
      } else if (activeLines.has(line.number)) {
        addRange(ranges, node.from, node.to, activeLineMarkerDeco);
      } else {
        addRange(ranges, node.from, node.to, markerDeco);
      }
    }
  });

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

export function liveModeExtensions() {
  return [
    markdown({ base: markdownLanguage, addKeymap: false, codeLanguages: resolveCodeLanguage }),
    syntaxHighlighting(markdownHighlightStyle),
    syntaxHighlighting(monokaiHighlightStyle),
    liveDecorationField
  ];
}

function isEmptyDecorationSet(set) {
  const cursor = set.iter();
  return cursor.value === null;
}
