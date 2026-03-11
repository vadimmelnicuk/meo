export const linkSchemeRe = /^[a-z][a-z0-9+.-]*:/i;
const sourceRawUrlRe = /(?:https?:\/\/|mailto:|file:|www\.)[^\s<>"'`]+/gi;

function trimTrailingUrlPunctuation(value: string): string {
  let trimmed = value.replace(/[.,!?;:]+$/g, '');
  const pairs: Array<[string, string]> = [['(', ')'], ['[', ']'], ['{', '}']];
  for (const [open, close] of pairs) {
    while (trimmed.endsWith(close)) {
      const openCount = trimmed.split(open).length - 1;
      const closeCount = trimmed.split(close).length - 1;
      if (closeCount <= openCount) {
        break;
      }
      trimmed = trimmed.slice(0, -1);
    }
  }
  return trimmed;
}

export function normalizeSourceHref(value: string): string {
  const trimmed = trimTrailingUrlPunctuation((value ?? '').trim());
  if (!trimmed) {
    return '';
  }
  if (trimmed.startsWith('www.')) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

export type RawSourceUrlMatch = {
  index: number;
  href: string;
  length: number;
};

export function findRawSourceUrlMatches(text: string): RawSourceUrlMatch[] {
  sourceRawUrlRe.lastIndex = 0;
  const matches: RawSourceUrlMatch[] = [];
  for (let match = sourceRawUrlRe.exec(text); match; match = sourceRawUrlRe.exec(text)) {
    const href = normalizeSourceHref(match[0]);
    if (!href) {
      continue;
    }
    matches.push({
      index: match.index,
      href,
      length: href.length
    });
  }
  return matches;
}
