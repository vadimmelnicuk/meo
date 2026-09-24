import type { EditorState } from '@codemirror/state';
import { findGptCitationGroups, numberGptCitationGroups, parseGptCitationDefinitions, type GptCitationGroup, type GptCitationIndex, type GptCitationSource } from '../../../src/shared/gptCitations';
import { isInsideFrontmatter, parseFrontmatter } from './frontmatter';
import { resolvedSyntaxTree } from './markdownSyntax';

const blockedAncestors = new Set([
  'InlineCode', 'CodeText', 'FencedCode', 'CodeBlock', 'CodeInfo',
  'HTMLBlock', 'HTMLTag', 'Comment', 'CommentBlock', 'URL',
  'Image', 'Autolink', 'LinkReference'
]);

export function collectLiveGptCitationIndex(
  state: EditorState,
  excludedRanges: ReadonlyArray<{ from: number; to: number }> = []
): GptCitationIndex {
  const markdown = state.doc.toString();
  const frontmatter = parseFrontmatter(state);
  const tree = resolvedSyntaxTree(state);
  const groups = findGptCitationGroups(markdown).filter((group) => (
    !isInsideFrontmatter(frontmatter, group.from) &&
    !excludedRanges.some((range) => group.from < range.to && group.to > range.from) &&
    isRenderedTextRange(tree, group)
  ));
  return numberGptCitationGroups(groups, parseGptCitationDefinitions(markdown));
}

function isRenderedTextRange(tree: any, group: GptCitationGroup): boolean {
  for (const pos of [group.from, group.to - 1]) {
    for (let node = tree.resolveInner(pos, 1); node; node = node.parent) {
      if (blockedAncestors.has(node.name)) return false;
    }
  }
  return true;
}

export function createGptCitationElement(sources: ReadonlyArray<GptCitationSource>): HTMLElement {
  const wrapper = document.createElement('sup');
  wrapper.className = 'meo-md-gpt-citation';
  wrapper.append('[');
  sources.forEach((source, index) => {
    if (index > 0) wrapper.append(', ');
    const label = document.createElement('span');
    label.textContent = String(source.number);
    label.title = source.title ? `${source.id} — ${source.title}` : source.id;
    if (source.href) {
      label.className = 'meo-md-gpt-citation-link';
      label.setAttribute('data-meo-link-href', source.href);
    }
    wrapper.appendChild(label);
  });
  wrapper.append(']');
  return wrapper;
}
