import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { defaultThemeColors } from '../../src/shared/themeDefaults';

// Monokai-inspired color palette adapted for VS Code's theming system
const base01 = 'var(--vscode-editor-foreground)';
const base02 = `var(--meo-color-base02, ${defaultThemeColors.base02})`;
const base03 = `var(--meo-color-base03, ${defaultThemeColors.base03})`;
const base04 = `var(--meo-color-base04, ${defaultThemeColors.base04})`;
const base05 = `var(--meo-color-base05, ${defaultThemeColors.base05})`;
const base06 = `var(--meo-color-base06, ${defaultThemeColors.base06})`;
const base07 = `var(--meo-color-base07, ${defaultThemeColors.base07})`;
const base08 = `var(--meo-color-base08, ${defaultThemeColors.base08})`;
const base09 = `var(--meo-color-base09, ${defaultThemeColors.base09})`;

export { base01, base02, base03, base04, base05, base06, base07, base08, base09 };

export const highlightStyle = HighlightStyle.define([
  // Code block syntax highlighting
  { tag: t.keyword, color: base04, fontWeight: 'bold' },
  { tag: t.controlKeyword, color: base04, fontWeight: 'bold' },
  { tag: t.moduleKeyword, color: base04, fontWeight: 'bold' },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: base05 },
  { tag: t.variableName, color: base01 },
  { tag: t.propertyName, color: base09, fontStyle: 'normal' },
  { tag: t.typeName, color: base06, fontStyle: 'italic' },
  { tag: t.className, color: base09, fontStyle: 'italic' },
  { tag: t.namespace, color: base05, fontStyle: 'italic' },
  { tag: t.operator, color: base01 },
  { tag: t.operatorKeyword, color: base01 },
  { tag: t.bracket, color: base01 },
  { tag: t.brace, color: base01 },
  { tag: t.punctuation, color: base01 },
  { tag: t.function(t.variableName), color: base06 },
  { tag: t.labelName, color: base02 },
  { tag: [t.definition(t.function(t.variableName))], color: base06 },
  { tag: t.definition(t.variableName), color: base05 },
  { tag: t.number, color: base08 },
  { tag: t.changed, color: base08 },
  { tag: t.annotation, color: base04, fontStyle: 'italic' },
  { tag: t.modifier, color: base08, fontStyle: 'italic' },
  { tag: t.self, color: base08 },
  { tag: t.color, color: base08 },
  { tag: t.constant(t.name), color: base08 },
  { tag: t.standard(t.name), color: base08 },
  { tag: t.atom, color: base05 },
  { tag: t.bool, color: base08 },
  { tag: t.special(t.variableName), color: base08 },
  { tag: t.special(t.string), color: base07 },
  { tag: t.regexp, color: base07 },
  { tag: t.string, color: base07 },
  { tag: t.definition(t.typeName), color: base06, fontWeight: 'bold' },
  { tag: t.meta, color: base02 },
  { tag: t.comment, fontStyle: 'italic', color: base02 },
  { tag: t.docComment, fontStyle: 'italic', color: base02 },
  { tag: t.tagName, color: base04 },
  { tag: t.attributeName, color: base09 },
  { tag: t.invalid, color: base01, textDecoration: 'underline wavy', borderBottom: `1px wavy ${base04}` },
  { tag: t.constant(t.name), color: base08 },
  { tag: t.deleted, color: base04 },
  { tag: t.squareBracket, color: base01 },
  { tag: t.angleBracket, color: base01 },
  // Markdown tag hgihlighting
  { tag: t.monospace, color: base07 },
  { tag: t.heading, color: base04, fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, color: base07, fontWeight: '600' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.quote, color: base07 },
  { tag: t.contentSeparator, color: base02 },
  { tag: t.link, color: base05 },
  { tag: t.url, color: base05 },
  { tag: t.processingInstruction, color: base02 },
]);
