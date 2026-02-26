interface OutlineHeading {
  text: string;
  level: number;
  from: number;
  line: number;
}

interface EditorApi {
  getHeadings(): OutlineHeading[];
  scrollToLine(line: number, position: string): void;
  moveHeadingSection(sourceFrom: number, targetFrom: number, placement: 'before' | 'after'): boolean;
}

interface OutlineControllerOptions {
  root: HTMLElement;
  editorWrapper: HTMLElement;
  outlineButton: HTMLElement;
  getEditor: () => EditorApi | null;
}

interface OutlineDragState {
  sourceFrom: number;
  sourceIndex: number;
  draggedElement: Element;
  dropTargetFrom: number | null;
  dropPlacement: 'before' | 'after' | null;
}

interface DropCandidate {
  targetFrom: number;
  placement: 'before' | 'after';
  targetItem: Element;
}

interface OutlineController {
  sidebar: HTMLElement;
  toggle: () => void;
  refresh: () => void;
  setPosition: (position: 'left' | 'right') => void;
  isVisible: () => boolean;
}

export function createOutlineController({ root, editorWrapper, outlineButton, getEditor }: OutlineControllerOptions): OutlineController {
  const outlineSidebar = document.createElement('div');
  outlineSidebar.className = 'outline-sidebar';
  outlineSidebar.setAttribute('role', 'navigation');
  outlineSidebar.setAttribute('aria-label', 'Document outline');

  const outlineContent = document.createElement('div');
  outlineContent.className = 'outline-content';
  outlineSidebar.appendChild(outlineContent);

  let visible = false;
  let currentOutlineHeadings: OutlineHeading[] = [];
  let currentOutlineHeadingIndexByFrom = new Map<number, number>();
  let outlineDragState: OutlineDragState | null = null;
  let suppressNextOutlineClick = false;

  const clearOutlineDropIndicators = () => {
    const indicators = outlineContent.querySelectorAll('.outline-drop-before, .outline-drop-after');
    for (const indicator of indicators) {
      indicator.classList.remove('outline-drop-before', 'outline-drop-after');
    }
  };

  const clearOutlineDragState = () => {
    clearOutlineDropIndicators();
    outlineContent.classList.remove('is-dragging-outline');

    if (outlineDragState?.draggedElement instanceof Element) {
      outlineDragState.draggedElement.classList.remove('is-dragging');
      outlineDragState.draggedElement.removeAttribute('aria-grabbed');
    }

    outlineDragState = null;
  };

  const buildOutlineSubtreeEndIndexes = (headings: OutlineHeading[]): number[] => {
    const subtreeEnds = new Array(headings.length);
    for (let index = 0; index < headings.length; index += 1) {
      let endIndex = headings.length - 1;
      for (let next = index + 1; next < headings.length; next += 1) {
        if (headings[next].level <= headings[index].level) {
          endIndex = next - 1;
          break;
        }
      }
      subtreeEnds[index] = endIndex;
    }
    return subtreeEnds;
  };

  const getOutlineDropCandidate = (targetItem: Element, clientY: number): DropCandidate | null => {
    if (!outlineDragState || !targetItem) {
      return null;
    }

    const targetFrom = Number.parseInt((targetItem as HTMLElement).dataset.headingFrom ?? '', 10);
    if (!Number.isFinite(targetFrom)) {
      return null;
    }

    const sourceIndex = currentOutlineHeadingIndexByFrom.get(outlineDragState.sourceFrom);
    const targetIndex = currentOutlineHeadingIndexByFrom.get(targetFrom);
    if (typeof sourceIndex !== 'number' || typeof targetIndex !== 'number') {
      return null;
    }

    const subtreeEnds = buildOutlineSubtreeEndIndexes(currentOutlineHeadings);
    const sourceSubtreeEndIndex = subtreeEnds[sourceIndex];
    const targetSubtreeEndIndex = subtreeEnds[targetIndex];
    if (typeof sourceSubtreeEndIndex !== 'number' || typeof targetSubtreeEndIndex !== 'number') {
      return null;
    }

    const rect = targetItem.getBoundingClientRect();
    const placement = clientY <= rect.top + rect.height / 2 ? 'before' : 'after';

    if (targetIndex >= sourceIndex && targetIndex <= sourceSubtreeEndIndex) {
      return null;
    }

    const insertionSlot = placement === 'before' ? targetIndex : targetSubtreeEndIndex + 1;
    const sourceBlockLength = sourceSubtreeEndIndex - sourceIndex + 1;
    const adjustedSlot = insertionSlot > sourceSubtreeEndIndex ? insertionSlot - sourceBlockLength : insertionSlot;
    if (adjustedSlot === sourceIndex) {
      return null;
    }

    return {
      targetFrom,
      placement,
      targetItem
    };
  };

  const applyOutlineDropIndicator = (candidate: DropCandidate | null) => {
    if (!outlineDragState) {
      clearOutlineDropIndicators();
      return;
    }

    if (!candidate) {
      clearOutlineDropIndicators();
      outlineDragState.dropTargetFrom = null;
      outlineDragState.dropPlacement = null;
      return;
    }

    if (
      outlineDragState.dropTargetFrom === candidate.targetFrom &&
      outlineDragState.dropPlacement === candidate.placement
    ) {
      return;
    }

    clearOutlineDropIndicators();
    candidate.targetItem.classList.add(
      candidate.placement === 'before' ? 'outline-drop-before' : 'outline-drop-after'
    );
    outlineDragState.dropTargetFrom = candidate.targetFrom;
    outlineDragState.dropPlacement = candidate.placement;
  };

  const updateOutlineUI = () => {
    outlineButton.classList.toggle('is-active', visible);
    root.classList.toggle('outline-visible', visible);
  };

  const refresh = () => {
    if (outlineDragState) {
      clearOutlineDragState();
    }

    const editor = getEditor();
    if (!editor) {
      currentOutlineHeadings = [];
      currentOutlineHeadingIndexByFrom = new Map();
      outlineContent.innerHTML = '';
      return;
    }

    const headings = editor.getHeadings();
    currentOutlineHeadings = headings;
    currentOutlineHeadingIndexByFrom = new Map(headings.map((heading, index) => [heading.from, index]));
    outlineContent.innerHTML = '';

    if (headings.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'outline-empty';
      emptyMsg.textContent = 'No headings';
      outlineContent.appendChild(emptyMsg);
      return;
    }

    for (const heading of headings) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `outline-item outline-level-${heading.level}`;
      item.textContent = heading.text;
      item.draggable = true;
      item.dataset.headingFrom = String(heading.from);
      item.dataset.headingLine = String(heading.line);
      outlineContent.appendChild(item);
    }
  };

  const toggle = () => {
    visible = !visible;
    updateOutlineUI();
    if (visible) {
      refresh();
    }
  };

  const setPosition = (position: 'left' | 'right') => {
    editorWrapper.dataset.outlinePosition = position === 'left' ? 'left' : 'right';
  };

  outlineContent.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const item = target?.closest('.outline-item');
    if (!(item instanceof Element) || !outlineContent.contains(item)) {
      return;
    }

    if (suppressNextOutlineClick) {
      suppressNextOutlineClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const headingFrom = Number.parseInt((item as HTMLElement).dataset.headingFrom ?? '', 10);
    const headingIndex = currentOutlineHeadingIndexByFrom.get(headingFrom);
    if (typeof headingIndex !== 'number') {
      return;
    }

    const heading = currentOutlineHeadings[headingIndex];
    const editor = getEditor();
    if (heading && editor) {
      editor.scrollToLine(heading.line, 'top');
    }
  });

  outlineContent.addEventListener('dragstart', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const item = target?.closest('.outline-item');
    if (!(item instanceof Element) || !outlineContent.contains(item)) {
      return;
    }

    const sourceFrom = Number.parseInt((item as HTMLElement).dataset.headingFrom ?? '', 10);
    const sourceIndex = currentOutlineHeadingIndexByFrom.get(sourceFrom);
    const editor = getEditor();
    if (!editor || typeof sourceIndex !== 'number') {
      event.preventDefault();
      return;
    }

    clearOutlineDragState();
    outlineDragState = {
      sourceFrom,
      sourceIndex,
      draggedElement: item,
      dropTargetFrom: null,
      dropPlacement: null
    };

    outlineContent.classList.add('is-dragging-outline');
    item.classList.add('is-dragging');
    item.setAttribute('aria-grabbed', 'true');

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.dropEffect = 'move';
      event.dataTransfer.setData('text/plain', String(sourceFrom));
    }
  });

  outlineContent.addEventListener('dragover', (event) => {
    if (!outlineDragState) {
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    const item = target?.closest('.outline-item');
    if (!(item instanceof Element) || !outlineContent.contains(item)) {
      applyOutlineDropIndicator(null);
      return;
    }

    const candidate = getOutlineDropCandidate(item, event.clientY);
    if (!candidate) {
      applyOutlineDropIndicator(null);
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    applyOutlineDropIndicator(candidate);
  });

  outlineContent.addEventListener('drop', (event) => {
    if (!outlineDragState) {
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    const item = target?.closest('.outline-item');
    const candidate = item instanceof Element && outlineContent.contains(item)
      ? getOutlineDropCandidate(item, event.clientY)
      : null;

    event.preventDefault();
    event.stopPropagation();

    const sourceFrom = outlineDragState.sourceFrom;
    clearOutlineDragState();

    const editor = getEditor();
    if (!candidate || !editor) {
      return;
    }

    const moved = editor.moveHeadingSection(sourceFrom, candidate.targetFrom, candidate.placement);
    if (moved) {
      suppressNextOutlineClick = true;
    }
  });

  outlineContent.addEventListener('dragend', () => {
    if (!outlineDragState) {
      return;
    }
    clearOutlineDragState();
  });

  updateOutlineUI();

  return {
    sidebar: outlineSidebar,
    toggle,
    refresh,
    setPosition,
    isVisible() {
      return visible;
    }
  };
}
