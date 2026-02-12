# Fix: Live Mode Toggle - Active Line Source Display

## Problem Statement

When toggling to live mode, all lines in the markdown file currently display source syntax (showing markdown markers). The expected behavior is:
- **Active/focused line**: Show markdown markers and source syntax for editing
- **All other lines**: Show rendered formatting (bold, italic, headings) without visible markers

## Current Behavior Analysis

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Webview Architecture                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────────────────────────────────────────┐   │
│  │  editor.js (Mode Switching)                        │   │
│  │  - setMode() switches entire editor               │   │
│  │  - Live mode: liveModeExtensions()                  │   │
│  │  - Source mode: sourceMode()                       │   │
│  └────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│  ┌────────────────────────────────────────────────────┐   │
│  │  liveDecorations.js (Decoration Logic)            │   │
│  │  - buildDecorations() creates all decorations     │   │
│  │  - collectActiveLines() tracks cursor position     │   │
│  │  - Currently: hides markers on ALL lines in live  │   │
│  └────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│  ┌────────────────────────────────────────────────────┐   │
│  │  styles.css (Visual Styling)                      │   │
│  │  - .meo-md-marker { display: none; } globally     │   │
│  │  - Applied to entire editor in live mode          │   │
│  └────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Key Code Locations

1. **Mode Switching** ([`editor.js:164-170`](../webview/src/editor.js:164))
   - `setMode()` applies extensions globally to entire editor
   - Toggles CSS classes on editor DOM element

2. **Decoration Building** ([`liveDecorations.js:79-135`](../webview/src/liveDecorations.js:79))
   - `buildDecorations()` iterates through entire syntax tree
   - Currently hides markers on non-active lines AND fence lines
   - Applies decorations uniformly across all lines

3. **Active Line Tracking** ([`liveDecorations.js:35-43`](../webview/src/liveDecorations.js:35))
   - `collectActiveLines()` already identifies cursor position
   - Returns Set of line numbers that should show markers
   - Currently used only to NOT hide markers (inverted logic)

4. **CSS Hiding** ([`styles.css:142-144`](../webview/src/styles.css:142))
   - `.cm-editor.meo-mode-live .meo-md-marker { display: none; }`
   - Hides ALL markers globally when in live mode

## Solution Design

### Proposed Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Hybrid Live/Source Mode                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────────────────────────────────────────┐   │
│  │  Editor State: Live Mode (Always)                  │   │
│  │  - Always use liveModeExtensions()                 │   │
│  │  - Track active line position                      │   │
│  └────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│  ┌────────────────────────────────────────────────────┐   │
│  │  Decoration Logic (Per-Line)                       │   │
│  │  - Active line: Show markers + source highlighting │   │
│  │  - Other lines: Hide markers + show decorations    │   │
│  └────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│  ┌────────────────────────────────────────────────────┐   │
│  │  CSS Styling (Conditional)                         │   │
│  │  - Active line: .meo-active-line-marker { visible }│   │
│  │  - Other lines: .meo-md-marker { hidden }          │   │
│  └────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Implementation Strategy

#### Phase 1: Modify Decoration Logic

**File**: [`webview/src/liveDecorations.js`](../webview/src/liveDecorations.js)

**Changes needed**:

1. **Invert the marker visibility logic** (lines 120-130)
   - Current: Hide markers on non-active lines
   - New: Show markers ONLY on active lines
   - Remove the fence line exception (or keep it as-is for code blocks)

2. **Add active line marker decoration**
   - Create a new decoration class for active line markers
   - Apply this decoration only to markers on active lines
   - Ensure markers on non-active lines remain hidden

3. **Update `buildDecorations()` function**
   ```javascript
   // Current logic (lines 120-130):
   if (!node.name.endsWith('Mark')) {
     return;
   }
   const line = state.doc.lineAt(node.from);
   if (activeLines.has(line.number) || fenceLines.has(line.number)) {
     return; // Don't hide markers on active/fence lines
   }
   addRange(ranges, node.from, node.to, markerDeco);

   // New logic:
   if (!node.name.endsWith('Mark')) {
     return;
   }
   const line = state.doc.lineAt(node.from);
   if (activeLines.has(line.number)) {
     // Active line: show markers with source styling
     addRange(ranges, node.from, node.to, activeLineMarkerDeco);
   } else if (!fenceLines.has(line.number)) {
     // Non-active, non-fence line: hide markers
     addRange(ranges, node.from, node.to, markerDeco);
   }
   // Fence lines: show markers (keep existing behavior)
   ```

