# MEO - Markdown Editor Optimized

A native VS Code custom editor for Markdown files powered by CodeMirror 6 with live preview mode.

## Features
- Custom editor for `.md` files with live preview and modern toolbar
- Uses VS Code color tokens and layout guidance
- Live mode hides markdown syntax markers outside active blocks
- Source mode with full syntax highlighting

## Development

Install dependencies:

```bash
bun install:all
```

Build the extension and webview:

```bash
bun run build
```

Run extension in development mode:

```
FN+F5 (or F5) in VS Code to launch the extension in a new window with the webview.
```

## Usage
- Open a `.md` file.
- Run the command `Markdown Editor Optimized: Open With Editor`.
- Set as default editor if desired.
