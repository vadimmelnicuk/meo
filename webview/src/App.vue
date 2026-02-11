<template>
  <div class="app">
    <main class="editor-shell">
      <div class="editor-layout">
        <section class="editor-pane">
          <Suspense>
            <template #default>
              <MdEditor
                v-model="content"
                ref="mdEditorRef"
                :editorId="editorId"
                :theme="theme"
                :toolbars="toolbars"
                :floatingToolbars="floatingToolbars"
                :preview="viewSettings.preview"
                previewTheme="github"
                :showCodeRowNumber="true"
                codeTheme="github"
                :codeFoldable="false"
                language="en-US"
                :footers="footers"
                :pageFullscreen="viewSettings.pageFullscreen"
                :htmlPreview="viewSettings.htmlPreview"
                style="height: 100%;"
                @change="handleChange"
                @onSave="handleSave"
                @onUploadImg="handleUploadImg"
              >
                <template #defToolbars>
                  <NormalToolbar :title="autosaveTitle" @onClick="toggleAutosave">
                    <svg
                      class="md-editor-icon autosave-icon"
                      :class="{ 'is-off': !autosaveEnabled }"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        d="M7 3h10l2 2v16H5V3h2zm0 2v14h10V6H7zm2 2h6v4H9V7zm0 8h6v2H9v-2z"
                        fill="currentColor"
                      />
                    </svg>
                  </NormalToolbar>
                </template>
              </MdEditor>
            </template>
            <template #fallback>
              <div class="editor-loading">Loading editor...</div>
            </template>
          </Suspense>
        </section>
        <aside class="catalog-pane" v-show="viewSettings.catalog">
          <div class="catalog-header">Catalog</div>
          <MdCatalog :editorId="editorId" :theme="theme" />
        </aside>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  onMounted,
  onBeforeUnmount,
  ref,
  defineAsyncComponent,
  reactive,
  watch
} from 'vue';
import { MdCatalog, NormalToolbar, allFooter, allToolbar, type ToolbarNames } from 'md-editor-v3';
import type { ExposeParam } from 'md-editor-v3';
import { getVsCodeApi } from './vscode';

// Lazy load the heavy MdEditor component to reduce initial bundle size
const MdEditor = defineAsyncComponent(() => import('md-editor-v3').then(m => m.MdEditor));

const vscode = getVsCodeApi();
const content = ref('');
const statusText = ref('Ready');
const isSyncing = ref(false);
const theme = ref<'light' | 'dark'>('light');
const lastSentText = ref<string | null>(null);
const isFocused = ref(false);
const suppressNextChange = ref(false);
const fileName = ref<string | null>(null);
const autosaveEnabled = ref(true);
const editorId = 'md-editor-v3-demo';
const mdEditorRef = ref<ExposeParam | null>(null);
type ViewSettings = {
  preview: boolean;
  htmlPreview: boolean;
  previewOnly: boolean;
  pageFullscreen: boolean;
  fullscreen: boolean;
  catalog: boolean;
};

const defaultViewSettings: ViewSettings = {
  preview: true,
  htmlPreview: false,
  previewOnly: false,
  pageFullscreen: true,
  fullscreen: false,
  catalog: true
};

const viewSettings = reactive<ViewSettings>({ ...defaultViewSettings });
let suppressViewSettingsSync = false;
let editorEventsBound = false;
let themeObserver: MutationObserver | null = null;
let autosaveTimer: ReturnType<typeof setInterval> | undefined;

const updateTheme = () => {
  theme.value = document.body.classList.contains('vscode-dark') ? 'dark' : 'light';
};

const toolbars = computed<ToolbarNames[]>(() => {
  const base = [...allToolbar] as ToolbarNames[];
  const saveIndex = base.indexOf('save');
  if (saveIndex !== -1) {
    base.splice(saveIndex + 1, 0, 0 as ToolbarNames, 1 as ToolbarNames);
  } else {
    base.push(0 as ToolbarNames, 1 as ToolbarNames);
  }
  return base as ToolbarNames[];
});

const floatingToolbars: ToolbarNames[] = [
  'bold',
  'italic',
  'underline',
  'strikeThrough',
  'sub',
  'sup',
];
const footers = allFooter;

