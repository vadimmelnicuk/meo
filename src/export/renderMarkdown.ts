import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import sanitizeHtml from 'sanitize-html';
import { rewriteExportImageSrc } from './assetPaths';

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

  const md = new MarkdownIt({
    html: true,
    linkify: true,
    breaks: false,
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
  installTaskListTransform(md);

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

  const rawHtml = md.render(normalizedMarkdown);
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
      'hr'
    ],
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel', 'title'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
      '*': ['class', 'style', 'id', 'data-source-b64', 'aria-hidden'],
      th: ['colspan', 'rowspan', 'style'],
      td: ['colspan', 'rowspan', 'style'],
      code: ['class'],
      div: ['class', 'data-source-b64']
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
  return ensureBlankLinesAroundTableBlocks(markdownText);
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
  return first.toLowerCase();
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
