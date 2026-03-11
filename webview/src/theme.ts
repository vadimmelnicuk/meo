import { HighlightStyle } from '@codemirror/language';
import { resolveTheme, SYNTAX_TAG_SPECS, type SyntaxTokenStyleSpec } from '../../src/shared/themeDefaults';

const defaultTheme = resolveTheme();

const buildSpec = (spec: SyntaxTokenStyleSpec) => {
  const color = `var(--meo-token-${spec.id}-color, ${defaultTheme.syntaxTokens[spec.id]})`;

  return {
    tag: spec.tags,
    color,
    fontStyle: spec.style.fontStyle,
    fontWeight: spec.style.fontWeight,
    textDecoration: spec.style.textDecoration,
    borderBottom: spec.style.borderBottom
  };
};

export const highlightStyle = HighlightStyle.define(SYNTAX_TAG_SPECS.map(buildSpec));
