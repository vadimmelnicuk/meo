# Remove Instant Rendering Feature

## Overview

This plan outlines the steps to completely remove the instant rendering (IR) feature from the markdown editor project. This will simplify the codebase and remove unused functionality.

## Files to Modify

### Files to Delete

1. [`webview/src/ir/instantRendering.ts`](../webview/src/ir/instantRendering.ts:1) - IR implementation (591 lines)
2. [`webview/src/ir/`](../webview/src/ir/) - IR directory

### Files to Modify

1. [`webview/src/App.vue`](../webview/src/App.vue:1) - Remove IR toggle button and related code
2. [`webview/src/main.ts`](../webview/src/main.ts:1) - Remove IR import and registration
3. [`webview/package.json`](../webview/package.json:1) - Remove CodeMirror dependencies if no longer needed
4. [`plans/instant-rendering-implementation.md`](../plans/instant-rendering-implementation.md:1) - Archive or delete
5. [`plans/webview-performance-optimizations.md`](../plans/webview-performance-optimizations.md:1) - Archive or delete

## Implementation Steps

### Step 1: Remove IR Toggle from App.vue

**File**: [`webview/src/App.vue`](../webview/src/App.vue:1)

Remove the IR toggle button from the template:

```vue
<!-- Remove this section from template -->
<template #defToolbars>
  <NormalToolbar :title="irTitle" @onClick="toggleInstantRendering">
    <svg
      class="md-editor-icon ir-icon"
      :class="{ 'is-off': !instantRenderingEnabled }"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        d="M4 5h16v3H4V5zm0 5h10v3H4v-3zm0 5h16v3H4v-3z"
        fill="currentColor"
      />
    </svg>
  </NormalToolbar>
</template>
```

Remove IR-related imports and variables:

```typescript
// Remove these imports
import { setInstantRendering } from './ir/instantRendering';
import { lineNumbers } from '@codemirror/gutter';

// Remove these variables
const instantRenderingEnabled = ref(false);

// Remove these computed properties
const irTitle = computed(() =>
  instantRenderingEnabled.value ? 'Instant Rendering: On' : 'Instant Rendering: Off'
);

// Remove these functions
const toggleInstantRendering = () => {
  instantRenderingEnabled.value = !instantRenderingEnabled.value;
  console.debug('[IR] Toggle clicked', { enabled: instantRenderingEnabled.value });
  applyInstantRendering();
};

const applyInstantRendering = async () => {
  // Remove entire function
};
```

Remove IR initialization from `onMounted`:

```typescript
onMounted(() => {
  // ... existing code ...
  
  // Remove this line
  // applyInstantRendering();
});
```

### Step 2: Remove IR from main.ts

**File**: [`webview/src/main.ts`](../webview/src/main.ts:1)

Remove IR import:

```typescript
// Remove this import
import { registerInstantRendering } from './ir/instantRendering';
```

Remove IR registration from config:

```typescript
config({
  // Remove this entire block
  // codeMirrorExtensions: (extensions, options) => {
  //   console.debug('[IR] Registering extension', { editorId: options.editorId });
  //   const next = [...extensions];
  //   next.push({
  //     type: 'instant-rendering',
  //     extension: registerInstantRendering()
  //   });
  //   console.debug('[IR] Extension registered', { totalExtensions: next.length });
  //   return next;
  // }
});
```

### Step 3: Update package.json

**File**: [`webview/package.json`](../webview/package.json:1)

Check if CodeMirror dependencies are still needed by md-editor-v3. If not, remove them:

```json
{
  "dependencies": {
    // Keep these if md-editor-v3 uses them
    // Remove if no longer needed:
    // "@codemirror/state": "...",
    // "@codemirror/view": "...",
    // "@codemirror/gutter": "..."
  }
}
```

**Note**: Do not remove these dependencies without verifying md-editor-v3 doesn't require them.

### Step 4: Delete IR Files

Delete the following files and directories:

```bash
# Delete IR implementation
rm webview/src/ir/instantRendering.ts

# Delete IR directory
rm -rf webview/src/ir/
```

### Step 5: Archive or Delete Plan Files

Option A: Archive plan files (recommended)

```bash
# Create archive directory
mkdir -p plans/archive

# Move plan files to archive
mv plans/instant-rendering-implementation.md plans/archive/
mv plans/webview-performance-optimizations.md plans/archive/
```

Option B: Delete plan files

```bash
rm plans/instant-rendering-implementation.md
rm plans/webview-performance-optimizations.md
```

### Step 6: Clean Up styles.css

**File**: [`webview/src/styles.css`](../webview/src/styles.css:1)

Remove any IR-specific CSS styles:

```css
/* Remove these styles if they exist */
.ir-checkbox { /* ... */ }
.ir-checked { /* ... */ }
.ir-hidden { /* ... */ }
.ir-heading { /* ... */ }
.ir-h1, .ir-h2, .ir-h3, .ir-h4, .ir-h5, .ir-h6 { /* ... */ }
.ir-blockquote { /* ... */ }
.ir-list-item { /* ... */ }
.ir-list-marker { /* ... */ }
.ir-task-item { /* ... */ }
.ir-link { /* ... */ }
.ir-link-marker { /* ... */ }
.ir-link-url { /* ... */ }
.ir-image { /* ... */ }
.ir-image-marker { /* ... */ }
.ir-image-alt { /* ... */ }
.ir-image-url { /* ... */ }
.ir-bold { /* ... */ }
.ir-italic { /* ... */ }
.ir-strike { /* ... */ }
.ir-code { /* ... */ }
.ir-code-fence { /* ... */ }
.ir-code-fence-marker { /* ... */ }
.ir-table-row { /* ... */ }
.ir-table-cell { /* ... */ }
.ir-table-header { /* ... */ }
.ir-table-separator { /* ... */ }
```

## Verification Steps

After removing IR, verify:

1. Build succeeds: `bun run build`
2. Extension loads without errors
3. Markdown editor opens normally
4. Preview pane works
5. Save functionality works
6. No console errors related to IR

## Expected Impact

### Benefits

- Simpler codebase
- Reduced bundle size
- Faster build times
- Less maintenance burden
- Cleaner UI (no IR toggle button)

### Trade-offs

- No instant rendering mode
- Users must use standard markdown syntax
- Cannot hide markdown syntax while editing

## Rollback Plan

If you need to restore IR:

1. Restore files from git history
2. Revert changes to [`webview/src/App.vue`](../webview/src/App.vue:1)
3. Revert changes to [`webview/src/main.ts`](../webview/src/main.ts:1)
4. Restore [`webview/src/ir/instantRendering.ts`](../webview/src/ir/instantRendering.ts:1)
5. Restore plan files from archive

## Next Steps

1. Review the plan
2. Confirm you want to proceed
3. Execute removal steps
4. Test the extension
5. Commit changes
