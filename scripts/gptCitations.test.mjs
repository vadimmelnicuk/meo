import { expect, test } from 'bun:test';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  findGptCitationGroups,
  numberGptCitationGroups,
  parseGptCitationDefinitions
} from '../src/shared/gptCitations.ts';
import { collectLiveGptCitationIndex } from '../webview/src/helpers/gptCitations.ts';
import { renderMarkdownToHtml } from '../src/export/renderMarkdown.ts';

const cite = (...ids) => `cite${ids.join('')}`;

function liveIndex(source, excludedRanges = []) {
  const state = EditorState.create({
    doc: source,
    extensions: [markdown({ base: markdownLanguage })]
  });
  return collectLiveGptCitationIndex(state, excludedRanges);
}

function exportHtml(source, target = 'html') {
  return renderMarkdownToHtml({
    markdownText: source,
    markdownFilePath: '/tmp/citations.md',
    outputFilePath: '/tmp/citations.html',
    target
  }).html;
}

test('complete citation groups number distinct IDs by first appearance', () => {
  const source = `A ${cite('turn1search11', 'turn2search29', 'turn1search11')} B ${cite('turn1search11')}`;
  const groups = findGptCitationGroups(source);
  const index = numberGptCitationGroups(groups, new Map());
  expect(groups).toHaveLength(2);
  expect(index.sources.map((entry) => [entry.id, entry.number])).toEqual([
    ['turn1search11', 1], ['turn2search29', 2]
  ]);
  expect(index.groups.map((group) => group.sources.map((entry) => entry.number))).toEqual([[1, 2], [1]]);
  expect(findGptCitationGroups(`broken cite ${cite('turn3view0')} citeturn4search1`)).toHaveLength(1);
});

test('only exact in-document HTTP(S) definitions link citation IDs', () => {
  const source = [
    '[turn1search11]: https://example.com/a "Source A"',
    '[turn1search12]: <http://example.com/b>',
    '[turn1search13]: javascript:alert(1)',
    '```markdown',
    '[turn1search14]: https://example.com/code',
    '```',
    '[Turn1search11]: https://example.com/wrong-case'
  ].join('\n');
  const definitions = parseGptCitationDefinitions(source);
  expect(definitions.get('turn1search11')).toEqual({ href: 'https://example.com/a', title: 'Source A' });
  expect(definitions.get('turn1search12')?.href).toBe('http://example.com/b');
  expect(definitions.has('turn1search13')).toBe(false);
  expect(definitions.has('turn1search14')).toBe(false);
  expect(definitions.has('Turn1search11')).toBe(true);
  expect(definitions.has('turn1search15')).toBe(false);
});

test('Live mode excludes syntax that is not rendered prose', () => {
  const source = [
    '---',
    `note: ${cite('turn0search0')}`,
    '---',
    `Text ${cite('turn1search1')}`,
    `\`${cite('turn2search2')}\``,
    '```text',
    cite('turn3search3'),
    '```',
    `<span title="${cite('turn4search4')}">raw</span>`,
    `[link](https://example.com/${cite('turn5search5')})`,
    `| table ${cite('turn6search6')} |`,
    '| --- |',
    `[turn1search1]: https://example.com/source`
  ].join('\n');
  const index = liveIndex(source);
  expect(index.sources.map((entry) => entry.id)).toEqual(['turn1search1', 'turn6search6']);
  expect(index.sources[0].href).toBe('https://example.com/source');

  const mathMarker = cite('turn7search7');
  const mathSource = `Before ${cite('turn1search1')} $${mathMarker}$`;
  const from = mathSource.indexOf(mathMarker);
  expect(liveIndex(mathSource, [{ from, to: from + mathMarker.length }]).sources).toHaveLength(1);
});

test('HTML and PDF exports render citations, source key, and explicit links', () => {
  const source = [
    `A ${cite('turn1search11', 'turn2search29')}. B ${cite('turn1search11')}.`,
    '',
    `| ${cite('turn2search29')} |`,
    '| --- |',
    '',
    '## Sources',
    '[turn1search11]: https://example.com/a "Source A"',
    '[other]: https://example.com/other "Other"'
  ].join('\n');
  const html = exportHtml(source);
  expect((html.match(/<sup class="meo-gpt-citation">/g) ?? [])).toHaveLength(3);
  expect((html.match(/id="meo-gpt-citation-\d+"/g) ?? [])).toHaveLength(2);
  expect(html).toContain('href="citations.html#meo-gpt-citation-1"');
  expect(html).toContain('href="https://example.com/a"');
  expect(html).toContain('Source A');
  expect((html.match(/Source A/g) ?? [])).toHaveLength(1);
  expect(html).toContain('Other');
  expect(html).not.toContain('turn1search11]:');
  expect(html).not.toContain('cite');

  const pdfHtml = exportHtml(source, 'pdf');
  expect(pdfHtml).toContain('href="#meo-gpt-citation-1"');
});

test('exports keep malformed markers and skip code, math, and raw HTML citations', () => {
  const valid = cite('turn1search1');
  const code = cite('turn2search2');
  const raw = cite('turn3search3');
  const math = cite('turn4search4');
  const html = exportHtml([
    `Text ${valid} and malformed cite`,
    '',
    `\`${code}\``,
    '',
    '```text', code, '```',
    '',
    `<span title="${raw}">raw</span>`,
    '',
    `$${math}$`
  ].join('\n'));
  expect((html.match(/<sup class="meo-gpt-citation">/g) ?? [])).toHaveLength(1);
  expect(html).toContain('malformed cite');
  expect(html).toContain(code);
  expect(html).not.toContain('id="meo-gpt-citation-2"');
  expect(html).not.toContain('turn3search3</code>');
});

test('a citation shown only as code does not hide an ordinary reference definition', () => {
  const source = [
    `\`${cite('turn9search9')}\``,
    '',
    '## Sources',
    '[turn9search9]: https://example.com/reference "Visible reference"'
  ].join('\n');
  const html = exportHtml(source);
  expect(html).toContain('Visible reference');
  expect(html).not.toContain('class="meo-gpt-citation-key"');
});

test('citation numbers inside a Markdown link do not create nested anchors', () => {
  const html = exportHtml(`[Label ${cite('turn1search1')}](https://example.com/article)`);
  expect(html).toContain('<a href="https://example.com/article"');
  expect(html).toContain('<sup class="meo-gpt-citation">[<span>1</span>]</sup>');
  expect(html).toContain('id="meo-gpt-citation-1"');
});
