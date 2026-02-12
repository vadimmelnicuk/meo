# Codebase Refactoring Plan - Remove Bloat & Slop

## Overview
Comprehensive cleanup of the MEO (Markdown Editor Optimized) codebase to remove unnecessary bloat, debug code, unused features, and inconsistencies.

## Identified Issues

### 1. Debug Logging (High Priority)
- **File**: [`webview/src/liveDecorations.js`](../webview/src/liveDecorations.js)
- **Issue**: Extensive console.log statements (lines 80-170) used for debugging
- **Impact**: Performance overhead in production, unnecessary console spam
- **Action**: Remove all console.log statements from production code

### 2. Unused Message Types (High Priority)
- **File**: [`src/extension.ts`](../src/extension.ts)
- **Issue**: Three message types defined but never used:
  - `ClipboardTextMessage` (lines 24-28)
  - `WriteClipboardMessage` (lines 50-53)
  - `ReadClipboardMessage` (lines 55-58)
- **Impact**: Dead code, unnecessary type definitions
- **Action**: Remove unused message type definitions and related handlers

### 3. Unused Clipboard Functionality (High Priority)
- **File**: [`webview/src/index.js`](../webview/src/index.js)
- **Issue**: Clipboard-related code that's never called:
  - `writeClipboardText()` function (lines 145-147)
  - `readClipboardText()` function (lines 149-155)
  - `clipboardRequestId` variable (line 55)
  - `clipboardReads` Map (line 56)
  - Clipboard message handlers (lines 177-183, 300-307)
- **Impact**: Dead code, unnecessary complexity
- **Action**: Remove all clipboard-related code

### 4. Unused CodeMirror Imports (Medium Priority)
- **File**: [`webview/src/editor.js`](../webview/src/editor.js)
- **Issue**: Import statements for features that may not be used:
  - `undo`, `redo` from `@codemirror/commands` (line 3)
  - These are only used in wrapper methods, could be simplified
- **Impact**: Slightly larger bundle size
- **Action**: Evaluate and remove if truly unused

### 5. Duplicate CSS Variable (Medium Priority)
- **File**: [`webview/src/styles.css`](../webview/src/styles.css)
- **Issue**: `--meo-active-line-bg` defined twice (lines 4-5)
  ```css
  --meo-active-line-bg: var(--vscode-editor-selectionBackground);
  --meo-active-line-bg: color-mix(in srgb, var(--vscode-editor-selectionBackground) 90%, #000);
  ```
- **Impact**: First definition is overridden, dead code
- **Action**: Remove the first definition (line 4)

### 6. README.md Inconsistency (Medium Priority)
- **File**: [`README.md`](../README.md)
- **Issue**: Describes Vue 3, Vite, and md-editor-v3 (line 3)
- **Actual**: Uses CodeMirror 6
- **Impact**: Misleading documentation
- **Action**: Update to reflect actual tech stack

### 7. Unused Helper Functions (Low Priority)
- **File**: [`webview/src/index.js`](../webview/src/index.js)
- **Issue**: Some helper functions may be over-engineered or unused
  - `isPrimaryModifier()` (lines 157-162) - only used in one place
- **Action**: Simplify inline if only used once

### 8. Unused Plugin (Low Priority)
- **File**: [`webview/src/liveDecorations.js`](../webview/src/liveDecorations.js)
- **Issue**: `liveDecorationPlugin` (lines 175-177) is empty and does nothing
- **Impact**: Dead code
- **Action**: Remove the unused plugin

### 9. Unused Helper Functions in liveDecorations.js (Low Priority)
- **File**: [`webview/src/liveDecorations.js`](../webview/src/liveDecorations.js)
- **Issue**: Helper functions only used for debug logging:
  - `isEmptyDecorationSet()` (lines 183-186)
  - `countDecorations()` (lines 188-196)
- **Impact**: Dead code after console.log removal
- **Action**: Remove these functions

### 10. Potential Unused CSS (Low Priority)
- **File**: [`webview/src/styles.css`](../webview/src/styles.css)
- **Issue**: Some CSS selectors may not be used in the current implementation
- **Action**: Audit and remove unused selectors

## Refactoring Strategy

### Phase 1: Remove Debug Code (High Impact, Low Risk)
1. Remove all console.log statements from [`liveDecorations.js`](../webview/src/liveDecorations.js)
2. Remove debug helper functions (`isEmptyDecorationSet`, `countDecorations`)
3. Remove empty `liveDecorationPlugin`

### Phase 2: Remove Unused Features (High Impact, Low Risk)
4. Remove unused message types from [`extension.ts`](../src/extension.ts)
5. Remove clipboard-related code from [`index.js`](../webview/src/index.js)
6. Simplify message handling in [`extension.ts`](../src/extension.ts)

### Phase 3: Clean Up Imports & CSS (Medium Impact, Low Risk)
7. Remove duplicate CSS variable in [`styles.css`](../webview/src/styles.css)
8. Audit and remove unused CodeMirror imports from [`editor.js`](../webview/src/editor.js)
9. Audit and remove unused CSS selectors

### Phase 4: Update Documentation (Low Impact, Low Risk)
10. Update [`README.md`](../README.md) to reflect actual tech stack
11. Update description in [`package.json`](../package.json) if needed

### Phase 5: Verification (Critical)
12. Build the project to ensure no errors
13. Test extension functionality manually

## Expected Outcomes

### Code Quality Improvements
- **Reduced bundle size**: Removal of dead code will decrease final bundle size
- **Better performance**: No debug logging overhead in production
- **Cleaner codebase**: Easier to understand and maintain
- **Accurate documentation**: README reflects actual implementation

### Metrics
- Lines of code reduction: ~50-100 lines
- Console.log statements removed: ~15 statements
- Unused functions removed: ~5 functions
- Unused message types removed: 3 types

## Risk Assessment

| Change | Risk Level | Mitigation |
|--------|-----------|------------|
| Remove console.log | Low | Purely cosmetic, no functional change |
| Remove unused message types | Low | Not referenced anywhere in codebase |
| Remove clipboard code | Low | Feature never implemented/used |
| Remove duplicate CSS | Low | Redundant definition |
| Update README | Low | Documentation only |
| Remove unused imports | Medium | Need to verify actual usage |
| Remove unused CSS | Medium | Need to verify selectors are unused |

## Testing Checklist

After refactoring, verify:
- [ ] Extension builds successfully (`bun run build`)
- [ ] Custom editor opens for .md files
- [ ] Live mode works correctly
- [ ] Source mode works correctly
- [ ] Mode toggle functions
- [ ] Text editing and sync work
- [ ] Undo/redo functionality preserved
- [ ] No console errors in browser DevTools
- [ ] No console errors in VS Code extension host

## Dependencies

This refactoring does not require any external dependencies or changes to the build process.

## Rollback Plan

If issues arise after refactoring:
1. Use git to revert changes: `git checkout -- .`
2. Rebuild: `bun run build`
3. Test functionality

## Notes

- The clipboard functionality appears to be partially implemented but never connected to actual user interactions
- The debug logging suggests active development was in progress
- The README inconsistency suggests this may have been copied from another project template
