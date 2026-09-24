import { expect, test } from 'bun:test';
import {
  collectLatexMathRanges as collectLiveMath,
  parseLatexMathAt,
  renderLatexMathToHtml as renderLiveMath
} from '../webview/src/helpers/math.ts';
import {
  collectLatexMathRanges as collectExportMath,
  renderLatexMathToHtml as renderExportMath
} from '../src/export/math.ts';
import { renderMarkdownToHtml } from '../src/export/renderMarkdown.ts';
import { normalizeMermaidDiagramText } from '../webview/src/helpers/mermaidDiagram.ts';
import { buildExportHtmlDocument } from '../src/export/exportHtmlTemplate.ts';

const standardEquation = '\\[\n\\tau =\n\\tau\\_y + K\\dot{\\gamma}^{\\,n}\n\\]';
const doubledEquation = '\\\\[\n\\tau =\n\\tau\\_y + K\\dot{\\gamma}^{\\\\,n}\n\\\\]';
const normalizedEquation = '\\tau =\n\\tau_y + K\\dot{\\gamma}^{\\,n}';

for (const [name, collect, render] of [
  ['live editor', collectLiveMath, renderLiveMath],
  ['export', collectExportMath, renderExportMath]
]) {
  test(`${name} parses and renders GPT bracket equations`, () => {
    for (const equation of [standardEquation, doubledEquation]) {
      const ranges = collect(equation);
      expect(ranges).toHaveLength(1);
      expect(ranges[0]).toMatchObject({
        from: 0,
        to: equation.length,
        mode: 'display',
        fencedDisplay: true,
        content: normalizedEquation,
        raw: equation
      });
      expect(render(ranges[0].content, 'display')).toContain('katex-display');
    }
  });

  test(`${name} keeps existing dollar math and rejects incomplete brackets`, () => {
    expect(collect('$$x^2$$')).toMatchObject([{ mode: 'display', content: 'x^2' }]);
    expect(collect('\\[\nx^2')).toHaveLength(0);
    expect(collect('\\\\[ x^2 \\\\]')).toHaveLength(0);
  });
}

test('live math respects code exclusions and table parsing', () => {
  const source = `\`\\[x\]\` and \\[y\\]`;
  const ranges = collectLiveMath(source, { excludedRanges: [{ from: 0, to: 7 }] });
  expect(ranges).toMatchObject([{ raw: '\\[y\\]', mode: 'display' }]);
  expect(parseLatexMathAt('\\[x+y\\]', 0)).toMatchObject({ content: 'x+y', mode: 'display' });
});

test('HTML export renders bracket math beside Markdown and leaves code alone', () => {
  const markdownText = `**Equation**\n${doubledEquation}\n\n\`\`\`text\n${standardEquation}\n\`\`\``;
  const result = renderMarkdownToHtml({
    markdownText,
    markdownFilePath: '/tmp/math.md',
    target: 'html'
  });
  expect(result.hasMath).toBe(true);
  expect(result.html).toContain('<strong>Equation</strong>');
  expect(result.html.match(/meo-export-math-display/g)).toHaveLength(1);
  expect(result.html).toContain('meo-export-math-fenced-display');
  expect(result.html).toContain('language-text');
});

test('Mermaid treats bracket equations as math diagrams in live and export rendering', () => {
  const liveSource = normalizeMermaidDiagramText(doubledEquation);
  expect(liveSource).toContain('flowchart LR');
  expect(liveSource).toContain('class MATH meoMath');
  expect(liveSource).toContain('\\\\tau_y');

  const html = buildExportHtmlDocument({
    title: 'Math',
    bodyHtml: '',
    stylesCss: '',
    hasMermaid: true,
    hasMath: false
  });
  const runtime = html.match(/<script data-meo-export-runtime>([\s\S]*?)<\/script>/)?.[1];
  expect(runtime).toBeDefined();
  const runtimePrefix = runtime.slice(0, runtime.indexOf('  const trimDisplayMathSvg'));
  const normalizeExportSource = new Function(
    'document', 'window', `return ${runtimePrefix.trimStart()}return normalizeMermaidSource;})()`
  )({ getElementById: () => null }, {});
  const exportSource = normalizeExportSource(doubledEquation);
  expect(exportSource).toContain('flowchart LR');
  expect(exportSource).toContain('class MATH meoMath');
  expect(exportSource).toContain('\\\\tau_y');
});
