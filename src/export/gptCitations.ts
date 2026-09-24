import type MarkdownIt from 'markdown-it';
import { collectLatexMathRanges } from './math';
import {
  ensureGptCitationSource,
  findGptCitationGroups,
  numberGptCitationGroups,
  type GptCitationDefinition,
  type GptCitationIndex,
  type GptCitationSource
} from '../shared/gptCitations';

export interface ExportGptCitations {
  index: GptCitationIndex;
  prime(markdown: string): void;
  renderKey(): string;
}

export function installExportGptCitations(
  md: MarkdownIt,
  definitions: ReadonlyMap<string, GptCitationDefinition>,
  hrefPrefix: string
): ExportGptCitations {
  const index = numberGptCitationGroups([], definitions);

  md.core.ruler.push('meo-gpt-citations', (state: any) => {
    for (const token of state.tokens as any[]) {
      if (token.type !== 'inline' || !Array.isArray(token.children)) continue;
      const children: any[] = [];
      let linkDepth = 0;
      for (const child of token.children) {
        if (child.type === 'link_open') linkDepth += 1;
        if (child.type === 'link_close') linkDepth = Math.max(0, linkDepth - 1);
        if (child.type !== 'text' || !String(child.content ?? '').includes('cite')) {
          children.push(child);
          continue;
        }
        const text = String(child.content);
        const mathRanges = text.includes('$') || text.includes('\\[')
          ? collectLatexMathRanges(text)
          : [];
        const groups = findGptCitationGroups(text).filter((group) => !mathRanges.some(
          (range) => group.from < range.to && group.to > range.from
        ));
        if (!groups.length) {
          children.push(child);
          continue;
        }
        let cursor = 0;
        for (const group of groups) {
          if (group.from > cursor) children.push(makeToken(child, 'text', text.slice(cursor, group.from)));
          const sources = uniqueSources(group.ids, index, definitions);
          children.push(makeToken(child, 'html_inline', renderCitationHtml(sources, hrefPrefix, linkDepth > 0)));
          cursor = group.to;
        }
        if (cursor < text.length) children.push(makeToken(child, 'text', text.slice(cursor)));
      }
      token.children = children;
    }
  });

  return {
    index,
    prime(markdown) {
      // Footnote bodies render before the main body; parse it first to keep
      // their citation numbers after the body citations.
      md.parse(markdown, {});
    },
    renderKey() {
      if (!index.sources.length) return '';
      const items = index.sources.map((source) => {
        const id = escapeHtml(source.id);
        const label = source.href
          ? `<a href="${escapeHtml(source.href)}"><code>${id}</code></a>`
          : `<code>${id}</code>`;
        const title = source.title ? ` — ${escapeHtml(source.title)}` : '';
        return `<li id="meo-gpt-citation-${source.number}">${label}${title}</li>`;
      }).join('');
      return `<section class="meo-gpt-citation-key"><h2>Citation IDs</h2><ol>${items}</ol></section>`;
    }
  };
}

function uniqueSources(
  ids: ReadonlyArray<string>,
  index: GptCitationIndex,
  definitions: ReadonlyMap<string, GptCitationDefinition>
): GptCitationSource[] {
  const seen = new Set<string>();
  const sources: GptCitationSource[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    sources.push(ensureGptCitationSource(index, id, definitions));
  }
  return sources;
}

function renderCitationHtml(
  sources: ReadonlyArray<GptCitationSource>,
  hrefPrefix: string,
  insideLink: boolean
): string {
  const labels = sources.map((source) => {
    if (insideLink) return `<span>${source.number}</span>`;
    const href = `${hrefPrefix}#meo-gpt-citation-${source.number}`;
    return `<a href="${escapeHtml(href)}" title="${escapeHtml(source.id)}">${source.number}</a>`;
  }).join(', ');
  return `<sup class="meo-gpt-citation">[${labels}]</sup>`;
}

function makeToken(original: any, type: string, content: string): any {
  const token = new original.constructor(type, '', 0);
  token.content = content;
  return token;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
