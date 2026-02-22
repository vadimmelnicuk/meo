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

export function extractHeadingSections(state) {
  const headings = [];
  const tree = resolvedSyntaxTree(state);

  tree.iterate({
    enter(node) {
      const headingLevel = headingLevelFromName(node.name);
      if (headingLevel === null) {
        return;
      }

      const line = state.doc.lineAt(node.from);
      headings.push({
        level: headingLevel,
        line: line.number,
        headingFrom: node.from,
        headingTo: node.to,
        lineFrom: line.from,
        lineTo: line.to,
        // Start folding at the heading line end so the trailing newline is hidden too.
        collapseFrom: line.to,
        collapseTo: state.doc.length
      });
    }
  });

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    for (let nextIndex = index + 1; nextIndex < headings.length; nextIndex += 1) {
      const nextHeading = headings[nextIndex];
      if (nextHeading.level <= heading.level) {
        // Stop before the next heading line start so its gutter/line decorations remain visible.
        const previousLineNo = Math.max(heading.line, nextHeading.line - 1);
        heading.collapseTo = state.doc.line(previousLineNo).to;
        break;
      }
    }
  }

  return headings;
}
