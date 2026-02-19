import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';

export function resolvedSyntaxTree(state, timeout = 50) {
  return ensureSyntaxTree(state, state.doc.length, timeout) ?? syntaxTree(state);
}

export function headingLevelFromName(name) {
  if (!name.startsWith('ATXHeading')) {
    return null;
  }

  const level = Number.parseInt(name.slice('ATXHeading'.length), 10);
  return Number.isInteger(level) && level >= 1 && level <= 6 ? level : null;
}

export function extractHeadings(state) {
  const headings = [];
  const tree = resolvedSyntaxTree(state);

  tree.iterate({
    enter(node) {
      const headingLevel = headingLevelFromName(node.name);
      if (headingLevel !== null) {
        const line = state.doc.lineAt(node.from);
        let text = state.doc.sliceString(node.from, node.to);
        text = text.replace(/^#{1,6}\s+/, '').replace(/\s+#+$/, '').trim();
        headings.push({
          level: headingLevel,
          text,
          line: line.number,
          from: node.from
        });
      }
    }
  });

  return headings;
}
