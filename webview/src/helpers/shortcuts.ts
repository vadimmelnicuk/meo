const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);

export const isPrimaryModifier = (event: KeyboardEvent): boolean => {
  return event.metaKey !== event.ctrlKey && (event.metaKey || event.ctrlKey);
};

export const isShortcutKey = (event: KeyboardEvent, key: string, code: string): boolean => {
  return event.key.toLowerCase() === key || event.code === code;
};

export const normalizeEol = (text: string): string => text.replace(/\r\n?/g, '\n');

export interface ShortcutHandlerContext {
  editor: any;
  currentMode: 'live' | 'source';
  vimModeEnabled: boolean;
  pendingText: string | null;
  syncedText: string;
  requestSave: () => void;
  openFindPanel: (target: 'find' | 'replace') => void;
  applyMode: (mode: 'live' | 'source', options?: { userTriggered?: boolean; reason?: string }) => boolean;
  flushPendingChangesNow: () => void;
}

export const handleEditorShortcut = (
  event: KeyboardEvent,
  context: ShortcutHandlerContext
): boolean => {
  const { editor, currentMode, vimModeEnabled, pendingText, syncedText } = context;
  
  if (!editor || event.isComposing) {
    return false;
  }
  
  const hasPrimaryModifier = isPrimaryModifier(event);
  const editorFocused = editor.hasFocus();
  const vimSourceFocused = vimModeEnabled && currentMode === 'source' && editorFocused;
  const vimWinsCtrlConflicts = vimSourceFocused && !isMac;
  const isPlainAltShiftChord =
    event.altKey &&
    event.shiftKey &&
    !event.metaKey &&
    !event.ctrlKey;
  const isModeToggleShortcut = isPlainAltShiftChord && isShortcutKey(event, 'm', 'KeyM');

  if (isModeToggleShortcut) {
    event.preventDefault();
    event.stopPropagation();
    context.applyMode(currentMode === 'live' ? 'source' : 'live', { userTriggered: true, reason: 'shortcut' });
    return true;
  }

  if (
    vimSourceFocused &&
    (
      isPlainAltShiftChord ||
      (isMac && event.metaKey && !event.ctrlKey)
    )
  ) {
    event.stopPropagation();
    return false;
  }

  if (hasPrimaryModifier && isShortcutKey(event, 's', 'KeyS') && !event.altKey) {
    event.preventDefault();
    event.stopPropagation();
    context.requestSave();
    return true;
  }

  if (hasPrimaryModifier && isShortcutKey(event, 'f', 'KeyF') && !event.altKey) {
    if (vimWinsCtrlConflicts) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    context.openFindPanel('find');
    return true;
  }

  if (
    hasPrimaryModifier &&
    (
      (isMac && isShortcutKey(event, 'f', 'KeyF') && event.altKey) ||
      (!isMac && isShortcutKey(event, 'h', 'KeyH') && !event.altKey)
    )
  ) {
    if (vimWinsCtrlConflicts) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    context.openFindPanel('replace');
    return true;
  }

  if (!editorFocused) {
    return false;
  }

  if (!hasPrimaryModifier) {
    return false;
  }

  if (isShortcutKey(event, 'a', 'KeyA') && !event.altKey) {
    if (vimWinsCtrlConflicts) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    editor.selectAll();
    return true;
  }

  if (isShortcutKey(event, 'z', 'KeyZ') && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    event.stopPropagation();
    editor.undo();
    return true;
  }

  const redoByShiftZ = isShortcutKey(event, 'z', 'KeyZ') && event.shiftKey;
  const redoByY = isShortcutKey(event, 'y', 'KeyY');
  if ((redoByShiftZ || redoByY) && !event.altKey) {
    if (vimWinsCtrlConflicts && redoByY) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    editor.redo();
    return true;
  }

  const key = typeof event.key === 'string' ? event.key : '';
  const isBareModifier =
    key === 'Meta' ||
    key === 'Control' ||
    key === 'Shift' ||
    key === 'Alt';
  const isClipboardShortcut =
    !event.altKey &&
    (isShortcutKey(event, 'c', 'KeyC') ||
      isShortcutKey(event, 'x', 'KeyX') ||
      isShortcutKey(event, 'v', 'KeyV'));
  if (!isBareModifier && !isClipboardShortcut && pendingText !== null && normalizeEol(pendingText) !== syncedText) {
    context.flushPendingChangesNow();
  }

  return false;
};