const snapshotViewSettings = (): ViewSettings => ({
  preview: viewSettings.preview,
  htmlPreview: viewSettings.htmlPreview,
  previewOnly: viewSettings.previewOnly,
  pageFullscreen: viewSettings.pageFullscreen,
  fullscreen: viewSettings.fullscreen,
  catalog: viewSettings.catalog
});

const persistViewSettings = (settings: ViewSettings) => {
  const currentState = vscode.getState();
  if (currentState && typeof currentState === 'object') {
    vscode.setState({ ...currentState, viewSettings: settings });
  } else {
    vscode.setState({ viewSettings: settings });
  }
};

const broadcastViewSettings = () => {
  if (suppressViewSettingsSync) {
    return;
  }
  const settings = snapshotViewSettings();
  persistViewSettings(settings);
  vscode.postMessage({ type: 'viewSettingsChanged', settings });
};

const updateViewSetting = (key: keyof ViewSettings, value: boolean) => {
  if (viewSettings[key] === value) {
    return;
  }
  viewSettings[key] = value;
  broadcastViewSettings();
};

const normalizeViewSettings = (incoming: Partial<ViewSettings> | null | undefined): ViewSettings => {
  const current = snapshotViewSettings();
  return {
    preview: typeof incoming?.preview === 'boolean' ? incoming.preview : current.preview,
    htmlPreview:
      typeof incoming?.htmlPreview === 'boolean' ? incoming.htmlPreview : current.htmlPreview,
    previewOnly:
      typeof incoming?.previewOnly === 'boolean' ? incoming.previewOnly : current.previewOnly,
    pageFullscreen:
      typeof incoming?.pageFullscreen === 'boolean'
        ? incoming.pageFullscreen
        : current.pageFullscreen,
    fullscreen:
      typeof incoming?.fullscreen === 'boolean' ? incoming.fullscreen : current.fullscreen,
    catalog: typeof incoming?.catalog === 'boolean' ? incoming.catalog : current.catalog
  };
};

const applyEditorViewSettings = () => {
  const editor = mdEditorRef.value;
  if (!editor) {
    return;
  }
  editor.togglePreview(viewSettings.preview);
  editor.toggleHtmlPreview(viewSettings.htmlPreview);
  editor.togglePreviewOnly(viewSettings.previewOnly);
  editor.togglePageFullscreen(viewSettings.pageFullscreen);
  editor.toggleFullscreen(viewSettings.fullscreen);
  editor.toggleCatalog(viewSettings.catalog);
};

const applyViewSettings = (incoming: Partial<ViewSettings> | null | undefined) => {
  if (!incoming || typeof incoming !== 'object') {
    return;
  }
  suppressViewSettingsSync = true;
  const next = normalizeViewSettings(incoming);
  viewSettings.preview = next.preview;
  viewSettings.htmlPreview = next.htmlPreview;
  viewSettings.previewOnly = next.previewOnly;
  viewSettings.pageFullscreen = next.pageFullscreen;
  viewSettings.fullscreen = next.fullscreen;
  viewSettings.catalog = next.catalog;
  applyEditorViewSettings();
  persistViewSettings(snapshotViewSettings());
  window.setTimeout(() => {
    suppressViewSettingsSync = false;
  }, 0);
};

let debounceTimer: ReturnType<typeof setTimeout> | undefined;

const handleChange = (value: string) => {
  if (suppressNextChange.value) {
    suppressNextChange.value = false;
    content.value = value;
    return;
  }
  content.value = value;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  statusText.value = 'Syncing…';
  isSyncing.value = true;
  debounceTimer = setTimeout(() => {
    lastSentText.value = content.value;
    vscode.postMessage({ type: 'edit', text: content.value });
    statusText.value = 'All changes synced';
    isSyncing.value = false;
  }, 250);
};

