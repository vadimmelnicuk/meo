import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';

export function resolvedSyntaxTree(state: EditorState, timeout: number = 50): any {
  return ensureSyntaxTree(state, state.doc.length, timeout) ?? syntaxTree(state);
}

export function headingLevelFromName(name: string): number | null {
  if (!name.startsWith('ATXHeading')) {
    return null;
  }

  const level = Number.parseInt(name.slice('ATXHeading'.length), 10);
  return Number.isInteger(level) && level >= 1 && level <= 6 ? level : null;
}

export interface HeadingInfo {
  level: number;
  text: string;
  line: number;
  from: number;
}

export interface HeadingSection extends HeadingInfo {
  sectionFrom: number;
  sectionTo: number;
  headingFrom: number;
  headingTo: number;
  lineFrom: number;
  lineTo: number;
  collapseFrom: number;
  collapseTo: number;
}

export function extractHeadings(state: EditorState): HeadingInfo[] {
  const headings: HeadingInfo[] = [];
  const tree = resolvedSyntaxTree(state);

  tree.iterate({
    enter(node: any) {
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

export function extractHeadingSections(state: EditorState): HeadingSection[] {
  const headings: HeadingSection[] = [];
  const tree = resolvedSyntaxTree(state);

  tree.iterate({
    enter(node: any) {
      const headingLevel = headingLevelFromName(node.name);
      if (headingLevel === null) {
        return;
      }

      const line = state.doc.lineAt(node.from);
      let text = state.doc.sliceString(node.from, node.to);
      text = text.replace(/^#{1,6}\s+/, '').replace(/\s+#+$/, '').trim();
      headings.push({
        level: headingLevel,
        text,
        from: node.from,
        line: line.number,
        sectionFrom: node.from,
        sectionTo: state.doc.length,
        headingFrom: node.from,
        headingTo: node.to,
        lineFrom: line.from,
        lineTo: line.to,
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
        heading.sectionTo = nextHeading.headingFrom;
        const previousLineNo = Math.max(heading.line, nextHeading.line - 1);
        heading.collapseTo = state.doc.line(previousLineNo).to;
        break;
      }
    }
  }

  return headings;
}
