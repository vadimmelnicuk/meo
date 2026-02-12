# Code Block Line Numbers Implementation Plan

## Requirements

- Keep global document line numbers in the gutter
- Add isolated line numbers within code blocks (starting from 1 for each block)
- Position line numbers on the left side of code block content
- Same behavior in both live and source modes

## Implementation Approach

### 1. CodeBlockLineNumberWidget Class (`webview/src/liveDecorations.js`)

Create a WidgetType class similar to `ListMarkerWidget`:

```javascript
class CodeBlockLineNumberWidget extends WidgetType {
  constructor(lineNumber) {
    super();
    this.lineNumber = lineNumber;
  }

  eq(other) {
    return other.lineNumber === this.lineNumber;
  }

  toDOM() {
    const span = document.createElement('span');
    span.className = 'meo-md-code-block-line-number';
    span.textContent = String(this.lineNumber);
    return span;
  }
}
```

### 2. Code Block Line Number Builder (`webview/src/liveDecorations.js`)

Function to build line number decorations for code blocks:

```javascript
function buildCodeBlockLineNumbers(state) {
  const ranges = [];
  const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);

  tree.iterate({
    enter: (node) => {
      if (node.name !== 'FencedCode' && node.name !== 'CodeBlock') {
        return;
      }

      const startLine = state.doc.lineAt(node.from);
      const endLine = state.doc.lineAt(Math.max(node.to - 1, node.from));

      // Skip fence marker lines for FencedCode
      let lineNumber = node.name === 'FencedCode' ? 1 : 0;
      let line = startLine;

      while (line.number <= endLine.number) {
        const lineText = state.doc.sliceString(line.from, line.to);
        const isFenceMarker = node.name === 'FencedCode' &&
          (/^`{3,}/.test(lineText) || /^~{3,}/.test(lineText));

        if (!isFenceMarker) {
          const fromPos = line.from;
          const toPos = line.from;

          ranges.push(
            Decoration.replace({
              widget: new CodeBlockLineNumberWidget(lineNumber),
              inclusive: true,
              side: -1
            }).range(fromPos, toPos)
          );

          lineNumber++;
        }

        line = state.doc.line(line.number + 1);
      }
    }
  });

  return Decoration.set(ranges, true);
}
```

### 3. StateField Integration (`webview/src/liveDecorations.js`)

Create a StateField for code block line numbers:

```javascript
const codeBlockLineNumberField = StateField.define({
  create(state) {
    return buildCodeBlockLineNumbers(state);
  },
  update(decorations, transaction) {
    if (!transaction.docChanged) {
      return decorations;
    }
    return buildCodeBlockLineNumbers(transaction.state);
  },
  provide: (field) => EditorView.decorations.from(field)
});
```

### 4. Update liveModeExtensions Export

Modify the export to include the new field:

```javascript
export function liveModeExtensions() {
  return [
    markdown({ base: markdownLanguage, addKeymap: false }),
    liveDecorationField,
    codeBlockLineNumberField
  ];
}
```

### 5. Add to Source Mode (`webview/src/editor.js`)

Import the field and add it to `sourceMode()`:

```javascript
import { liveModeExtensions, codeBlockLineNumberField } from './liveDecorations';

function sourceMode() {
  return [
    markdown({
      base: markdownLanguage,
      addKeymap: false
    }),
    syntaxHighlighting(markdownHighlightStyle),
    sourceCodeBlockField,
    codeBlockLineNumberField
  ];
}
```

### 6. CSS Styling (`webview/src/styles.css`)

Add styles for code block line numbers:

```css
.cm-editor .meo-md-code-block-line-number {
  display: inline-block;
  min-width: 3ch;
  text-align: right;
  margin-right: 0.5ch;
  color: color-mix(in srgb, var(--vscode-editorLineNumber-foreground, var(--vscode-descriptionForeground)) 72%, transparent);
  user-select: none;
  -webkit-user-select: none;
  opacity: 0.7;
}

.cm-editor.cm-focused .cm-line.meo-md-code-block .meo-md-code-block-line-number {
  opacity: 1;
}
```

## Implementation Flow

```
Syntax Tree
    ↓
Find CodeBlock nodes (FencedCode, CodeBlock)
    ↓
For each block:
    Get start/end lines
    Skip fence marker lines for FencedCode
    For each content line:
        Calculate relative line number (1, 2, 3...)
        Create CodeBlockLineNumberWidget with number
        Create Decoration.replace at line start
    ↓
Merge all decorations into StateField
    ↓
Apply to EditorView in both live and source modes
```

## Edge Cases to Handle

1. **Empty code blocks**: Only fence markers - no line numbers shown
2. **Indented code blocks**: Line numbers positioned relative to indentation
3. **Fenced code blocks**: Skip opening/closing fence lines, number only content
4. **Selection within code blocks**: Ensure line numbers don't interfere with cursor
5. **Code blocks with trailing whitespace**: Position line numbers correctly

## Testing Checklist

- [ ] Line numbers appear in code blocks in live mode
- [ ] Line numbers appear in code blocks in source mode
- [ ] Numbers start from 1 for each code block
- [ ] Fence marker lines are not numbered in fenced code blocks
- [ ] Global document line numbers remain visible in gutter
- [ ] Styling matches VS Code theme
- [ ] Selection/cursor works correctly within code blocks
- [ ] Editing code blocks updates line numbers correctly
- [ ] Different code blocks have independent numbering

## File Changes Summary

| File | Changes |
|------|---------|
| `webview/src/liveDecorations.js` | Add `CodeBlockLineNumberWidget` class, `buildCodeBlockLineNumbers()` function, `codeBlockLineNumberField` StateField, update `liveModeExtensions()` export |
| `webview/src/editor.js` | Import `codeBlockLineNumberField` and add to `sourceMode()` |
| `webview/src/styles.css` | Add `.meo-md-code-block-line-number` styling |
