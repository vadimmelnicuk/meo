import katex from 'katex';

export type LatexMathMode = 'inline' | 'display';

export interface LatexMathRange {
  from: number;
  to: number;
  mode: LatexMathMode;
  content: string;
  raw: string;
  fencedDisplay?: boolean;
}

const MATH_RENDER_CACHE_LIMIT = 300;
const mathHtmlCache = new Map<string, string | null>();
const INLINE_MATH_MARKDOWN_STRUCTURE_MARKERS = ['**', '__', '~~', '`', '](', '!['] as const;
const INLINE_MATH_PROSE_LENGTH_LIMIT = 120;
const INLINE_MATH_CURRENCY_CONTENT_RE = /^[0-9][0-9\s,._%+-]*$/;
const INLINE_MATH_TEX_COMMAND_RE = /\\[A-Za-z]+/;
const INLINE_MATH_TEX_SYMBOL_RE = /[_^{}]/;
const INLINE_MATH_ALPHA_WORD_RE = /\b[A-Za-z]{3,}\b/g;

function isEscaped(text: string, index: number): boolean {
  let slashCount = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i -= 1) {
    slashCount += 1;
  }
  return (slashCount % 2) === 1;
}

function isWhitespace(char: string | undefined): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

function lineStartAt(text: string, index: number): number {
  const previousBreak = text.lastIndexOf('\n', Math.max(0, index - 1));
  return previousBreak < 0 ? 0 : previousBreak + 1;
}

function lineEndAt(text: string, index: number): number {
  const nextBreak = text.indexOf('\n', Math.max(0, index));
  return nextBreak < 0 ? text.length : nextBreak;
}

function hasOwnLineDisplayFences(
  text: string,
  openIndex: number,
  closeIndex: number,
  delimiterLength = 2
): boolean {
  const openLineStart = lineStartAt(text, openIndex);
  const openLineEnd = lineEndAt(text, openIndex + delimiterLength);
  if (text.slice(openLineStart, openIndex).trim()) {
    return false;
  }
  if (text.slice(openIndex + delimiterLength, openLineEnd).trim()) {
    return false;
  }

  const closeLineStart = lineStartAt(text, closeIndex);
  const closeLineEnd = lineEndAt(text, closeIndex + delimiterLength);
  if (text.slice(closeLineStart, closeIndex).trim()) {
    return false;
  }
  if (text.slice(closeIndex + delimiterLength, closeLineEnd).trim()) {
    return false;
  }

  return true;
}

function bracketDisplayDelimiterLength(text: string, index: number): number {
  if (text[index] !== '\\' || isEscaped(text, index)) {
    return 0;
  }
  if (text.startsWith('\\\\[', index)) {
    return 3;
  }
  return text.startsWith('\\[', index) ? 2 : 0;
}

function normalizeBracketMathContent(content: string): string {
  return content.replace(/\\_(?=[A-Za-z0-9{])/g, '_').replace(/\\\\,/g, '\\,');
}

function looksLikeCurrencyContent(content: string): boolean {
  return INLINE_MATH_CURRENCY_CONTENT_RE.test(content);
}

function hasTexCue(content: string): boolean {
  return INLINE_MATH_TEX_COMMAND_RE.test(content) || INLINE_MATH_TEX_SYMBOL_RE.test(content);
}

function hasMarkdownStructureMarker(content: string): boolean {
  for (const marker of INLINE_MATH_MARKDOWN_STRUCTURE_MARKERS) {
    if (content.includes(marker)) {
      return true;
    }
  }
  return false;
}

function hasAtLeastTwoAlphaWords(content: string): boolean {
  INLINE_MATH_ALPHA_WORD_RE.lastIndex = 0;
  let count = 0;
  while (INLINE_MATH_ALPHA_WORD_RE.exec(content)) {
    count += 1;
    if (count >= 2) {
      INLINE_MATH_ALPHA_WORD_RE.lastIndex = 0;
      return true;
    }
  }
  INLINE_MATH_ALPHA_WORD_RE.lastIndex = 0;
  return false;
}

function shouldRejectInlineMathCandidate(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) {
    return true;
  }
  if (looksLikeCurrencyContent(trimmed)) {
    return true;
  }
  if (hasMarkdownStructureMarker(content)) {
    return true;
  }
  const hasTex = hasTexCue(content);
  if (!hasTex && trimmed.length > INLINE_MATH_PROSE_LENGTH_LIMIT) {
    return true;
  }
  if (!hasTex && hasAtLeastTwoAlphaWords(content)) {
    return true;
  }
  return false;
}

function isInlineMathOpen(text: string, index: number): boolean {
  const next = text[index + 1];
  if (!next || next === '$') {
    return false;
  }
  if (isWhitespace(next)) {
    return false;
  }
  return true;
}

function isInlineMathClose(text: string, index: number): boolean {
  const previous = text[index - 1];
  if (!previous || isWhitespace(previous)) {
    return false;
  }
  return true;
}

function findInlineMathClose(text: string, start: number): number {
  let braceLevel = 0;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (character === '\n' || character === '\r') {
      return -1;
    }

    if (character === '$' && !isEscaped(text, index) && braceLevel <= 0 && isInlineMathClose(text, index)) {
      return index;
    }

    if (character === '\\') {
      index += 1;
      continue;
    }

    if (character === '{') {
      braceLevel += 1;
    } else if (character === '}' && braceLevel > 0) {
      braceLevel -= 1;
    }
  }

  return -1;
}

