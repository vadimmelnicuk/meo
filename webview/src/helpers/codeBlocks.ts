import { StateField, EditorState } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { syntaxTree, StreamLanguage } from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { cpp } from '@codemirror/lang-cpp';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { MermaidDiagramWidget, getFencedCodeContent } from './mermaidDiagram';

const shellLanguage = StreamLanguage.define({
  name: 'shell',
  startState: () => ({}),
  token: (stream: any) => {
    if (stream.match(/^#.*/)) return 'comment';
    if (stream.match(/^"[^$"]*"/)) return 'string';
    if (stream.match(/^'[^']*'/)) return 'string';
    if (stream.match(/^\$\{[^}]+\}/)) return 'variableName';
    if (stream.match(/^\$[a-zA-Z_][a-zA-Z0-9_]*/)) return 'variableName';
    if (stream.match(/^(if|then|else|elif|fi|for|do|done|while|case|esac|in|function|return|exit|echo|export|source|alias|unalias|cd|pwd|ls|grep|sed|awk|cat|printf|read|eval|local|declare|typeset|readonly|unset|shift|exec)\b/)) return 'keyword';
    if (stream.match(/^(true|false)\b/)) return 'bool';
    if (stream.match(/^\d+/)) return 'number';
    if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)) return 'variableName';
    if (stream.match(/^[^"'#\s$`{|]+/)) return 'operator';
    stream.next();
    return null;
  }
});

const powerQueryKeywords = /^(let|in|each|if|then|else|try|otherwise|error|and|or|not|as|is|type|meta|section|shared)\b/i;
const powerQueryHashKeywords = /^#(date|time|datetime|datetimezone|duration|table|binary|sections|shared)\b/i;

function consumePowerQueryQuotedTail(stream: any): void {
  while (!stream.eol()) {
    if (!stream.skipTo('"')) {
      stream.skipToEnd();
      break;
    }
    stream.next();
    if (stream.peek() === '"') {
      stream.next();
      continue;
    }
    break;
  }
}

function consumePowerQueryQuoted(stream: any): boolean {
  if (stream.next() !== '"') {
    return false;
  }

  consumePowerQueryQuotedTail(stream);
  return true;
}

interface PowerQueryState {
  inBlockComment: boolean;
}

function consumePowerQueryBlockComment(stream: any, state: PowerQueryState): void {
  state.inBlockComment = true;
  while (!stream.eol()) {
    if (stream.match('*/')) {
      state.inBlockComment = false;
      break;
    }
    stream.next();
  }
}

const powerQueryLanguage = StreamLanguage.define({
  name: 'powerquery',
  startState: () => ({ inBlockComment: false }),
  token: (stream: any, state: PowerQueryState) => {
    if (stream.eatSpace()) {
      return null;
    }

    if (state.inBlockComment) {
      consumePowerQueryBlockComment(stream, state);
      return 'comment';
    }

    if (stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }

    if (stream.match('/*')) {
      consumePowerQueryBlockComment(stream, state);
      return 'comment';
    }

    if (stream.match(/^\[[^\]\r\n]+\]/)) {
      return 'propertyName';
    }

    if (stream.match(/^@[a-z_][a-z0-9_]*/i)) {
      return 'variableName';
    }

    if (stream.match(powerQueryHashKeywords)) {
      return 'keyword';
    }

    if (stream.match(/^#"/)) {
      consumePowerQueryQuotedTail(stream);
      return 'string';
    }

    if (stream.peek() === '"') {
      consumePowerQueryQuoted(stream);
      return 'string';
    }

    if (stream.match(/^(true|false)\b/i)) {
      return 'bool';
    }

    if (stream.match(/^null\b/i)) {
      return 'atom';
    }

    if (stream.match(powerQueryKeywords)) {
      return 'keyword';
    }

    if (stream.match(/^\d+(?:\.\d+)?(?:e[+-]?\d+)?/i)) {
      return 'number';
    }

    if (stream.match(/^[a-z_][a-z0-9_.]*/i)) {
      return 'variableName';
    }

    if (stream.match(/^(?:=>|<=|>=|<>|=|<|>|\+|-|\*|\/|&|\?|!|,|;|:|\(|\)|\{|\}|\[|\])+/)) {
      return 'operator';
    }

    stream.next();
    return null;
  }
});

const jsLanguage = javascript().language;
const jsxLanguage = javascript({ jsx: true }).language;
const tsLanguage = javascript({ typescript: true }).language;
const tsxLanguage = javascript({ typescript: true, jsx: true }).language;
const pythonLanguage = python().language;
const cssLanguage = css().language;
const htmlLanguage = html().language;
const jsonLanguage = json().language;
const swiftLanguage = cpp().language;
const markdownCodeLanguage = markdownLanguage;

const languageMap: Record<string, any> = {
  javascript: jsLanguage,
  js: jsLanguage,
  jsx: jsxLanguage,
  typescript: tsLanguage,
  ts: tsLanguage,
  tsx: tsxLanguage,
  python: pythonLanguage,
  py: pythonLanguage,
  css: cssLanguage,
  html: htmlLanguage,
  htm: htmlLanguage,
  json: jsonLanguage,
  markdown: markdownCodeLanguage,
  md: markdownCodeLanguage,
  swift: swiftLanguage,
  shell: shellLanguage,
  bash: shellLanguage,
  sh: shellLanguage,
  zsh: shellLanguage,
  m: powerQueryLanguage,
  powerquery: powerQueryLanguage,
  pq: powerQueryLanguage
};

export function resolveCodeLanguage(info: string | null | undefined): any {
  if (!info) {
    return null;
  }

  const normalized = info.toLowerCase().trim();

  return languageMap[normalized] ?? null;
}

export function resolveLiveCodeLanguage(info: string | null | undefined): any {
  if (!info) {
    return null;
  }

  const normalized = info.toLowerCase().trim();
  if (normalized === 'markdown' || normalized === 'md') {
    return null;
  }

  return languageMap[normalized] ?? null;
}

export function insertCodeBlock(view: EditorView, selection: { from: number; to: number; empty?: boolean }): void {
  const { state } = view;
  const line = state.doc.lineAt(selection.from);
  const lineText = state.doc.sliceString(line.from, line.to);
  const leadingWhitespace = /^(\s*)/.exec(lineText)![1];

  if (!selection.empty) {
    const selectedText = state.doc.sliceString(selection.from, selection.to);
    const insert = `\n${leadingWhitespace}\`\`\`\n${selectedText}\n${leadingWhitespace}\`\`\`\n`;
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert },
      selection: { anchor: selection.from + leadingWhitespace.length + 4 }
    });
    return;
  }

  const insert = `${leadingWhitespace}\`\`\`\n\n${leadingWhitespace}\`\`\`\n`;
  const cursorPos = line.from + leadingWhitespace.length + 4;
  view.dispatch({
    changes: { from: line.from, to: line.to, insert },
    selection: { anchor: cursorPos }
  });
}

const sourceCodeBlockLine = Decoration.line({ class: 'meo-src-code-block' });

function computeSourceCodeBlockLines(state: EditorState): any {
  const ranges: any[] = [];
  syntaxTree(state).iterate({
    enter(node: any) {
      if (node.name !== 'FencedCode' && node.name !== 'CodeBlock') {
        return;
      }
      let line = state.doc.lineAt(node.from);
      const end = state.doc.lineAt(Math.max(node.to - 1, node.from)).number;
      while (line.number <= end) {
        ranges.push(sourceCodeBlockLine.range(line.from));
        if (line.number === end) {
          break;
        }
        line = state.doc.line(line.number + 1);
      }
      return false;
    }
  });
  return Decoration.set(ranges, true);
}

export const sourceCodeBlockField = StateField.define<any>({
  create(state: EditorState) {
    try {
      return computeSourceCodeBlockLines(state);
    } catch {
      return Decoration.none;
    }
  },
  update(lines: any, transaction: any) {
    if (!transaction.docChanged) {
      return lines;
    }
    try {
      return computeSourceCodeBlockLines(transaction.state);
    } catch {
      return lines;
    }
  },
  provide: (field: any) => EditorView.decorations.from(field)
});

export function isFenceMarker(state: EditorState, from: number, to: number): boolean {
  const text = state.doc.sliceString(from, to);
  return /^`{3,}$/.test(text) || /^~{3,}$/.test(text);
}

export function getFencedCodeInfo(state: EditorState, node: any): string | null {
  let codeInfo: string | null = null;
  for (let child = node.node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'CodeInfo') {
      codeInfo = state.doc.sliceString(child.from, child.to).trim().toLowerCase();
      break;
    }
  }
  return codeInfo;
}

class CopyCodeButtonWidget extends WidgetType {
  codeContent: string;

  constructor(codeContent: string) {
    super();
    this.codeContent = codeContent;
  }

  eq(other: WidgetType): boolean {
    return other instanceof CopyCodeButtonWidget && other.codeContent === this.codeContent;
  }

  toDOM(): HTMLElement {
    const container = document.createElement('span');
    container.className = 'meo-code-block-pill meo-copy-code-btn';
    container.setAttribute('aria-label', 'Copy code');
    container.setAttribute('role', 'button');
    container.setAttribute('tabindex', '0');
    container.textContent = 'copy';

    const updateText = (copied: boolean) => {
      container.textContent = copied ? 'copied' : 'copy';
      container.classList.toggle('copied', copied);
    };

    const copy = async (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(this.codeContent);
        updateText(true);
        setTimeout(() => updateText(false), 2000);
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    };

    container.addEventListener('click', copy);
    container.addEventListener('keydown', async (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        await copy(e);
      }
    });

    return container;
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== 'pointerover' && event.type !== 'pointerout';
  }
}

class CodeLanguageLabelWidget extends WidgetType {
  labelText: string;

  constructor(labelText: string) {
    super();
    this.labelText = labelText;
  }

  eq(other: WidgetType): boolean {
    return other instanceof CodeLanguageLabelWidget && other.labelText === this.labelText;
  }

  toDOM(): HTMLElement {
    const label = document.createElement('span');
    label.className = 'meo-code-block-pill meo-code-language-label';
    label.textContent = this.labelText;
    label.setAttribute('aria-hidden', 'true');
    return label;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function addTopLineWidget(builder: any[], lineEnd: number, widget: WidgetType): void {
  builder.push(
    Decoration.widget({
      widget,
      side: 1
    }).range(lineEnd)
  );
}

export function addTopLinePillLabel(builder: any[], lineEnd: number, labelText: string | null): void {
  if (!labelText) {
    return;
  }
  addTopLineWidget(builder, lineEnd, new CodeLanguageLabelWidget(labelText));
}

export function addFenceOpeningLineMarker(builder: any[], state: EditorState, from: number, activeLines: Set<number>, addRange: Function, activeLineMarkerDeco: any, fenceMarkerDeco: any): void {
  const line = state.doc.lineAt(from);
  const text = state.doc.sliceString(line.from, line.to);
  if (!/^[ \t]{0,3}(?:`{3,}|~{3,})/.test(text)) {
    return;
  }

  if (activeLines.has(line.number)) {
    addRange(builder, line.from, line.to, activeLineMarkerDeco);
    return;
  }
  addRange(builder, line.from, line.to, fenceMarkerDeco);
}

