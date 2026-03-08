import MarkdownIt from 'markdown-it';
import { light as emoji } from 'markdown-it-emoji';
import hljs from 'highlight.js';
import sanitizeHtml from 'sanitize-html';
import { rewriteExportImageSrc } from './assetPaths';
import { extractExportFrontmatter } from './frontmatter';
import { prepareMarkdownWithFootnotes } from './footnotes';
import { Info, Lightbulb, AlertCircle, AlertTriangle, XCircle } from 'lucide';

const POWER_QUERY_KEYWORDS =
  'let in each if then else try otherwise error and or not as is type meta section shared';
const POWER_QUERY_HASH_KEYWORDS =
  '#date #time #datetime #datetimezone #duration #table #binary #sections #shared';
const FENCE_LANGUAGE_ALIASES: Record<string, string> = {
  m: 'powerquery',
  pq: 'powerquery',
  rs: 'rust',
  golang: 'go',
  cs: 'csharp',
  'c#': 'csharp'
};

registerExportLanguages();

export type RenderMarkdownTarget = 'html' | 'pdf';

export type RenderMarkdownOptions = {
  markdownText: string;
  markdownFilePath: string;
  outputFilePath?: string;
  target: RenderMarkdownTarget;
};

export type RenderMarkdownResult = {
  html: string;
  hasMermaid: boolean;
};

export function renderMarkdownToHtml(options: RenderMarkdownOptions): RenderMarkdownResult {
  let hasMermaid = false;
  const normalizedMarkdown = normalizeMarkdownForExport(options.markdownText);
  const extractedFrontmatter = extractExportFrontmatter(normalizedMarkdown);

  const md = new MarkdownIt({
    html: true,
    linkify: true,
    breaks: true,
    langPrefix: 'language-',
    highlight(code, info) {
      const language = normalizeFenceLanguage(info);
      if (language === 'mermaid') {
        hasMermaid = true;
        const sourceB64 = Buffer.from(code, 'utf8').toString('base64');
        return [
          `<div class="meo-export-mermaid" data-source-b64="${escapeHtmlAttr(sourceB64)}">`,
          '<pre class="meo-export-code-block"><code class="language-mermaid">',
          escapeHtml(code),
          '</code></pre>',
          '</div>'
        ].join('');
      }

      const highlighted = highlightFence(code, language);
      const className = language ? ` class="hljs language-${escapeHtmlAttr(language)}"` : ' class="hljs"';
      const languageLabel = language
        ? `<div class="meo-export-code-language-label">${escapeHtml(language)}</div>`
        : '';
      return [
        '<div class="meo-export-code-block-wrap">',
        languageLabel,
        `<pre class="meo-export-code-block"><code${className}>${highlighted}</code></pre>`,
        '</div>'
      ].join('');
    }
  });
  md.use(emoji);
  installTaskListTransform(md);
  installAlertTransform(md);

  const defaultImageRule = md.renderer.rules.image ?? ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts));
  md.renderer.rules.image = (tokens, idx, opts, env, self) => {
    const token = tokens[idx];
    const src = token.attrGet('src') ?? '';
    const rewritten = rewriteExportImageSrc(src, {
      markdownFilePath: options.markdownFilePath,
      outputFilePath: options.outputFilePath,
      target: options.target
    });
    token.attrSet('src', rewritten);
    token.attrSet('loading', 'eager');
    return defaultImageRule(tokens, idx, opts, env, self);
  };

  const preparedMarkdown = prepareMarkdownWithFootnotes(extractedFrontmatter.bodyMarkdown, {
    target: options.target,
    outputFilePath: options.outputFilePath,
    renderMarkdown: (markdownText) => md.render(markdownText),
    normalizeMarkdown: normalizeMarkdownForExport
  });
  const bodyHtml = md.render(preparedMarkdown.bodyMarkdown);
  const rawHtml = [
    extractedFrontmatter.frontmatterHtml,
    bodyHtml,
    preparedMarkdown.footnotesHtml
  ].join('');
  const html = sanitizeHtml(rawHtml, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      'img',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'th',
      'td',
      'pre',
      'code',
      'span',
      'div',
      'hr',
      'svg',
      'path',
      'circle',
      'line',
      'rect',
      'polygon',
      'polyline'
    ],
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel', 'title'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
      '*': ['class', 'style', 'id', 'data-source-b64', 'aria-hidden'],
      th: ['colspan', 'rowspan', 'style'],
      td: ['colspan', 'rowspan', 'style'],
      code: ['class'],
      div: ['class', 'data-source-b64'],
      svg: ['xmlns', 'width', 'height', 'viewbox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'],
      path: ['d'],
      circle: ['cx', 'cy', 'r'],
      line: ['x1', 'x2', 'y1', 'y2'],
      rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
      polygon: ['points'],
      polyline: ['points']
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel', 'file', 'data'],
    allowedSchemesByTag: {
      img: ['http', 'https', 'file', 'data']
    },
    allowProtocolRelative: false,
    allowedStyles: {
      '*': {
        'text-align': [/^left$/i, /^right$/i, /^center$/i, /^justify$/i]
      }
    },
    transformTags: {
      svg: (tagName, attribs) => {
        return {
          tagName,
          attribs: {
            ...attribs,
            viewBox: attribs.viewbox,
            'stroke-width': attribs['stroke-width'],
            'stroke-linecap': attribs['stroke-linecap'],
            'stroke-linejoin': attribs['stroke-linejoin']
          }
        };
      },
      a: (tagName, attribs) => {
        const href = `${attribs.href ?? ''}`.trim();
        const next = { ...attribs };
        if (/^https?:/i.test(href)) {
          next.target = '_blank';
          next.rel = 'noopener noreferrer';
        }
        return { tagName, attribs: next };
      }
    }
  });

  return { html, hasMermaid };
}

