import { EditorState } from '@codemirror/state';
import { getFencedCodeInfo } from './codeBlocks';
import { isThematicBreakLine } from './frontmatter';
import { resolvedSyntaxTree } from './markdownSyntax';
import { getMermaidColonBlocks, rangeOverlapsMermaidColonBlock } from './mermaidColonBlocks';
import { isTableDelimiterLine, parseTableInfo } from './tables';

type LineFlagLike = {
  added?: boolean;
  modified?: boolean;
  trailingEofProxyOnly?: boolean;
} | undefined;

export type LiveRenderedBlockKind = 'table' | 'mermaid';
export type LiveGitChangeKind = 'added' | 'modified';

export interface LiveRenderedBlock {
  kind: LiveRenderedBlockKind;
  startLine: number;
  endLine: number;
  delimiterLine: number | null;
  lineNumberHiddenFrom: number;
  lineNumberHiddenTo: number;
}

export interface LiveCollapsedGitBlock {
  kind: LiveRenderedBlockKind;
  startLine: number;
  endLine: number;
  canonicalLine: number;
  aggregateChangeKind: LiveGitChangeKind;
  containsLine(lineNo: number): boolean;
}

const renderedBlockCache = new WeakMap<EditorState, { tree: any; blocks: LiveRenderedBlock[] }>();
const collapsedBlockCache = new WeakMap<EditorState, {
  lineFlags: readonly LineFlagLike[];
  blocks: LiveCollapsedGitBlock[];
}>();

function createRenderedBlock(
  kind: LiveRenderedBlockKind,
  startLine: number,
  endLine: number,
  delimiterLine: number | null
): LiveRenderedBlock | null {
  if (!Number.isFinite(startLine) || !Number.isFinite(endLine) || startLine < 1 || endLine < startLine) {
    return null;
  }

  if (kind === 'table') {
    return {
      kind,
      startLine,
      endLine,
      delimiterLine,
      lineNumberHiddenFrom: startLine,
      lineNumberHiddenTo: endLine
    };
  }

  return {
    kind,
    startLine,
    endLine,
    delimiterLine: null,
    lineNumberHiddenFrom: startLine + 1,
    lineNumberHiddenTo: endLine - 1
  };
}

function rangesOverlap(fromA: number, toA: number, fromB: number, toB: number): boolean {
  return fromA < toB && toA > fromB;
}

function isTableContentLine(lineText: string): boolean {
  return lineText.includes('|');
}

function isInsideCodeBlock(tree: any, pos: number): boolean {
  let node = tree.resolveInner(pos, 1);
  while (node) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
      return true;
    }
    node = node.parent;
  }
  return false;
}

function detectFallbackTableBlocks(
  state: EditorState,
  tree: any,
  parsedTableRanges: Array<{ from: number; to: number }>,
  mermaidColonBlocks: ReadonlyArray<{ from: number; to: number }>
): LiveRenderedBlock[] {
  const blocks: LiveRenderedBlock[] = [];

  for (let lineNo = 2; lineNo <= state.doc.lines; lineNo += 1) {
    const delimiterLine = state.doc.line(lineNo);
    const delimiterText = state.doc.sliceString(delimiterLine.from, delimiterLine.to);
    if (isThematicBreakLine(delimiterText)) continue;
    if (!isTableDelimiterLine(delimiterText)) continue;

    const headerLineNo = lineNo - 1;
    const headerLine = state.doc.line(headerLineNo);
    const headerText = state.doc.sliceString(headerLine.from, headerLine.to);
    if (!isTableContentLine(headerText)) continue;

    let endLineNo = lineNo;
    for (let rowLineNo = lineNo + 1; rowLineNo <= state.doc.lines; rowLineNo += 1) {
      const rowLine = state.doc.line(rowLineNo);
      const rowText = state.doc.sliceString(rowLine.from, rowLine.to);
      if (!isTableContentLine(rowText)) break;
      endLineNo = rowLineNo;
    }

    const from = state.doc.line(headerLineNo).from;
    const to = state.doc.line(endLineNo).to;
    if (parsedTableRanges.some((range) => rangesOverlap(from, to, range.from, range.to))) {
      lineNo = endLineNo;
      continue;
    }
    if (isInsideCodeBlock(tree, from)) {
      lineNo = endLineNo;
      continue;
    }
    if (rangeOverlapsMermaidColonBlock(mermaidColonBlocks, from, to)) {
      lineNo = endLineNo;
      continue;
    }

    const block = createRenderedBlock('table', headerLineNo, endLineNo, lineNo);
    if (block) {
      blocks.push(block);
    }
    lineNo = endLineNo;
  }

  return blocks;
}

