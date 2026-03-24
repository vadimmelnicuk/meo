# MEO Theming Guide

Guide on how to customise colors, syntax highlighting, fonts, heading sizes, and line-height in Markdown Editor Optimized.

## Quick Start

1. Start from a built-in preset (`Select Theme`).
2. Export JSON (`Export Theme JSON`).
3. Change only what you need (usually a few colors or token overrides).
4. Import the file (`Import Theme JSON`).
5. If needed, recover quickly with `Reset Theme to Default`.

## Built-In Themes

1. One Monokai (default)
2. One Dark Pro
3. Dracula
4. Gruvbox
5. Nord
6. Solarized Dark
7. Catppuccin Mocha
8. Tokyo Night
9. GitHub Dark

## Commands

1. `Markdown Editor Optimized: Select Theme`
2. `Markdown Editor Optimized: Import Theme JSON`
3. `Markdown Editor Optimized: Export Theme JSON`
4. `Markdown Editor Optimized: Delete Imported Theme`
5. `Markdown Editor Optimized: Reset Theme to Default`

## id

`id` is the theme's stable identifier.

- Used by theme selection/import/delete flows to identify the exact theme.
- Should be unique across your presets/imports (kebab-case like `my-theme` is recommended).
- If you change `id`, MEO treats it as a different theme entry.

## name

`name` is the human-readable label for the theme.

- Display-only metadata (it does not change color/font rendering).
- Can be changed safely without affecting how the theme looks.
- Keep it concise so it is easy to distinguish in the theme picker.

## colors

`colors` is the 9-color base palette (`base01` to `base09`) that drives the theme.

- `base01` is the main foreground color; the rest are accent/palette slots used across UI and token defaults.
- These values are used directly and also seed default syntax token colors.
- Every key from `base01` to `base09` must be present after validation/resolution.
- Color values must be valid `#hex`, `rgb()/rgba()`, `hsl()/hsla()`, or `var(--...)`.

## syntaxTokens

Each key in `syntaxTokens` maps to a syntax category. Color values must use `#hex`, `rgb()/rgba()`, `hsl()/hsla()`, or `var(--...)`.

**Code Syntax Highlighting:**
- `keyword`: Language keywords like `if`, `return`, `class`, `import`.
- `identifier`: Generic names and unresolved identifiers.
- `macroName`: Macro identifiers (for languages that support macros).
- `variableName`: Variable names in normal usage.
- `propertyName`: Object/struct property and field names.
- `typeName`: Type names (for example `string`, `User`, `Result`).
- `className`: Class identifiers.
- `namespace`: Namespace/module-like names.
- `operator`: Operators such as `+`, `-`, `=`, `=>`.
- `operatorKeyword`: Word operators like `in`, `instanceof`, `as`.
- `punctuation`: Brackets, braces, commas, colons, and similar punctuation.
- `functionName`: Function names in call sites.
- `labelName`: Labels (for example loop/switch labels).
- `definitionFunction`: Function names at declaration/definition sites.
- `definedVariable`: Variable names at declaration/definition sites.
- `number`: Numeric literals.
- `annotation`: Annotation/decorator syntax.
- `modifier`: Modifiers like `public`, `static`, `readonly`.
- `self`: Self-reference keywords (`this`, `self`, etc.).
- `color`: Color literals/tokens when a language marks them.
- `constant`: Named constants and standard constants.
- `atom`: Atom-like literals (language-defined symbolic literals).
- `bool`: Boolean literals (`true`, `false`).
- `specialVariable`: Built-in or special-purpose variables.
- `specialString`: Special string forms (for example escapes/template forms).
- `regexp`: Regular-expression literals.
- `string`: Standard string literals.
- `typeDefinition`: Type names at type-definition sites.
- `meta`: Metadata-ish tokens (pragma/directive-like syntax).
- `comment`: Comments and doc comments.
- `invalid`: Invalid/error tokens.
- `deleted`: Deleted/removed tokens when marked by parser/highlighter.
- `changed`: Changed/diff-like tokens when present in a grammar.

**Markdown:**
- `heading`: Markdown/markup heading text.
- `emphasis`: Emphasized/italic text.
- `strong`: Strong/bold text.
- `strikethrough`: Strikethrough text.
- `quote`: Blockquote/quote content.
- `contentSeparator`: Content separators (for example thematic breaks).
- `link`: Link text tokens.
- `url`: URL tokens.
- `monospace`: Monospace/code-style inline content tokens.
- `tagName`: Markup tag names (HTML/XML/MDX style).
- `attributeName`: Markup attribute names.
- `processingInstruction`: Processing-instruction-like tokens in markup grammars.

## fonts

`fonts` controls typography in live/source editors and heading/line-height behavior.

- `liveFont`: Font family for rendered markdown text.
- `sourceFont`: Font family for source/code text (also used for inline code and code blocks in Live mode).
- `liveFontWeight`: Font weight for live mode text. Free-form CSS font-weight values (for example `normal`, `bold`, `500`, `600`).
- `sourceFontWeight`: Font weight for source mode text (and monospaced token rendering in both export and Live mode code areas).
- `liveFontSize`: Live mode font size (`null` = use VS Code editor font size).
- `sourceFontSize`: Source mode font size (`null` = use VS Code editor font size).
- `h1FontSize` to `h6FontSize`: Optional heading size overrides (`null` = use defaults). Heading font sizes are in `em` units and must be between `1` and `3` when provided.
- `h1FontWeight` to `h6FontWeight`: Optional per-heading font weight overrides. Accepts CSS `font-weight` values (for example `normal`, `bold`, `500`, `600`).
- `liveLineHeight` and `sourceLineHeight`: Line-height for each mode (must be between `1` and `3`).

## Defaults and Fallbacks

- Empty syntax token color (`""`) falls back to that token's palette-derived default.
- Empty `fonts.liveFont` or `fonts.sourceFont` falls back to VS Code editor font family.
- `fonts.liveFontSize: null` and `fonts.sourceFontSize: null` fall back to VS Code editor font size.
- Empty `fonts.liveFontWeight` or `fonts.sourceFontWeight` falls back to VS Code editor font weight.
- `fonts.h1FontSize` to `fonts.h6FontSize` default to `1.6`, `1.5`, `1.3`, `1.2`, `1.1`, and `1` respectively (and `null` falls back to those defaults).
- `fonts.h1FontWeight` to `fonts.h6FontWeight` default to `600` (and empty/invalid values fall back to those defaults).
- In Live mode, inline code and code blocks use `fonts.sourceFont` (not `fonts.liveFont`).
- Export is mode-independent: body text uses `liveFontSize`, and code/monospace text uses `sourceFontSize`.