function normalizeMarkdownForExport(markdownText: string): string {
  return ensureBlankLinesAroundTableBlocks(normalizeMermaidColonFences(markdownText));
}

function normalizeMermaidColonFences(markdownText: string): string {
  const lines = String(markdownText ?? '').split(/\r?\n/);
  const out: string[] = [];
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  let pendingMermaidBlock: {
    colonCount: number;
    indent: string;
    openingLine: string;
    lines: string[];
  } | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';

    if (pendingMermaidBlock) {
      if (isMermaidColonFenceCloseLine(line, pendingMermaidBlock.colonCount)) {
        out.push(`${pendingMermaidBlock.indent}\`\`\`mermaid`);
        out.push(...pendingMermaidBlock.lines);
        out.push(`${pendingMermaidBlock.indent}\`\`\``);
        pendingMermaidBlock = null;
        continue;
      }

      pendingMermaidBlock.lines.push(line);
      continue;
    }

    const fence = parseFenceLine(line);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceChar = fence.char;
        fenceLen = fence.length;
      } else if (fence.char === fenceChar && fence.length >= fenceLen) {
        inFence = false;
        fenceChar = '';
        fenceLen = 0;
      }
      out.push(line);
      continue;
    }

    if (inFence) {
      out.push(line);
      continue;
    }

    const mermaidOpen = parseMermaidColonFenceOpenLine(line);
    if (mermaidOpen) {
      pendingMermaidBlock = {
        colonCount: mermaidOpen.colonCount,
        indent: mermaidOpen.indent,
        openingLine: line,
        lines: []
      };
      continue;
    }

    out.push(line);
  }

  if (pendingMermaidBlock) {
    out.push(pendingMermaidBlock.openingLine);
    out.push(...pendingMermaidBlock.lines);
  }

  return out.join('\n');
}

function parseMermaidColonFenceOpenLine(line: string): { indent: string; colonCount: number } | null {
  const match = /^([ \t]{0,3})(:{3,})\s*mermaid\s*$/i.exec(line.trimEnd());
  if (!match) {
    return null;
  }
  return { indent: match[1], colonCount: match[2].length };
}

function isMermaidColonFenceCloseLine(line: string, colonCount: number): boolean {
  if (colonCount < 3) {
    return false;
  }
  return new RegExp(`^[ \\t]{0,3}:{${colonCount},}\\s*$`).test(line.trimEnd());
}

