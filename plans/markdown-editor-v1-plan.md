# MEO v1: Inline Live Markdown Editor (Obsidian/Typora-style)

## Summary

Build a VS Code custom Markdown editor that uses CodeMirror 6 for editing, with a Typora-like live mode where Markdown syntax markers are hidden outside the active block and formatting is rendered inline.

This v1 will ship:

- Core live preview scope (CommonMark + GFM baseline)
- `Live` + `Source` toggle in a webview toolbar
- Debounced incremental sync to VS Code document
- Single editor view per document
- Cmd/Ctrl+Click link opening

## Public Interfaces / Types / Contracts

- Update `/Users/vm/Developer/meo/src/extension.ts` message protocol between extension and webview:
  - `init`: `{ type: "init", text: string, version: number, mode: "live" | "source" }`
  - `applyChanges`: `{ type: "applyChanges", baseVersion: number, changes: Array<{ from: number, to: number, insert: string }> }`
  - `docChanged`: `{ type: "docChanged", text: string, version: number }`
  - `setMode`: `{ type: "setMode", mode: "live" | "source" }`
  - `openLink`: `{ type: "openLink", href: string }`
- Keep custom editor registration as single-view (`supportsMultipleEditorsPerDocument: false`) in `/Users/vm/Developer/meo/src/extension.ts`.
- Add pinned core editor deps in `/Users/vm/Developer/meo/package.json`:
  - `@codemirror/state`, `@codemirror/view`, `@codemirror/language`, `@codemirror/lang-markdown`, `@codemirror/commands`
  - Pin exact versions for these core packages.
- Add webview modules under `/Users/vm/Developer/meo/webview/src/`:
  - `index.js` (bootstrap + VS Code bridge)
  - `editor.js` (CodeMirror setup)
  - `liveDecorations.js` (Typora-like reveal/hide logic)
  - `styles.css` (editor + toolbar styling)

## Implementation Plan

1. Build the extension<->webview editing model.
- On editor open, send full document text + version + default mode.
- On webview edits, receive incremental offset-based changes and apply with `WorkspaceEdit` using `document.positionAt(...)`.
- Debounce outbound webview changes (~100-150ms) before posting to extension.
- Prevent echo loops by suppressing extension-to-webview rebroadcast for extension-applied webview-origin changes; rebroadcast only for external document mutations/version conflicts.

2. Implement CodeMirror source mode first (baseline correctness).
- Initialize CM6 with markdown language support (`lang-markdown`) configured for CommonMark + GFM features.
- Enable history, selection, keyboard navigation, and undo/redo compatibility.
- Keep source mode as plain markdown-visible editing for fallback/debugging.

3. Implement live mode decorations (Typora behavior).
- Add a `StateField` + `ViewPlugin` that computes decorations from syntax tree.
- Hide markdown punctuation markers outside the active block/line.
- Reveal full active block around cursor/selection.
- Apply inline style marks for headings, emphasis, strong text, blockquotes, inline code, fenced code blocks, and list/task visuals.
- Keep code fences readable and stable (no aggressive hiding inside fenced code content).

4. Add mode toggle UI in the webview toolbar.
- Render a simple segmented control: `Live | Source`.
- Toggle updates editor extensions immediately without reloading panel.
- Persist mode per panel session (webview state) and keep extension informed via `setMode`.

5. Add link interaction model.
- In live mode, Cmd/Ctrl+Click link text emits `openLink`.
- Extension handles opening via `vscode.env.openExternal`.
- Plain click keeps editing focus and cursor movement.

6. Harden extension HTML/CSP and resource loading.
- Update webview HTML generator in `/Users/vm/Developer/meo/src/extension.ts` to include bundled JS (and CSS if emitted) with strict CSP.
- Ensure `localResourceRoots` includes webview dist assets only.

7. Performance and reliability guardrails.
- Recompute decorations incrementally on transactions, not full reparse on every paint.
- Validate behavior on large files (thousands of lines) and avoid synchronous heavy DOM work.
- Maintain selection and scroll position during external updates where possible; on conflict, prefer authoritative document text + restore nearest cursor position.

## Manual Test Cases and Scenarios

- Open `.md` file in custom editor and verify initial content equals text document.
- Type markdown syntax in `Live` mode and verify formatted inline rendering with hidden markers outside active block.
- Move cursor into formatted block and verify markers reveal for that block only.
- Toggle `Live` <-> `Source` and verify content/selection stability.
- Undo/redo across multiple edits and ensure text document stays in sync.
- Edit same file externally (regular text editor pane) and confirm webview refreshes accurately.
- Cmd/Ctrl+Click a markdown link in live mode and verify external open; normal click should not navigate.
- Validate single-view behavior by attempting split open and confirming expected custom editor policy.
- Smoke test with large markdown file for typing latency and scroll smoothness.

## Assumptions and Defaults

- Existing uncommitted workspace changes are treated as baseline and will not be reverted.
- MVP parser/render profile is CommonMark + GFM (not full Obsidian flavor yet).
- Toolbar-only mode toggle is sufficient for v1 (no extra VS Code command required).
- Manual testing only for v1; no automated test suite will be added in this phase.
- Obsidian-credit-inspired components beyond CM6/Lezer (remark/Prism/YAML/DOMPurify) are deferred unless needed by subsequent advanced features (wikilinks/callouts/frontmatter HTML transforms).

## External References Used

- Obsidian credits: [https://help.obsidian.md/credits](https://help.obsidian.md/credits)
- CodeMirror decorations example: [https://codemirror.net/examples/decoration/](https://codemirror.net/examples/decoration/)
- CodeMirror markdown package: [https://github.com/codemirror/lang-markdown](https://github.com/codemirror/lang-markdown)
- VS Code Custom Text Editor guide: [https://code.visualstudio.com/api/extension-guides/custom-editors](https://code.visualstudio.com/api/extension-guides/custom-editors)
