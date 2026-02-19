import { StateField, RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';

const thematicBreakRe = /^[ \t]{0,3}(?:([-*_])(?:[ \t]*\1){2,})[ \t]*$/;
const frontmatterCache = new WeakMap();

function isFrontmatterDelimiterLine(lineText) {
  return lineText.trim() === '---';
}

export function isThematicBreakLine(lineText) {
  const first = lineText.trimStart()[0];
  if (first !== '-' && first !== '*' && first !== '_') {
    return false;
  }
  return thematicBreakRe.test(lineText);
}

export function parseFrontmatter(state) {
  const { doc } = state;
  const cached = frontmatterCache.get(doc);
  if (cached !== undefined) {
    return cached;
  }

  let parsed = null;
  if (doc.lines >= 2) {
    const openingLine = doc.line(1);
    if (isFrontmatterDelimiterLine(openingLine.text)) {
      const openingOffset = openingLine.text.indexOf('---');
      for (let lineNo = 2; lineNo <= doc.lines; lineNo += 1) {
        const closingLine = doc.line(lineNo);
        if (!isFrontmatterDelimiterLine(closingLine.text)) {
          continue;
        }
        const closingOffset = closingLine.text.indexOf('---');
        parsed = {
          openingFrom: openingLine.from + openingOffset,
          openingTo: openingLine.from + openingOffset + 3,
          contentFrom: doc.line(2).from,
          contentTo: closingLine.from,
          closingFrom: closingLine.from + closingOffset,
          closingTo: closingLine.from + closingOffset + 3,
          from: openingLine.from,
          to: closingLine.from + closingOffset + 3
        };
        break;
      }
    }
  }

  frontmatterCache.set(doc, parsed);
  return parsed;
}

export const sourceFrontmatterField = StateField.define({
  create(state) {
    try {
      return buildSourceFrontmatterDecorations(state);
    } catch {
      return Decoration.none;
    }
  },
  update(value, tr) {
    if (!tr.docChanged) {
      return value;
    }
    try {
      return buildSourceFrontmatterDecorations(tr.state);
    } catch {
      return value;
    }
  },
  provide: (field) => EditorView.decorations.from(field)
});

const sourceFrontmatterContentLineDeco = Decoration.line({ class: 'meo-md-frontmatter-line meo-md-frontmatter-content' });
const sourceFrontmatterDelimiterLineDeco = Decoration.line({ class: 'meo-md-frontmatter-delimiter-line' });

function buildSourceFrontmatterDecorations(state) {
  const builder = new RangeSetBuilder();
  const frontmatter = parseFrontmatter(state);
  if (!frontmatter) {
    return builder.finish();
  }

  const openingLine = state.doc.lineAt(frontmatter.openingFrom);
  builder.add(openingLine.from, openingLine.from, sourceFrontmatterDelimiterLineDeco);

  const contentStartLineNo = state.doc.lineAt(frontmatter.contentFrom).number;
  const contentEndLineNo = frontmatter.contentTo > frontmatter.contentFrom
    ? state.doc.lineAt(frontmatter.contentTo - 1).number
    : contentStartLineNo - 1;

  for (let lineNo = contentStartLineNo; lineNo <= contentEndLineNo; lineNo++) {
    const line = state.doc.line(lineNo);
    builder.add(line.from, line.from, sourceFrontmatterContentLineDeco);
  }

  const closingLine = state.doc.lineAt(frontmatter.closingFrom);
  builder.add(closingLine.from, closingLine.from, sourceFrontmatterDelimiterLineDeco);

  return builder.finish();
}
