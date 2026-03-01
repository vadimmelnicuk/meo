export type ExtractedExportFrontmatter = {
  frontmatterHtml: string;
  bodyMarkdown: string;
};

type YamlFieldOffsets = {
  keyFromOffset: number;
  keyToOffset: number;
  valueFromOffset: number | null;
};

type YamlArrayItem = {
  text: string;
};

export function extractExportFrontmatter(markdownText: string): ExtractedExportFrontmatter {
  const lines = String(markdownText ?? '').split(/\r?\n/);
  if (lines.length < 2) {
    return { frontmatterHtml: '', bodyMarkdown: markdownText };
  }

  const firstLine = stripLeadingBom(lines[0] ?? '');
  if (firstLine.trim() !== '---') {
    return { frontmatterHtml: '', bodyMarkdown: markdownText };
  }

  const closingLineIndex = findFrontmatterClosingLine(lines);
  if (closingLineIndex < 1) {
    return { frontmatterHtml: '', bodyMarkdown: markdownText };
  }

  return {
    frontmatterHtml: renderFrontmatterHtml(lines.slice(1, closingLineIndex)),
    bodyMarkdown: lines.slice(closingLineIndex + 1).join('\n')
  };
}

function findFrontmatterClosingLine(lines: string[]): number {
  for (let index = 1; index < lines.length; index += 1) {
    if ((lines[index] ?? '').trim() === '---') {
      return index;
    }
  }

  return -1;
}

function renderFrontmatterHtml(contentLines: string[]): string {
  const linesHtml = contentLines.map((line) => {
    const renderedLine = renderFrontmatterLineHtml(line);
    return `<div class="meo-export-frontmatter-line">${renderedLine || '&nbsp;'}</div>`;
  }).join('');

  return [
    '<div class="meo-export-frontmatter">',
    '<div class="meo-export-frontmatter-boundary is-opening"><span class="meo-export-frontmatter-label">frontmatter</span></div>',
    linesHtml,
    '<div class="meo-export-frontmatter-boundary is-closing" aria-hidden="true">---</div>',
    '</div>'
  ].join('');
}

function renderFrontmatterLineHtml(line: string): string {
  const offsets = yamlFrontmatterFieldOffsets(line);
  if (!offsets) {
    return escapeHtml(line);
  }

  const beforeKey = line.slice(0, offsets.keyFromOffset);
  const key = line.slice(offsets.keyFromOffset, offsets.keyToOffset);
  const beforeValue = offsets.valueFromOffset === null
    ? line.slice(offsets.keyToOffset)
    : line.slice(offsets.keyToOffset, offsets.valueFromOffset);
  const value = offsets.valueFromOffset === null ? '' : line.slice(offsets.valueFromOffset);
  const arrayItems = parseSimpleYamlFlowArrayItems(line, offsets.valueFromOffset);

  return [
    escapeHtml(beforeKey),
    `<span class="meo-export-frontmatter-key">${escapeHtml(key)}</span>`,
    escapeHtml(beforeValue),
    arrayItems
      ? renderFrontmatterArrayHtml(arrayItems)
      : (value ? `<span class="meo-export-frontmatter-value">${escapeHtml(value)}</span>` : '')
  ].join('');
}

function renderFrontmatterArrayHtml(items: YamlArrayItem[]): string {
  const pills = items
    .map((item) => `<span class="meo-export-frontmatter-pill">${escapeHtml(item.text)}</span>`)
    .join('');
  return `<span class="meo-export-frontmatter-array">${pills}</span>`;
}

function yamlFrontmatterFieldOffsets(lineText: string): YamlFieldOffsets | null {
  let offset = 0;
  while (offset < lineText.length && (lineText[offset] === ' ' || lineText[offset] === '\t')) {
    offset += 1;
  }

  if (lineText[offset] === '-' && /\s/.test(lineText[offset + 1] ?? '')) {
    offset += 1;
    while (offset < lineText.length && (lineText[offset] === ' ' || lineText[offset] === '\t')) {
      offset += 1;
    }
  }

  if (offset >= lineText.length || lineText[offset] === '#') {
    return null;
  }

  const colonOffset = lineText.indexOf(':', offset);
  if (colonOffset < 0) {
    return null;
  }

  let keyEndOffset = colonOffset;
  while (keyEndOffset > offset && (lineText[keyEndOffset - 1] === ' ' || lineText[keyEndOffset - 1] === '\t')) {
    keyEndOffset -= 1;
  }
  if (keyEndOffset <= offset) {
    return null;
  }

  let valueStartOffset = colonOffset + 1;
  while (
    valueStartOffset < lineText.length &&
    (lineText[valueStartOffset] === ' ' || lineText[valueStartOffset] === '\t')
  ) {
    valueStartOffset += 1;
  }

  return {
    keyFromOffset: offset,
    keyToOffset: colonOffset + 1,
    valueFromOffset: valueStartOffset < lineText.length ? valueStartOffset : null
  };
}

function parseSimpleYamlFlowArrayItems(lineText: string, valueFromOffset: number | null): YamlArrayItem[] | null {
  if (
    valueFromOffset === null ||
    valueFromOffset < 0 ||
    valueFromOffset >= lineText.length ||
    lineText[valueFromOffset] !== '['
  ) {
    return null;
  }

  let arrayToOffset = lineText.length;
  while (arrayToOffset > valueFromOffset && (lineText[arrayToOffset - 1] === ' ' || lineText[arrayToOffset - 1] === '\t')) {
    arrayToOffset -= 1;
  }

  if (arrayToOffset <= valueFromOffset + 1 || lineText[arrayToOffset - 1] !== ']') {
    return null;
  }

  const innerFromOffset = valueFromOffset + 1;
  const innerToOffset = arrayToOffset - 1;
  if (innerToOffset <= innerFromOffset) {
    return null;
  }

  for (let index = innerFromOffset; index < innerToOffset; index += 1) {
    const ch = lineText[index];
    if (ch === '"' || ch === '\'' || ch === '[' || ch === ']' || ch === '{' || ch === '}') {
      return null;
    }
  }

  const items: YamlArrayItem[] = [];
  let partFromOffset = innerFromOffset;
  for (let index = innerFromOffset; index <= innerToOffset; index += 1) {
    const atEnd = index === innerToOffset;
    if (!atEnd && lineText[index] !== ',') {
      continue;
    }

    let itemFromOffset = partFromOffset;
    let itemToOffset = index;
    while (itemFromOffset < itemToOffset && (lineText[itemFromOffset] === ' ' || lineText[itemFromOffset] === '\t')) {
      itemFromOffset += 1;
    }
    while (itemToOffset > itemFromOffset && (lineText[itemToOffset - 1] === ' ' || lineText[itemToOffset - 1] === '\t')) {
      itemToOffset -= 1;
    }

    if (itemFromOffset >= itemToOffset) {
      return null;
    }

    items.push({ text: lineText.slice(itemFromOffset, itemToOffset) });
    partFromOffset = index + 1;
  }

  return items.length ? items : null;
}

function stripLeadingBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
