## Add Mermaid Fence Rendering in Live Mode (VS Code Webview)

### Summary
Implement Mermaid support for fenced blocks (` ```mermaid `) by rendering diagrams inline in **Live** mode only, while keeping raw markdown unchanged in **Source** mode. Invalid Mermaid input will fall back to showing the code block with a visible error badge. Diagrams stay rendered in Live mode even when cursor enters the block (editing remains via Source mode).

### Public APIs / Interfaces / Types
- No extension message contract changes in `/Users/vm/Developer/meo/src/extension.ts`.
- No new user commands.
- Dependency change:
  - Add `mermaid` to `/Users/vm/Developer/meo/package.json` dependencies.
  - Update `/Users/vm/Developer/meo/bun.lock`.
- Internal-only additions in `/Users/vm/Developer/meo/webview/src/liveDecorations.js`:
  - `MermaidDiagramWidget extends WidgetType`
  - Mermaid block detection/helpers for fenced code nodes
  - Render/cache helpers (module scope)

### Implementation Plan
1. Add Mermaid runtime dependency and keep bundling local.
- Update `/Users/vm/Developer/meo/package.json` with `mermaid` (current stable major).
- Regenerate lockfile.
- Keep runtime offline/CSP-safe (no CDN fetches).

2. Detect Mermaid fenced blocks from syntax tree, not regex-only.
- In `/Users/vm/Developer/meo/webview/src/liveDecorations.js`, when iterating `FencedCode`, inspect child `CodeInfo` text from the markdown syntax tree.
- Treat `mermaid` case-insensitively after trim.
- Keep existing behavior for all non-Mermaid code blocks.

3. Add Mermaid widget rendering path for Live mode.
- For Mermaid `FencedCode`, add a `Decoration.replace(...)` over the fenced range with a block widget.
- Do not add existing copy button widget for Mermaid blocks.
- Keep current code block line decorations for non-Mermaid blocks unchanged.

4. Build `MermaidDiagramWidget` with strict error fallback.
- Widget input:
  - `diagramText` (content between fences)
  - `rawBlockText` (full fenced text for fallback display)
- `toDOM()` behavior:
  - Create container + loading state.
  - Initialize Mermaid once (`startOnLoad: false`, `securityLevel: 'strict'`).
  - Validate/render via Mermaid API (`parse` then `render`).
  - On success: inject SVG result into container.
  - On failure: render `<pre><code>` fallback plus `.meo-mermaid-error-badge` with sanitized error text.
- `eq()` should compare `diagramText` and `rawBlockText` to avoid unnecessary DOM churn.

5. Cache expensive Mermaid renders.
- Add module-scope memoization map keyed by normalized `diagramText`.
- Cache successful SVG output and failed parse/render result per content.
- Reuse cached result across decoration rebuilds to reduce repeated async rendering.

6. Styling updates.
- In `/Users/vm/Developer/meo/webview/src/styles.css`, add classes:
  - `.meo-mermaid-block` container style aligned with existing code-block visual language.
  - `.meo-mermaid-block svg` responsive sizing (`width: 100%`, auto height).
  - `.meo-mermaid-fallback` and `.meo-mermaid-error-badge`.
- Preserve existing typography/token usage and no global theme disruptions.

7. Docs update.
- Update `/Users/vm/Developer/meo/README.md` feature list to mention Mermaid rendering in Live mode and Source-mode editing workflow.

8. Build artifacts.
- Run project build so packaged files match source:
  - `bun run build:webview`
  - `bun run build:extension`
- Ensure `/Users/vm/Developer/meo/webview/dist/*` and `/Users/vm/Developer/meo/dist/*` reflect changes if tracked.

### Test Cases / Scenarios
1. Valid Mermaid in Live mode.
- Input:
  - fenced `mermaid` block with simple flowchart
- Expect:
  - rendered SVG appears in Live mode
  - raw fences not visible there
  - no console errors

2. Source mode behavior.
- Same file as above.
- Expect:
  - raw fenced markdown remains visible/editable
  - no rendered SVG replacement in Source mode

3. Invalid Mermaid fallback.
- Broken Mermaid syntax.
- Expect:
  - code fallback shown
  - visible error badge text
  - editor remains usable, no crash

4. Non-Mermaid fenced blocks unchanged.
- ` ```js ` and plain fences.
- Expect:
  - existing highlighting and copy button behavior unchanged

5. Case-insensitive language id.
- ` ```Mermaid ` and ` ```MERMAID `.
- Expect:
  - diagram still renders

6. Multiple Mermaid blocks in one document.
- Expect:
  - each renders independently
  - no ID collisions in generated SVG

7. Frequent cursor movement / selection changes in Live mode.
- Expect:
  - no flicker/regression from decoration recomputation
  - caching limits repeated heavy render work

8. Sync safety check.
- Edit in Source mode, switch to Live mode repeatedly.
- Expect:
  - document text synchronization/version handling remains intact.

### Assumptions and Defaults
- Mermaid support is intentionally **Live mode only**.
- In Live mode, rendered Mermaid blocks remain rendered even when focused; editing is done by switching to Source mode.
- Mermaid is bundled from npm (no CDN/network dependency).
- Invalid Mermaid uses fallback code + error badge (non-blocking).
- No changes to extension-webview message schema are required.