function findDisplayMathClose(text: string, start: number): number {
  let braceLevel = 0;

  for (let index = start; index < text.length - 1; index += 1) {
    const character = text[index];
    if (
      character === '$' &&
      text[index + 1] === '$' &&
      !isEscaped(text, index) &&
      braceLevel <= 0
    ) {
      return index;
    }

    if (character === '\\') {
      index += 1;
      continue;
    }

    if (character === '{') {
      braceLevel += 1;
    } else if (character === '}' && braceLevel > 0) {
      braceLevel -= 1;
    }
  }

  return -1;
}

function findBracketDisplayMathClose(text: string, start: number, delimiterLength: number): number {
  const closeDelimiter = delimiterLength === 3 ? '\\\\]' : '\\]';
  let braceLevel = 0;

  for (let index = start; index < text.length;) {
    if (braceLevel === 0 && text.startsWith(closeDelimiter, index) && !isEscaped(text, index)) {
      return index;
    }
    if (text[index] === '\\') {
      index += 2;
      continue;
    }
    if (text[index] === '{') {
      braceLevel += 1;
    } else if (text[index] === '}' && braceLevel > 0) {
      braceLevel -= 1;
    }
    index += 1;
  }

  return -1;
}

export function parseBracketDisplayMathAt(text: string, index: number): LatexMathRange | null {
  const delimiterLength = bracketDisplayDelimiterLength(text, index);
  if (!delimiterLength) {
    return null;
  }

  const close = findBracketDisplayMathClose(text, index + delimiterLength, delimiterLength);
  if (close <= index + delimiterLength) {
    return null;
  }
  const rawContent = text.slice(index + delimiterLength, close);
  const content = normalizeBracketMathContent(rawContent.trim());
  const fencedDisplay = hasOwnLineDisplayFences(text, index, close, delimiterLength);
  if (!content || ((rawContent.includes('\n') || rawContent.includes('\r') || delimiterLength === 3) && !fencedDisplay)) {
    return null;
  }

  return {
    from: index,
    to: close + delimiterLength,
    mode: 'display',
    content,
    raw: text.slice(index, close + delimiterLength),
    fencedDisplay
  };
}

export function collectLatexMathRanges(text: string): LatexMathRange[] {
  if (!text || text.length < 2 || (text.indexOf('$') < 0 && text.indexOf('\\[') < 0)) {
    return [];
  }

  const ranges: LatexMathRange[] = [];

  for (let index = 0; index < text.length;) {
    if (text[index] === '\\') {
      const bracketMath = parseBracketDisplayMathAt(text, index);
      if (bracketMath) {
        ranges.push(bracketMath);
        index = bracketMath.to;
        continue;
      }
    }
    if (text[index] !== '$' || isEscaped(text, index)) {
      index += 1;
      continue;
    }

    if (text[index + 1] === '$') {
      const close = findDisplayMathClose(text, index + 2);
      if (close > index + 2) {
        const rawContent = text.slice(index + 2, close);
        const content = rawContent.trim();
        const multiline = rawContent.includes('\n') || rawContent.includes('\r');
        const fencedDisplay = hasOwnLineDisplayFences(text, index, close);
        if (multiline && !fencedDisplay) {
          index = close + 2;
          continue;
        }
        if (content) {
          ranges.push({
            from: index,
            to: close + 2,
            mode: 'display',
            content,
            raw: text.slice(index, close + 2),
            fencedDisplay
          });
        }
        index = close + 2;
        continue;
      }
      index += 2;
      continue;
    }

    if (!isInlineMathOpen(text, index)) {
      index += 1;
      continue;
    }

    const close = findInlineMathClose(text, index + 1);
    if (close <= index + 1) {
      index += 1;
      continue;
    }

    const content = text.slice(index + 1, close);
    if (shouldRejectInlineMathCandidate(content)) {
      // Skip only the opening '$' so later inline candidates on this line are still discovered.
      index += 1;
      continue;
    }

    ranges.push({
      from: index,
      to: close + 1,
      mode: 'inline',
      content,
      raw: text.slice(index, close + 1)
    });
    index = close + 1;
  }

  return ranges;
}

function getCachedMathHtml(cacheKey: string): string | null | undefined {
  const cached = mathHtmlCache.get(cacheKey);
  if (cached === undefined) {
    return undefined;
  }
  mathHtmlCache.delete(cacheKey);
  mathHtmlCache.set(cacheKey, cached);
  return cached;
}

function pushMathHtmlCache(cacheKey: string, value: string | null): void {
  if (mathHtmlCache.has(cacheKey)) {
    mathHtmlCache.delete(cacheKey);
  }
  mathHtmlCache.set(cacheKey, value);
  if (mathHtmlCache.size <= MATH_RENDER_CACHE_LIMIT) {
    return;
  }
  const oldestKey = mathHtmlCache.keys().next().value;
  if (oldestKey !== undefined) {
    mathHtmlCache.delete(oldestKey);
  }
}

export function renderLatexMathToHtml(content: string, mode: LatexMathMode): string | null {
  const normalized = String(content ?? '').trim();
  if (!normalized) {
    return null;
  }

  const cacheKey = `${mode}:${normalized}`;
  const cached = getCachedMathHtml(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const html = katex.renderToString(normalized, {
      displayMode: mode === 'display',
      throwOnError: true,
      strict: 'ignore',
      output: 'html'
    });
    pushMathHtmlCache(cacheKey, html);
    return html;
  } catch {
    pushMathHtmlCache(cacheKey, null);
    return null;
  }
}