function ensureBlankLinesAroundTableBlocks(markdownText: string): string {
  const lines = String(markdownText ?? '').split(/\r?\n/);
  const out: string[] = [];
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';

    const fence = parseFenceLine(line);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceChar = fence.char;
        fenceLen = fence.length;
      } else if (fence.char === fenceChar && fence.length >= fenceLen) {
        inFence = false;
        fenceChar = '';
        fenceLen = 0;
      }
      out.push(line);
      continue;
    }

    if (inFence) {
      out.push(line);
      continue;
    }

    if (!isTableHeaderLine(line) || !isTableDelimiterLine(lines[i + 1] ?? '')) {
      out.push(line);
      continue;
    }

    if (out.length > 0 && out[out.length - 1].trim() !== '') {
      out.push('');
    }

    out.push(line);
    i += 1;
    out.push(lines[i] ?? '');

    while (i + 1 < lines.length && isTableRowLine(lines[i + 1] ?? '')) {
      i += 1;
      out.push(lines[i] ?? '');
    }

    if (i + 1 < lines.length && (lines[i + 1] ?? '').trim() !== '') {
      out.push('');
    }
  }

  return out.join('\n');
}

function isTableHeaderLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes('|') && trimmed !== '|';
}

function isTableRowLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }
  return trimmed.includes('|');
}

function isTableDelimiterLine(line: string): boolean {
  const trimmed = line.trim();
  return /^\|?\s*:?[-]{3,}:?\s*(\|\s*:?[-]{3,}:?\s*)+\|?$/.test(trimmed);
}

