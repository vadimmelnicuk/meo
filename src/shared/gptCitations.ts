export interface GptCitationGroup {
  from: number;
  to: number;
  ids: string[];
}

export interface GptCitationSource {
  id: string;
  number: number;
  href: string | null;
  title: string | null;
}

export interface NumberedGptCitationGroup extends GptCitationGroup {
  sources: GptCitationSource[];
}

export interface GptCitationIndex {
  groups: NumberedGptCitationGroup[];
  sources: GptCitationSource[];
  sourceById: Map<string, GptCitationSource>;
}

export interface GptCitationDefinition {
  href: string;
  title: string | null;
}

const citationOpen = 'cite';
const citationClose = '';
const citationSeparator = '';
const citationIdPattern = /^[A-Za-z0-9_-]+$/;
const definitionPattern = /^[ \t]{0,3}\[([A-Za-z0-9_-]+)\]:[ \t]*(<[^>\r\n]+>|\S+)(?:[ \t]+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?[ \t]*$/;

export function findGptCitationGroups(text: string): GptCitationGroup[] {
  const groups: GptCitationGroup[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const from = text.indexOf(citationOpen, cursor);
    if (from < 0) break;

    const contentFrom = from + citationOpen.length;
    const closeFrom = text.indexOf(citationClose, contentFrom);
    const nextOpen = text.indexOf(citationOpen, contentFrom);
    if (closeFrom < 0 || (nextOpen >= 0 && nextOpen < closeFrom)) {
      cursor = nextOpen >= 0 ? nextOpen : contentFrom;
      continue;
    }

    const ids = text.slice(contentFrom, closeFrom).split(citationSeparator);
    if (ids.every((id) => citationIdPattern.test(id))) {
      groups.push({ from, to: closeFrom + citationClose.length, ids });
    }
    cursor = closeFrom + citationClose.length;
  }

  return groups;
}

export function parseGptCitationDefinitions(markdown: string): Map<string, GptCitationDefinition> {
  const definitions = new Map<string, GptCitationDefinition>();
  const lines = markdown.split(/\r?\n/);
  const frontmatterEnd = lines[0]?.trim() === '---'
    ? lines.findIndex((line, index) => index > 0 && (line.trim() === '---' || line.trim() === '...'))
    : -1;
  let inFence = false;
  let fenceChar = '';
  let fenceLength = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (index <= frontmatterEnd) continue;

    const fence = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      const marker = fence[1];
      if (!inFence) {
        inFence = true;
        fenceChar = marker[0];
        fenceLength = marker.length;
      } else if (marker[0] === fenceChar && marker.length >= fenceLength && !fence[2].trim()) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;

    const match = definitionPattern.exec(line);
    if (!match || definitions.has(match[1])) continue;
    const rawHref = match[2].startsWith('<') ? match[2].slice(1, -1) : match[2];
    const href = safeCitationHref(rawHref);
    if (!href) continue;
    definitions.set(match[1], {
      href,
      title: match[3] ?? match[4] ?? match[5] ?? null
    });
  }

  return definitions;
}

export function safeCitationHref(rawHref: string): string | null {
  if (!/^https?:\/\//i.test(rawHref)) return null;
  try {
    const url = new URL(rawHref);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname ? rawHref : null;
  } catch {
    return null;
  }
}

export function numberGptCitationGroups(
  groups: ReadonlyArray<GptCitationGroup>,
  definitions: ReadonlyMap<string, GptCitationDefinition>
): GptCitationIndex {
  const sources: GptCitationSource[] = [];
  const sourceById = new Map<string, GptCitationSource>();
  const numberedGroups = groups.map((group) => {
    const groupSources: GptCitationSource[] = [];
    const seen = new Set<string>();
    for (const id of group.ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      groupSources.push(ensureGptCitationSource({ sources, sourceById }, id, definitions));
    }
    return { ...group, sources: groupSources };
  });

  return { groups: numberedGroups, sources, sourceById };
}

export function ensureGptCitationSource(
  index: Pick<GptCitationIndex, 'sources' | 'sourceById'>,
  id: string,
  definitions: ReadonlyMap<string, GptCitationDefinition>
): GptCitationSource {
  const existing = index.sourceById.get(id);
  if (existing) return existing;

  const definition = definitions.get(id);
  const source: GptCitationSource = {
    id,
    number: index.sources.length + 1,
    href: definition?.href ?? null,
    title: definition?.title ?? null
  };
  index.sourceById.set(id, source);
  index.sources.push(source);
  return source;
}