4. **Add new decoration constant**
   ```javascript
   const activeLineMarkerDeco = Decoration.mark({ class: 'meo-md-marker-active' });
   ```

#### Phase 2: Update CSS Styling

**File**: [`webview/src/styles.css`](../webview/src/styles.css)

**Changes needed**:

1. **Keep existing marker hiding** (lines 142-144)
   ```css
   .cm-editor.meo-mode-live .meo-md-marker {
     display: none;
   }
   ```

2. **Add active line marker visibility** (new rule)
   ```css
   .cm-editor.meo-mode-live .meo-md-marker-active {
     display: inline;
     color: var(--vscode-editor-foreground);
   }
   ```

3. **Optional: Add subtle visual distinction for active line**
   ```css
   .cm-editor.meo-mode-live .cm-line.cm-activeLine .meo-md-marker-active {
     background-color: var(--meo-active-line-bg);
   }
   ```

#### Phase 3: Verify Mode Switching

**File**: [`webview/src/editor.js`](../webview/src/editor.js)

**No changes needed** - The existing `setMode()` function already:
- Applies live mode extensions correctly
- Toggles CSS classes on the editor DOM
- Works with the new per-line decoration logic

### Edge Cases to Handle

1. **Multi-line selections**
   - All lines in selection should show markers
   - `collectActiveLines()` already handles this via `state.selection.ranges`

2. **Code blocks (fenced code)**
   - Keep existing behavior: always show markers in code blocks
   - `collectFenceLines()` already identifies these

3. **Cursor movement**
   - Decorations recompute on every transaction (line 144)
   - Active line updates automatically

4. **Empty lines**
   - No markers to show/hide, should work as-is

5. **Mode switching (live ↔ source)**
   - Source mode: show all markers (existing behavior)
   - Live mode: show markers only on active line (new behavior)

### Testing Strategy

1. **Basic functionality**
   - Toggle to live mode
   - Navigate through document
   - Verify only active line shows markers

2. **Multi-line selection**
   - Select multiple lines
   - Verify all selected lines show markers

3. **Code blocks**
   - Navigate into fenced code block
   - Verify markers remain visible (existing behavior)

4. **Mode switching**
   - Switch between live and source modes
   - Verify correct marker visibility in each mode

5. **Edge cases**
   - Empty document
   - Single line document
   - Document with only code blocks

## Implementation Steps

1. **Modify [`liveDecorations.js`](../webview/src/liveDecorations.js)**
   - Add `activeLineMarkerDeco` constant
   - Update `buildDecorations()` to show markers only on active lines
   - Invert the marker visibility logic

2. **Update [`styles.css`](../webview/src/styles.css)**
   - Add CSS rule for active line marker visibility
   - Ensure proper styling for active line markers

3. **Build and test**
   - Run `bun run build:webview`
   - Test extension in VS Code (F5)
   - Verify all test scenarios

4. **Manual validation**
   - Test with various markdown documents
   - Verify cursor movement updates correctly
   - Check multi-line selections

## Files to Modify

1. [`webview/src/liveDecorations.js`](../webview/src/liveDecorations.js)
   - Add new decoration constant
   - Update `buildDecorations()` logic
   - Invert marker visibility behavior

2. [`webview/src/styles.css`](../webview/src/styles.css)
   - Add CSS for active line marker visibility
   - Ensure proper styling

## Files NOT to Modify

- [`webview/src/editor.js`](../webview/src/editor.js) - No changes needed
- [`webview/src/index.js`](../webview/src/index.js) - No changes needed
- [`src/extension.ts`](../src/extension.ts) - No changes needed

## Success Criteria

- [ ] In live mode, only the active/focused line shows markdown markers
- [ ] All other lines show rendered formatting without visible markers
- [ ] Multi-line selections show markers on all selected lines
- [ ] Code blocks continue to show markers (existing behavior preserved)
- [ ] Source mode continues to show all markers (existing behavior preserved)
- [ ] Cursor movement updates marker visibility in real-time
- [ ] Mode switching (live ↔ source) works correctly
