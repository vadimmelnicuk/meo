# MEO - Markdown Editor Optimized

A native VS Code custom editor for Markdown files powered by Vue 3, Vite, and `md-editor-v3`.

## Features
- Custom editor for `.md` files with live preview and modern toolbar
- Uses VS Code color tokens and layout guidance

## Development

Install dependencies:

```bash
bun install
bun run install:webview
```

Build the extension and webview:

```bash
bun run compile
```

Run extension in development mode:

```
FN+F5 (or F5) in VS Code to launch the extension in a new window with the webview.
```

## Usage
- Open a `.md` file.
- Run the command `Markdown Editor Optimized: Open With Editor`.
- Set as default editor if desired.
