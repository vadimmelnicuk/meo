import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const base01 = 'var(--vscode-editor-foreground)';
const base02 = '#676f7d';
const base03 = 'var(--vscode-descriptionForeground)';
const base04 = '#e06c75';
const base05 = '#61afef';
const base06 = '#66D9EF';
const base07 = '#e5c07b';
const base08 = '#c678dd';
const base09 = '#98c379';

export { base01, base02, base03, base04, base05, base06, base07, base08, base09 };

export const monokaiHighlightStyle = HighlightStyle.define([
  // Code block syntax highlighting
  { tag: t.keyword, color: base04, fontWeight: 'bold' },
  { tag: t.controlKeyword, color: base04, fontWeight: 'bold' },
  { tag: t.moduleKeyword, color: base04, fontWeight: 'bold' },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: base05 },
  { tag: [t.variableName], color: base01 },
  { tag: [t.propertyName], color: base09, fontStyle: 'normal' },
  { tag: [t.typeName], color: base06, fontStyle: 'italic' },
  { tag: [t.className], color: base09, fontStyle: 'italic' },
  { tag: [t.namespace], color: base05, fontStyle: 'italic' },
  { tag: [t.operator, t.operatorKeyword], color: base01 },
  { tag: [t.bracket], color: base01 },
  { tag: [t.brace], color: base01 },
  { tag: [t.punctuation], color: base01 },
  { tag: [t.function(t.variableName)], color: base06 },
  { tag: t.labelName, color: base02 },
  { tag: [t.definition(t.function(t.variableName))], color: base06 },
  { tag: [t.definition(t.variableName)], color: base05 },
  { tag: t.number, color: base08 },
  { tag: t.changed, color: base08 },
  { tag: t.annotation, color: base04, fontStyle: 'italic' },
  { tag: t.modifier, color: base08, fontStyle: 'italic' },
  { tag: t.self, color: base08 },
  { tag: t.color, color: base08 },
  { tag: t.constant(t.name), color: base08 },
  { tag: t.standard(t.name), color: base08 },
  { tag: t.atom, color: base08 },
  { tag: t.bool, color: base08 },
  { tag: t.special(t.variableName), color: base08 },
  { tag: t.special(t.string), color: base07 },
  { tag: t.regexp, color: base07 },
  { tag: t.string, color: base07 },
  { tag: t.definition(t.typeName), color: base06, fontWeight: 'bold' },
  { tag: t.meta, color: base02 },
  { tag: t.comment, fontStyle: 'italic', color: base02 },
  { tag: t.docComment, fontStyle: 'italic', color: base02 },
  { tag: [t.tagName], color: base04 },
  { tag: [t.attributeName], color: base09 },
  { tag: [t.invalid], color: base01, textDecoration: 'underline wavy', borderBottom: `1px wavy ${base04}` },
  { tag: t.constant(t.name), color: base08 },
  { tag: t.deleted, color: base04 },
  { tag: t.squareBracket, color: base01 },
  { tag: t.angleBracket, color: base01 },
  // Markdown tag hgihlighting
  { tag: t.monospace, color: base07 },
  { tag: t.heading, color: base04, fontWeight: '600' },
  { tag: t.processingInstruction, color: base02 },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.quote, t.contentSeparator], color: base07 },
  { tag: t.link, color: base05 },
  { tag: t.url, color: base05 },
]);