export function getLiveRenderedBlocks(state: EditorState): LiveRenderedBlock[] {
  const tree = resolvedSyntaxTree(state);
  const cached = renderedBlockCache.get(state);
  if (cached?.tree === tree) {
    return cached.blocks;
  }

  const blocks: LiveRenderedBlock[] = [];
  const parsedTableRanges: Array<{ from: number; to: number }> = [];
  const mermaidColonBlocks = getMermaidColonBlocks(state);

  tree.iterate({
    enter(node) {
      if (node.name === 'Table') {
        const tableInfo = parseTableInfo(state, node);
        parsedTableRanges.push({ from: tableInfo.from, to: tableInfo.to });
        const block = createRenderedBlock(
          'table',
          tableInfo.startLine,
          tableInfo.endLine,
          tableInfo.delimiterRow?.lineNo ?? null
        );
        if (block) {
          blocks.push(block);
        }
        return;
      }

      if (node.name !== 'FencedCode') {
        return;
      }

      if (getFencedCodeInfo(state, node) !== 'mermaid') {
        return;
      }

      const startLine = state.doc.lineAt(node.from).number;
      const endLine = state.doc.lineAt(Math.max(node.to - 1, node.from)).number;
      const block = createRenderedBlock('mermaid', startLine, endLine, null);
      if (block) {
        blocks.push(block);
      }
    }
  });

  for (const block of mermaidColonBlocks) {
    const renderedBlock = createRenderedBlock('mermaid', block.startLine, block.endLine, null);
    if (renderedBlock) {
      blocks.push(renderedBlock);
    }
  }

  blocks.push(...detectFallbackTableBlocks(state, tree, parsedTableRanges, mermaidColonBlocks));
  blocks.sort((left, right) => (
    left.startLine - right.startLine ||
    left.endLine - right.endLine
  ));
  renderedBlockCache.set(state, { tree, blocks });
  return blocks;
}

function createCollapsedBlock(
  block: LiveRenderedBlock,
  canonicalLine: number,
  aggregateChangeKind: LiveGitChangeKind
): LiveCollapsedGitBlock {
  return {
    kind: block.kind,
    startLine: block.startLine,
    endLine: block.endLine,
    canonicalLine,
    aggregateChangeKind,
    containsLine(lineNo: number): boolean {
      return lineNo >= block.startLine && lineNo <= block.endLine;
    }
  };
}

function buildCollapsedBlock(
  block: LiveRenderedBlock,
  lineFlags: readonly LineFlagLike[] | null | undefined
): LiveCollapsedGitBlock | null {
  if (!Array.isArray(lineFlags) || !lineFlags.length) {
    return null;
  }

  let firstChangedLine = 0;
  let hasModified = false;
  let hasAdded = false;
  let hasNonDelimiterChange = false;

  for (let lineNo = block.startLine; lineNo <= block.endLine; lineNo += 1) {
    const flags = lineFlags[lineNo - 1];
    const modified = !!(flags?.modified || flags?.trailingEofProxyOnly);
    const added = !!flags?.added;
    if (!modified && !added) {
      continue;
    }
    if (!firstChangedLine) {
      firstChangedLine = lineNo;
    }
    if (lineNo !== block.delimiterLine) {
      hasNonDelimiterChange = true;
    }
    if (modified) {
      hasModified = true;
      continue;
    }
    hasAdded = true;
  }

  if (!firstChangedLine || (!hasModified && !hasAdded)) {
    return null;
  }

  let canonicalLine = firstChangedLine;
  if (
    block.kind === 'table' &&
    block.delimiterLine !== null &&
    !hasNonDelimiterChange &&
    firstChangedLine === block.delimiterLine
  ) {
    canonicalLine = block.startLine;
  }

  return createCollapsedBlock(block, canonicalLine || block.startLine, hasModified ? 'modified' : 'added');
}

function findCollapsedBlockAtLine(
  blocks: readonly LiveCollapsedGitBlock[],
  lineNo: number
): LiveCollapsedGitBlock | null {
  let low = 0;
  let high = blocks.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const block = blocks[mid];
    if (lineNo < block.startLine) {
      high = mid - 1;
      continue;
    }
    if (lineNo > block.endLine) {
      low = mid + 1;
      continue;
    }
    return block;
  }

  return null;
}

function findRenderedBlockAtLine(
  blocks: readonly LiveRenderedBlock[],
  lineNo: number
): LiveRenderedBlock | null {
  let low = 0;
  let high = blocks.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const block = blocks[mid];
    if (lineNo < block.startLine) {
      high = mid - 1;
      continue;
    }
    if (lineNo > block.endLine) {
      low = mid + 1;
      continue;
    }
    return block;
  }

  return null;
}

export function getLiveRenderedBlockAtLine(
  state: EditorState,
  lineNo: number
): LiveRenderedBlock | null {
  const blocks = getLiveRenderedBlocks(state);
  if (!blocks.length) {
    return null;
  }
  return findRenderedBlockAtLine(blocks, Math.max(1, Math.floor(lineNo)));
}

export function getLiveGitCollapsedBlocks(
  state: EditorState,
  lineFlags: readonly LineFlagLike[] | null | undefined
): LiveCollapsedGitBlock[] {
  if (!Array.isArray(lineFlags) || !lineFlags.length) {
    return [];
  }

  const cached = collapsedBlockCache.get(state);
  if (cached?.lineFlags === lineFlags) {
    return cached.blocks;
  }

  const collapsed: LiveCollapsedGitBlock[] = [];
  for (const block of getLiveRenderedBlocks(state)) {
    const next = buildCollapsedBlock(block, lineFlags);
    if (next) {
      collapsed.push(next);
    }
  }
  collapsedBlockCache.set(state, { lineFlags, blocks: collapsed });
  return collapsed;
}

export function getLiveGitCollapsedBlockAtLine(
  state: EditorState,
  lineFlags: readonly LineFlagLike[] | null | undefined,
  lineNo: number
): LiveCollapsedGitBlock | null {
  const blocks = getLiveGitCollapsedBlocks(state, lineFlags);
  if (!blocks.length) {
    return null;
  }
  return findCollapsedBlockAtLine(blocks, Math.max(1, Math.floor(lineNo)));
}
