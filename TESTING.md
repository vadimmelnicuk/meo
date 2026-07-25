# Testing

`bun run test` invokes all test suites.

## Unit tests

`bun run test:unit` runs `src/**/*.test.ts` and `webview/**/*.test.ts`.
It exercises the CodeMirror `EditorState`s and loads `lezer` GitHub-Flavored Markdown syntax trees,
but does not load a DOM.

## Browser tests

`bun run test:browser` loads `browserTests/**/*.test.ts`.

Each test uses Puppeteer's build of Chrome for Testing, headless,
to load a page containing our webview bundle and a VS Code [webview API](https://code.visualstudio.com/api/extension-guides/webview) spy,
and then uses [Puppeteer](https://pptr.dev/) to manipulate the CodeMirror and observe what's rendered.

### Limitations

- These tests don't cover `./src/extension/`.
  The test harness composes postMessages itself rather than delegating to `./src/extension/panelSession.ts`.
- The harness doesn't fake any of the `--vscode-*` CSS variables that VS Code would inject into a real webview,
  so **all `var(--vscode-*)` values effectively resolve to `unset`.**
- The harness currently doesn't load a Mermaid runtime.

## VS Code extension tests

**TODO:** Use [`@vscode/test-electron`](https://github.com/microsoft/vscode-test)
to exercise `./src/extension/` in an actual running instance of VS Code.
