import path from 'node:path';

export type PrepareMarkdownWithFootnotesOptions = {
  target: 'html' | 'pdf';
  outputFilePath?: string;
  renderMarkdown: (markdownText: string) => string;
  normalizeMarkdown: (markdownText: string) => string;
};

export type PreparedMarkdownWithFootnotes = {
  bodyMarkdown: string;
  footnotesHtml: string;
};

type ExportFootnoteDefinition = {
  normalizedLabel: string;
  number: number | null;
  contentMarkdown: string;
  referenceIds: string[];
};

const definitionMarkerPattern = /^[ \t]{0,3}\[\^([^\]\r\n]+)\]:(?:[ \t]|$)/;

export function prepareMarkdownWithFootnotes(
  markdownText: string,
  options: PrepareMarkdownWithFootnotesOptions
): PreparedMarkdownWithFootnotes {
  const extracted = extractExportFootnotes(markdownText);
  const numberByLabel = new Map<string, number>();
  const referenceCountsByLabel = new Map<string, number>();
  const hrefPrefix = getInternalDocumentHrefPrefix(options);
  const fenceState = createFenceState();
  let nextNumber = 1;

  const bodyLines = extracted.bodyLines.map((line) => {
    if (updateFenceState(fenceState, line) || fenceState.inFence) {
      return line;
    }

    return replaceFootnoteReferencesInLine(line, (rawLabel) => {
      const normalizedLabel = normalizeFootnoteLabel(rawLabel);
      const definition = extracted.definitionByLabel.get(normalizedLabel);
      if (!definition) {
        return null;
      }

      let footnoteNumber = numberByLabel.get(normalizedLabel);
      if (!footnoteNumber) {
        footnoteNumber = nextNumber;
        nextNumber += 1;
        numberByLabel.set(normalizedLabel, footnoteNumber);
      }

      const nextCount = (referenceCountsByLabel.get(normalizedLabel) ?? 0) + 1;
      referenceCountsByLabel.set(normalizedLabel, nextCount);
      definition.number = footnoteNumber;

      const referenceId = nextCount === 1 ? `fnref-${footnoteNumber}` : `fnref-${footnoteNumber}-${nextCount}`;
      definition.referenceIds.push(referenceId);

      return [
        '<sup class="footnote-ref">',
        `<a href="${escapeHtmlAttr(buildInternalAnchorHref(hrefPrefix, `fn-${footnoteNumber}`))}" id="${escapeHtmlAttr(referenceId)}">${footnoteNumber}</a>`,
        '</sup>'
      ].join('');
    });
  });

  const footnotes = extracted.definitions
    .filter((definition) => definition.number !== null)
    .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));

  return {
    bodyMarkdown: bodyLines.join('\n'),
    footnotesHtml: renderFootnotesHtml(footnotes, hrefPrefix, options)
  };
}

type FenceState = {
  inFence: boolean;
  char: '`' | '~' | '';
  length: number;
};

function createFenceState(): FenceState {
  return {
    inFence: false,
    char: '',
    length: 0
  };
}

function updateFenceState(state: FenceState, line: string): boolean {
  const fence = parseFenceLine(line);
  if (!fence) {
    return false;
  }

  if (!state.inFence) {
    state.inFence = true;
    state.char = fence.char;
    state.length = fence.length;
    return true;
  }

  if (fence.char === state.char && fence.length >= state.length) {
    state.inFence = false;
    state.char = '';
    state.length = 0;
  }

  return true;
}

function getInternalDocumentHrefPrefix(options: PrepareMarkdownWithFootnotesOptions): string {
  if (options.target !== 'html' || !options.outputFilePath) {
    return '';
  }

  const fileName = path.basename(options.outputFilePath);
  return fileName ? encodeURIComponent(fileName) : '';
}

function extractExportFootnotes(markdownText: string): {
  bodyLines: string[];
  definitions: ExportFootnoteDefinition[];
  definitionByLabel: Map<string, ExportFootnoteDefinition>;
} {
  const lines = String(markdownText ?? '').split(/\r?\n/);
  const consumedLineNumbers = new Set<number>();
  const definitions: ExportFootnoteDefinition[] = [];
  const definitionByLabel = new Map<string, ExportFootnoteDefinition>();
  const fenceState = createFenceState();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (updateFenceState(fenceState, line) || fenceState.inFence) {
      continue;
    }

    const markerMatch = definitionMarkerPattern.exec(line);
    if (!markerMatch) {
      continue;
    }

    const normalizedLabel = normalizeFootnoteLabel(markerMatch[1]);
    if (!normalizedLabel || definitionByLabel.has(normalizedLabel)) {
      continue;
    }

    consumedLineNumbers.add(index);
    const contentLines = [line.slice(markerMatch[0].length)];

    while (index + 1 < lines.length) {
      const nextLine = lines[index + 1] ?? '';
      if (definitionMarkerPattern.test(nextLine)) {
        break;
      }
      if (!nextLine.trim()) {
        consumedLineNumbers.add(index + 1);
        contentLines.push('');
        index += 1;
        continue;
      }

      const stripped = stripFootnoteContinuationIndent(nextLine);
      if (stripped === null) {
        break;
      }

      consumedLineNumbers.add(index + 1);
      contentLines.push(stripped);
      index += 1;
    }

    const definition: ExportFootnoteDefinition = {
      normalizedLabel,
      number: null,
      contentMarkdown: contentLines.join('\n'),
      referenceIds: []
    };

    definitions.push(definition);
    definitionByLabel.set(normalizedLabel, definition);
  }

  return {
    bodyLines: lines.filter((_, index) => !consumedLineNumbers.has(index)),
    definitions,
    definitionByLabel
  };
}