export function addCodeLanguageLabel(builder: any[], state: EditorState, node: any, activeLines: Set<number>): void {
  if (node.name !== 'FencedCode') {
    return;
  }

  const startLine = state.doc.lineAt(node.from);
  if (activeLines.has(startLine.number)) {
    return;
  }

  const labelText = getFencedCodeInfo(state, node);
  if (!labelText) {
    return;
  }

  addTopLinePillLabel(builder, startLine.to, labelText);
}

export function addMermaidDiagram(builder: any[], state: EditorState, node: any): void {
  const diagramText = getFencedCodeContent(state, node);
  if (!diagramText.trim()) {
    return;
  }

  const startLine = state.doc.lineAt(node.from);
  const endLine = state.doc.lineAt(Math.max(node.to - 1, node.from));

  if (startLine.number >= endLine.number) {
    return;
  }

  const contentStartLine = state.doc.line(startLine.number + 1);
  const contentEndLine = state.doc.line(endLine.number - 1);

  if (contentStartLine.from >= contentEndLine.to) {
    return;
  }

  const fullBlockText = state.doc.sliceString(startLine.from, endLine.to);
  const copyWidget = new CopyCodeButtonWidget(fullBlockText);
  addTopLineWidget(builder, startLine.to, copyWidget);

  const widget = new MermaidDiagramWidget(diagramText);
  builder.push(
    Decoration.replace({
      widget,
      block: true
    }).range(contentStartLine.from, contentEndLine.to)
  );
}

export function addCopyCodeButton(builder: any[], state: EditorState, from: number, to: number): void {
  const startLine = state.doc.lineAt(from);
  const endLine = state.doc.lineAt(Math.max(to - 1, from));

  const codeLines: string[] = [];
  for (let lineNum = startLine.number + 1; lineNum <= endLine.number; lineNum += 1) {
    const line = state.doc.line(lineNum);
    const lineText = line.text;

    if (lineNum === endLine.number) {
      const fenceMatch = /^[ \t]*[`~]{3,}.*$/.exec(lineText);
      if (fenceMatch) {
        continue;
      }
    }

    codeLines.push(lineText);
  }

  const codeContent = codeLines.join('\n');
  if (!codeContent) {
    return;
  }

  const widget = new CopyCodeButtonWidget(codeContent);
  addTopLineWidget(builder, startLine.to, widget);
}