function parseFenceLine(line: string): { char: '`' | '~'; length: number } | null {
  const match = /^[ \t]{0,3}([`~]{3,})/.exec(line);
  if (!match) {
    return null;
  }
  const marker = match[1];
  const char = marker[0];
  if (char !== '`' && char !== '~') {
    return null;
  }
  return {
    char,
    length: marker.length
  };
}

function installTaskListTransform(md: MarkdownIt): void {
  md.core.ruler.after('inline', 'meo-task-list-transform', (state: any) => {
    const itemStack: Array<{ token: any; firstInlineHandled: boolean }> = [];

    for (const token of state.tokens as any[]) {
      if (token.type === 'list_item_open') {
        itemStack.push({ token, firstInlineHandled: false });
        continue;
      }

      if (token.type === 'list_item_close') {
        itemStack.pop();
        continue;
      }

      if (token.type !== 'inline' || itemStack.length === 0) {
        continue;
      }

      const current = itemStack[itemStack.length - 1];
      if (current.firstInlineHandled) {
        continue;
      }
      current.firstInlineHandled = true;

      const match = /^\[(x|X| )\]\s+/.exec(token.content ?? '');
      if (!match) {
        continue;
      }

      const checked = match[1].toLowerCase() === 'x';
      current.token.attrJoin('class', 'meo-export-task-item');
      if (checked) {
        current.token.attrJoin('class', 'is-checked');
      }

      removeTaskPrefixFromInlineToken(token, match[0].length);

      const children = Array.isArray(token.children) ? token.children : [];
      const checkboxToken = new state.Token('html_inline', '', 0);
      checkboxToken.content = `<span class="meo-export-task-checkbox${checked ? ' is-checked' : ''}" aria-hidden="true"></span>`;
      const openTextToken = new state.Token('html_inline', '', 0);
      openTextToken.content = `<span class="meo-export-task-text${checked ? ' is-checked' : ''}">`;
      const closeTextToken = new state.Token('html_inline', '', 0);
      closeTextToken.content = '</span>';

      token.children = [checkboxToken, openTextToken, ...children, closeTextToken];
    }
  });
}

function removeTaskPrefixFromInlineToken(token: any, prefixLength: number): void {
  token.content = String(token.content ?? '').slice(prefixLength);

  if (!Array.isArray(token.children) || prefixLength <= 0) {
    return;
  }

  let remaining = prefixLength;
  for (const child of token.children) {
    if (remaining <= 0) {
      break;
    }
    if (child.type !== 'text') {
      continue;
    }
    const content = String(child.content ?? '');
    if (!content) {
      continue;
    }
    if (content.length <= remaining) {
      remaining -= content.length;
      child.content = '';
      continue;
    }
    child.content = content.slice(remaining);
    remaining = 0;
  }

  token.children = token.children.filter((child: any) => !(child.type === 'text' && !child.content));
}

function normalizeFenceLanguage(info: string): string {
  const first = `${info ?? ''}`.trim().split(/\s+/, 1)[0] ?? '';
  const normalized = first.toLowerCase();
  return FENCE_LANGUAGE_ALIASES[normalized] ?? normalized;
}

const ALERT_TYPES = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'] as const;
type AlertType = typeof ALERT_TYPES[number];

type IconNode = [string, Record<string, string>][];

function renderLucideIcon(iconNode: IconNode): string {
  const innerHtml = iconNode.map(([tag, attrs]) => {
    const attrString = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
    return `<${tag} ${attrString}/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${innerHtml}</svg>`;
}

const ALERT_ICONS: Record<AlertType, string> = {
  NOTE: renderLucideIcon(Info as unknown as IconNode),
  TIP: renderLucideIcon(Lightbulb as unknown as IconNode),
  IMPORTANT: renderLucideIcon(AlertCircle as unknown as IconNode),
  WARNING: renderLucideIcon(AlertTriangle as unknown as IconNode),
  CAUTION: renderLucideIcon(XCircle as unknown as IconNode)
};

function installAlertTransform(md: MarkdownIt): void {
  const defaultBlockquoteRender = md.renderer.rules.blockquote_open ??
    ((tokens: any, idx: number, opts: any, _env: any, self: any) => self.renderToken(tokens, idx, opts));

  md.renderer.rules.blockquote_open = (tokens: any, idx: number, opts: any, env: any, self: any) => {
    const openToken = tokens[idx];
    let alertType: AlertType | null = null;
    let headerHtml = '';
    const TokenCons = tokens[0].constructor as any;

    for (let i = idx + 1; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (token.type === 'blockquote_close') break;
      if (token.type === 'paragraph_open') continue;
      if (token.type === 'inline' && token.content) {
        const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.exec(token.content.trim());
        if (match) {
          alertType = match[1].toUpperCase() as AlertType;
          headerHtml = [
            '<span class="meo-export-alert-header">',
            `<span class="meo-export-alert-icon">${ALERT_ICONS[alertType]}</span>`,
            `<span class="meo-export-alert-label">${alertType}</span>`,
            '</span>'
          ].join('');
          token.content = token.content.replace(match[0], '').trim();
          if (!token.content && tokens[i + 1]?.type === 'paragraph_close') {
            token.content = '';
            token.children = [];
          }
        }
        break;
      }
    }

    if (alertType && ALERT_TYPES.includes(alertType)) {
      openToken.attrJoin('class', `meo-export-alert meo-export-alert-${alertType.toLowerCase()}`);

      let insertedHeader = false;
      for (let i = idx + 1; i < tokens.length; i += 1) {
        const token = tokens[i];
        if (token.type === 'blockquote_close') break;
        if (token.type !== 'inline') {
          continue;
        }

        if (token.children) {
          for (const child of token.children) {
            if (child.type === 'softbreak') {
              child.type = 'hardbreak';
              child.tag = 'br';
              child.nesting = 0;
            }
          }
        }

        if (insertedHeader) {
          continue;
        }

        const htmlToken = new TokenCons('html_inline', '', 0);
        htmlToken.content = headerHtml;

        token.children = token.children ?? [];
        token.children.unshift(htmlToken);

        for (const child of token.children) {
          if (child.type === 'text') {
            child.content = child.content.replace(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i, '').trimLeft();
            break;
          }
        }

        insertedHeader = true;
      }
    }

    return defaultBlockquoteRender(tokens, idx, opts, env, self);
  };
}

function registerExportLanguages(): void {
  if (hljs.getLanguage('powerquery')) {
    return;
  }

  hljs.registerLanguage('powerquery', () => ({
    name: 'PowerQuery',
    keywords: {
      keyword: POWER_QUERY_KEYWORDS,
      literal: 'true false null',
      built_in: POWER_QUERY_HASH_KEYWORDS
    },
    contains: [
      hljs.C_LINE_COMMENT_MODE,
      hljs.COMMENT(/\/\*/, /\*\//),
      {
        className: 'property',
        begin: /\[[^\]\r\n]+\]/
      },
      {
        className: 'variable',
        begin: /@[a-z_][a-z0-9_]*/i
      },
      {
        className: 'string',
        variants: [
          {
            begin: /#?"/,
            end: /(?<!")"(?!")/,
            contains: [{ begin: /""/ }]
          }
        ]
      },
      {
        className: 'number',
        begin: /\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/i
      }
    ]
  }));
}

function highlightFence(code: string, language: string): string {
  if (language && hljs.getLanguage(language)) {
    try {
      return hljs.highlight(code, {
        language,
        ignoreIllegals: true
      }).value;
    } catch {
      // Fallback to escaped plain text.
    }
  }
  return escapeHtml(code);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeHtmlAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}