function replaceFootnoteReferencesInLine(
  line: string,
  renderReference: (label: string) => string | null
): string {
  if (!line || isIndentedCodeLine(line)) {
    return line;
  }

  let out = '';
  let index = 0;
  let inCodeSpan = false;
  let codeMarker = '';

  while (index < line.length) {
    const ch = line[index];

    if (ch === '\\' && index + 1 < line.length) {
      out += line.slice(index, index + 2);
      index += 2;
      continue;
    }

    if (ch === '`') {
      let markerEnd = index + 1;
      while (markerEnd < line.length && line[markerEnd] === '`') {
        markerEnd += 1;
      }

      const marker = line.slice(index, markerEnd);
      if (!inCodeSpan) {
        inCodeSpan = true;
        codeMarker = marker;
      } else if (marker === codeMarker) {
        inCodeSpan = false;
        codeMarker = '';
      }
      out += marker;
      index = markerEnd;
      continue;
    }

    if (!inCodeSpan && ch === '[' && line[index + 1] === '^') {
      const closeIndex = line.indexOf(']', index + 2);
      if (closeIndex > index + 2) {
        const rendered = renderReference(line.slice(index + 2, closeIndex));
        if (rendered) {
          out += rendered;
          index = closeIndex + 1;
          continue;
        }
      }
    }

    out += ch;
    index += 1;
  }

  return out;
}

function renderFootnotesHtml(
  footnotes: ExportFootnoteDefinition[],
  hrefPrefix: string,
  options: PrepareMarkdownWithFootnotesOptions
): string {
  if (!footnotes.length) {
    return '';
  }

  const itemsHtml = footnotes.map((footnote) => renderFootnoteItemHtml(footnote, hrefPrefix, options)).join('');
  return [
    '<section class="footnotes">',
    '<hr>',
    '<ol class="footnotes-list">',
    itemsHtml,
    '</ol>',
    '</section>'
  ].join('');
}

function renderFootnoteItemHtml(
  footnote: ExportFootnoteDefinition,
  hrefPrefix: string,
  options: PrepareMarkdownWithFootnotesOptions
): string {
  const number = footnote.number ?? 0;
  const firstReferenceId = footnote.referenceIds[0] ?? '';
  const referenceHref = buildInternalAnchorHref(hrefPrefix, firstReferenceId);
  const contentHtml = options.renderMarkdown(options.normalizeMarkdown(footnote.contentMarkdown)).trim();
  const indexHtml = firstReferenceId
    ? `<a href="${escapeHtmlAttr(referenceHref)}" class="footnote-index" aria-label="Back to reference ${number}">${number}.</a>`
    : `<span class="footnote-index">${number}.</span>`;
  const backlinkHtml = firstReferenceId
    ? `<a href="${escapeHtmlAttr(referenceHref)}" class="footnote-backref" aria-label="Back to reference">↩</a>`
    : '';

  return [
    `<li id="fn-${number}" class="footnote-item">`,
    indexHtml,
    `<div class="footnote-body">${appendFootnoteBacklink(contentHtml, backlinkHtml)}</div>`,
    '</li>'
  ].join('');
}

function appendFootnoteBacklink(contentHtml: string, backlinkHtml: string): string {
  if (!backlinkHtml) {
    return contentHtml;
  }

  if (contentHtml.endsWith('</p>')) {
    return `${contentHtml.slice(0, -4)} ${backlinkHtml}</p>`;
  }

  return `${contentHtml}${backlinkHtml}`;
}

function buildInternalAnchorHref(prefix: string, fragmentId: string): string {
  return prefix ? `${prefix}#${fragmentId}` : `#${fragmentId}`;
}

function normalizeFootnoteLabel(rawLabel: string): string {
  return String(rawLabel ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function stripFootnoteContinuationIndent(line: string): string | null {
  let visibleIndent = 0;
  let offset = 0;

  while (offset < line.length) {
    const ch = line[offset];
    if (ch === ' ') {
      visibleIndent += 1;
      offset += 1;
    } else if (ch === '\t') {
      visibleIndent += 4 - (visibleIndent % 4);
      offset += 1;
    } else {
      break;
    }

    if (visibleIndent >= 2) {
      return line.slice(offset);
    }
  }

  return null;
}

function isIndentedCodeLine(line: string): boolean {
  return /^(?: {4,}|\t)/.test(line);
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