const handleMessage = (event: MessageEvent) => {
  const message = event.data;
  if (!message || typeof message !== 'object') {
    return;
  }

  if (message.type === 'documentUpdate') {
    if (typeof message.text === 'string') {
      if (lastSentText.value && message.text === lastSentText.value) {
        lastSentText.value = null;
      } else if (!isFocused.value && message.text !== content.value) {
        suppressNextChange.value = true;
        content.value = message.text;
      }
    }
    if (typeof message.fileName === 'string') {
      fileName.value = message.fileName;
    }
    statusText.value = 'Ready';
    isSyncing.value = false;
  }

  if (message.type === 'saved') {
    statusText.value = 'Saved to disk';
    isSyncing.value = false;
  }

  if (message.type === 'viewSettings') {
    applyViewSettings(message.settings as Partial<ViewSettings>);
  }
};

const handleSave = () => {
  vscode.postMessage({ type: 'autosave' });
};

const handleUploadImg = async (
  files: File[],
  callback: (urls: string[]) => void
) => {
  const urls = await Promise.all(
    files.map(
      file =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('Image load failed'));
          reader.readAsDataURL(file);
        })
    )
  );
  callback(urls);
};

const toggleAutosave = () => {
  autosaveEnabled.value = !autosaveEnabled.value;
};

const autosaveTitle = computed(() =>
  autosaveEnabled.value ? 'Autosave: On' : 'Autosave: Off'
);

onMounted(() => {
  window.addEventListener('message', handleMessage);
  window.addEventListener('focusin', () => {
    isFocused.value = true;
  });
  window.addEventListener('focusout', () => {
    isFocused.value = false;
  });
  const persisted = vscode.getState();
  if (persisted && typeof persisted === 'object' && 'viewSettings' in persisted) {
    applyViewSettings((persisted as { viewSettings?: Partial<ViewSettings> }).viewSettings);
  }
  updateTheme();
  themeObserver = new MutationObserver(updateTheme);
  themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  autosaveTimer = setInterval(() => {
    if (!autosaveEnabled.value) {
      return;
    }
    if (!isFocused.value) {
      return;
    }
    if (fileName.value && fileName.value.toLowerCase().endsWith('.md')) {
      vscode.postMessage({ type: 'autosave' });
    }
  }, 50);
  vscode.postMessage({ type: 'ready' });
});

onBeforeUnmount(() => {
  window.removeEventListener('message', handleMessage);
  if (themeObserver) {
    themeObserver.disconnect();
    themeObserver = null;
  }
  if (autosaveTimer) {
    clearInterval(autosaveTimer);
    autosaveTimer = undefined;
  }
});

watch(
  mdEditorRef,
  editor => {
    if (!editor || editorEventsBound) {
      return;
    }
    editorEventsBound = true;
    editor.on('preview', status => updateViewSetting('preview', status));
    editor.on('htmlPreview', status => updateViewSetting('htmlPreview', status));
    editor.on('previewOnly', status => updateViewSetting('previewOnly', status));
    editor.on('pageFullscreen', status => updateViewSetting('pageFullscreen', status));
    editor.on('fullscreen', status => updateViewSetting('fullscreen', status));
    editor.on('catalog', status => updateViewSetting('catalog', status));
    applyEditorViewSettings();

    // Hide floating toolbar on empty lines (when no text is selected)
    const hideFloatingToolbarOnEmptyLines = () => {
      const floatingToolbar = document.querySelector('.md-editor-floating-toolbar-container') as HTMLElement;
      if (!floatingToolbar) return;

      // Check if there's an actual text selection
      const selection = window.getSelection();
      const hasSelection = selection && !selection.isCollapsed && selection.toString().trim().length > 0;

      // Hide floating toolbar if there's no selection (just a cursor or empty line)
      if (!hasSelection) {
        floatingToolbar.style.display = 'none';
      }
    };

    // Monitor selection changes to hide floating toolbar when there's no selection
    document.addEventListener('selectionchange', hideFloatingToolbarOnEmptyLines);

    // Also monitor cursor activity
    const editorElement = document.querySelector('.md-editor .cm-editor');
    if (editorElement) {
      editorElement.addEventListener('click', hideFloatingToolbarOnEmptyLines);
      editorElement.addEventListener('keyup', hideFloatingToolbarOnEmptyLines);
    }
  },
  { immediate: true }
);
</script>
