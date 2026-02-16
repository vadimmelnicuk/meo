import { StateField } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { resolveCodeLanguage } from './codeBlockHighlight';
import { highlightStyle, base02 } from './theme';
import mermaid from 'mermaid';

let mermaidInitialized = false;
const mermaidCache = new Map();
let mermaidIdCounter = 0;

function initMermaid() {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'dark'
  });
  mermaidInitialized = true;
}

class MermaidDiagramWidget extends WidgetType {
  constructor(diagramText) {
    super();
    this.diagramText = diagramText;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.isDragging = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    this.isFullscreen = false;
    this.fullscreenOverlay = null;
    this.svgContent = null;
    this.fullscreenBaseScale = 1;
  }

  eq(other) {
    return other.diagramText === this.diagramText;
  }

  toDOM() {
    initMermaid();
    const container = document.createElement('div');
    container.className = 'meo-mermaid-block';

    const cached = mermaidCache.get(this.diagramText);
    if (cached) {
      if (cached.error) {
        this.renderError(container, cached.error);
      } else {
        this.renderSvg(container, cached.svg);
      }
      return container;
    }

    const loading = document.createElement('div');
    loading.className = 'meo-mermaid-loading';
    loading.textContent = 'Rendering diagram...';
    container.appendChild(loading);

    const id = `mermaid-${++mermaidIdCounter}`;
    
    (async () => {
      try {
        const { svg } = await mermaid.render(id, this.diagramText);
        mermaidCache.set(this.diagramText, { svg });
        if (container.contains(loading)) {
          container.removeChild(loading);
          this.renderSvg(container, svg);
        }
      } catch (err) {
        const errorMsg = err.message || String(err);
        mermaidCache.set(this.diagramText, { error: errorMsg });
        if (container.contains(loading)) {
          container.removeChild(loading);
          this.renderError(container, errorMsg);
        }
      }
    })();

    return container;
  }

  renderSvg(container, svgContent) {
    const svgWrapper = document.createElement('div');
    svgWrapper.className = 'meo-mermaid-svg-wrapper';
    svgWrapper.innerHTML = svgContent;

    container.appendChild(svgWrapper);

    const controls = this.createZoomControls(svgWrapper);
    container.appendChild(controls);

    this.attachInteractions(svgWrapper, container);
  }

  createZoomControls(svgContainer) {
    const controls = document.createElement('div');
    controls.className = 'meo-mermaid-zoom-controls';

    const zoomIn = document.createElement('button');
    zoomIn.type = 'button';
    zoomIn.className = 'meo-mermaid-zoom-btn';
    zoomIn.textContent = '+';
    zoomIn.setAttribute('aria-label', 'Zoom in');

    const zoomOut = document.createElement('button');
    zoomOut.type = 'button';
    zoomOut.className = 'meo-mermaid-zoom-btn';
    zoomOut.textContent = '−';
    zoomOut.setAttribute('aria-label', 'Zoom out');

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'meo-mermaid-zoom-btn';
    reset.textContent = '↺';
    reset.setAttribute('aria-label', 'Reset zoom');

    const fullscreen = document.createElement('button');
    fullscreen.type = 'button';
    fullscreen.className = 'meo-mermaid-zoom-btn';
    fullscreen.textContent = '⛶';
    fullscreen.setAttribute('aria-label', 'Fullscreen');

    zoomIn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.setZoom(svgContainer, Math.min(4, this.zoom + 0.5));
    });

    zoomOut.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.setZoom(svgContainer, Math.max(0.25, this.zoom - 0.5));
    });

    reset.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.zoom = 1;
      this.panX = 0;
      this.panY = 0;
      this.applyTransform(svgContainer);
    });

    fullscreen.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.toggleFullscreen(svgContainer);
    });

    controls.appendChild(zoomIn);
    controls.appendChild(zoomOut);
    controls.appendChild(reset);
    controls.appendChild(fullscreen);

    return controls;
  }

  toggleFullscreen(svgContainer) {
    if (this.isFullscreen) {
      this.exitFullscreen();
    } else {
      this.enterFullscreen(svgContainer);
    }
  }

  enterFullscreen(svgContainer) {
    if (this.isFullscreen) return;
    this.isFullscreen = true;
    this.svgContent = svgContainer.innerHTML;
    
    const overlay = document.createElement('div');
    overlay.className = 'meo-mermaid-fullscreen-scrim';
    
    const fullscreenContainer = document.createElement('div');
    fullscreenContainer.className = 'meo-mermaid-fullscreen';
    
    const svgWrapper = document.createElement('div');
    svgWrapper.className = 'meo-mermaid-svg-wrapper';
    svgWrapper.innerHTML = this.svgContent;
    
    fullscreenContainer.appendChild(svgWrapper);
    
    const controls = this.createFullscreenControls(svgWrapper);
    fullscreenContainer.appendChild(controls);
    
    this.attachFullscreenInteractions(svgWrapper, fullscreenContainer);
    
    overlay.appendChild(fullscreenContainer);
    document.body.appendChild(overlay);
    
    requestAnimationFrame(() => {
      const svg = svgWrapper.querySelector('svg');
      if (svg) {
        const containerRect = fullscreenContainer.getBoundingClientRect();
        const padding = 80;
        const availableWidth = containerRect.width - padding;
        const availableHeight = containerRect.height - padding;
        
        const svgWidth = svg.getBoundingClientRect().width || svg.viewBox.baseVal.width;
        const svgHeight = svg.getBoundingClientRect().height || svg.viewBox.baseVal.height;
        
        if (svgWidth > 0 && svgHeight > 0) {
          const scaleX = availableWidth / svgWidth;
          const scaleY = availableHeight / svgHeight;
          this.fullscreenBaseScale = Math.min(scaleX, scaleY);
        } else {
          this.fullscreenBaseScale = 1;
        }
        
        svgWrapper.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.fullscreenBaseScale * this.zoom})`;
      }
    });
    
    this.fullscreenOverlay = overlay;
    this.fullscreenSvgWrapper = svgWrapper;
    
    this.exitFullscreenHandler = (e) => {
      if (e.key === 'Escape') {
        this.exitFullscreen();
      }
    };
    document.addEventListener('keydown', this.exitFullscreenHandler);
  }

  createFullscreenControls(svgContainer) {
    const controls = document.createElement('div');
    controls.className = 'meo-mermaid-zoom-controls meo-mermaid-fullscreen-controls';

    const zoomIn = document.createElement('button');
    zoomIn.type = 'button';
    zoomIn.className = 'meo-mermaid-zoom-btn';
    zoomIn.textContent = '+';
    zoomIn.setAttribute('aria-label', 'Zoom in');

    const zoomOut = document.createElement('button');
    zoomOut.type = 'button';
    zoomOut.className = 'meo-mermaid-zoom-btn';
    zoomOut.textContent = '−';
    zoomOut.setAttribute('aria-label', 'Zoom out');

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'meo-mermaid-zoom-btn';
    reset.textContent = '↺';
    reset.setAttribute('aria-label', 'Reset zoom');

    const exitBtn = document.createElement('button');
    exitBtn.type = 'button';
    exitBtn.className = 'meo-mermaid-zoom-btn meo-mermaid-exit-btn';
    exitBtn.textContent = '✕';
    exitBtn.setAttribute('aria-label', 'Exit fullscreen');

    zoomIn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.zoom = Math.min(4, this.zoom + 0.5);
      const scale = (this.fullscreenBaseScale || 1) * this.zoom;
      svgContainer.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${scale})`;
    });

    zoomOut.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.zoom = Math.max(0.25, this.zoom - 0.5);
      const scale = (this.fullscreenBaseScale || 1) * this.zoom;
      svgContainer.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${scale})`;
    });

    reset.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.zoom = 1;
      this.panX = 0;
      this.panY = 0;
      const scale = (this.fullscreenBaseScale || 1) * this.zoom;
      svgContainer.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${scale})`;
    });

    exitBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.exitFullscreen();
    });

    controls.appendChild(zoomIn);
    controls.appendChild(zoomOut);
    controls.appendChild(reset);
    controls.appendChild(exitBtn);

    return controls;
  }

  attachFullscreenInteractions(svgWrapper, container) {
    let isDragging = false;
    let lastMouseX = 0;
    let lastMouseY = 0;

    container.addEventListener('mousedown', (e) => {
      if (e.target.closest('.meo-mermaid-zoom-controls')) return;
      if (e.target.closest('.meo-mermaid-zoom-btn')) return;
      if (e.button !== 0) return;
      
      container.style.cursor = 'grabbing';
      isDragging = true;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    });

    const onMouseMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - lastMouseX;
      const dy = e.clientY - lastMouseY;
      this.panX += dx;
      this.panY += dy;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      const scale = (this.fullscreenBaseScale || 1) * this.zoom;
      svgWrapper.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${scale})`;
    };

    const onMouseUp = () => {
      isDragging = false;
      container.style.cursor = 'grab';
    };

    const onWheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.25 : 0.25;
      this.zoom = Math.max(0.25, Math.min(4, this.zoom + delta));
      const scale = (this.fullscreenBaseScale || 1) * this.zoom;
      svgWrapper.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${scale})`;
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    container.addEventListener('wheel', onWheel, { passive: false });
    
    this.fullscreenCleanup = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      container.removeEventListener('wheel', onWheel);
    };
  }

  exitFullscreen() {
    if (!this.isFullscreen) return;
    this.isFullscreen = false;
    
    if (this.fullscreenCleanup) {
      this.fullscreenCleanup();
      this.fullscreenCleanup = null;
    }
    
    if (this.fullscreenOverlay) {
      this.fullscreenOverlay.remove();
      this.fullscreenOverlay = null;
      this.fullscreenSvgWrapper = null;
    }
    
    if (this.exitFullscreenHandler) {
      document.removeEventListener('keydown', this.exitFullscreenHandler);
      this.exitFullscreenHandler = null;
    }
  }

  setZoom(svgContainer, newZoom, centerX = null, centerY = null) {
    if (centerX !== null && centerY !== null) {
      const rect = svgContainer.getBoundingClientRect();
      const containerRect = svgContainer.parentElement.getBoundingClientRect();
      
      const pointX = centerX - (rect.left - containerRect.left);
      const pointY = centerY - (rect.top - containerRect.top);
      
      const scale = newZoom / this.zoom;
      this.panX = pointX - (pointX - this.panX) * scale;
      this.panY = pointY - (pointY - this.panY) * scale;
    }
    
    this.zoom = newZoom;
    this.applyTransform(svgContainer);
  }

  applyTransform(svgContainer) {
    svgContainer.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoom})`;
  }

  attachInteractions(svgWrapper, container) {
    container.addEventListener('mousedown', (e) => {
      if (e.target.closest('.meo-mermaid-zoom-controls')) return;
      if (e.target.closest('.meo-mermaid-zoom-btn')) return;
      if (e.button !== 0) return;
      
      container.style.cursor = 'grabbing';
      container.classList.add('meo-mermaid-dragging');
      this.isDragging = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });

    const onMouseMove = (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      this.panX += dx;
      this.panY += dy;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      this.applyTransform(svgWrapper);
    };

    const onMouseUp = () => {
      this.isDragging = false;
      container.style.cursor = 'grab';
      container.classList.remove('meo-mermaid-dragging');
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  renderError(container, errorMsg) {
    const fallback = document.createElement('pre');
    fallback.className = 'meo-mermaid-fallback';
    const code = document.createElement('code');
    code.textContent = this.diagramText;
    fallback.appendChild(code);

    const badge = document.createElement('div');
    badge.className = 'meo-mermaid-error-badge';
    badge.textContent = `Mermaid error: ${errorMsg}`;
    
    container.appendChild(fallback);
    container.appendChild(badge);
  }

  ignoreEvent() {
    return false;
  }
}

const markerDeco = Decoration.mark({ class: 'meo-md-marker' });
const activeLineMarkerDeco = Decoration.mark({ class: 'meo-md-marker-active' });
const fenceMarkerDeco = Decoration.mark({ class: 'meo-md-fence-marker' });
const hrMarkerDeco = Decoration.mark({ class: 'meo-md-hr-marker' });

const lineStyleDecos = {
  h1: Decoration.line({ class: 'meo-md-h1' }),
  h2: Decoration.line({ class: 'meo-md-h2' }),
  h3: Decoration.line({ class: 'meo-md-h3' }),
  h4: Decoration.line({ class: 'meo-md-h4' }),
  h5: Decoration.line({ class: 'meo-md-h5' }),
  h6: Decoration.line({ class: 'meo-md-h6' }),
  quote: Decoration.line({ class: 'meo-md-quote' }),
  codeBlock: Decoration.line({ class: 'meo-md-code-block' }),
  list: Decoration.line({ class: 'meo-md-list-line' }),
  hr: Decoration.line({ class: 'meo-md-hr' })
};

const inlineStyleDecos = {
  em: Decoration.mark({ class: 'meo-md-em' }),
  strong: Decoration.mark({ class: 'meo-md-strong' }),
  strike: Decoration.mark({ class: 'meo-md-strike' }),
  inlineCode: Decoration.mark({ class: 'meo-md-inline-code' }),
  link: Decoration.mark({ class: 'meo-md-link' })
};

class ListMarkerWidget extends WidgetType {
  constructor(text, classes) {
    super();
    this.text = text;
    this.classes = classes;
  }

  eq(other) {
    return other.text === this.text && other.classes === this.classes;
  }

  toDOM() {
    const marker = document.createElement('span');
    marker.className = `meo-md-list-marker ${this.classes}`;
    marker.style.color = base02;
    marker.textContent = this.text;
    return marker;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(checked, bracketStart) {
    super();
    this.checked = checked;
    this.bracketStart = bracketStart;
  }

  eq(other) {
    return other.checked === this.checked && other.bracketStart === this.bracketStart;
  }

  toDOM(view) {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'meo-task-checkbox';
    checkbox.checked = this.checked;
    checkbox.setAttribute('aria-label', this.checked ? 'Mark task as incomplete' : 'Mark task as complete');

    checkbox.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });

    checkbox.addEventListener('change', () => {
      const newChar = checkbox.checked ? 'x' : ' ';
      view.dispatch({
        changes: { from: this.bracketStart + 1, to: this.bracketStart + 2, insert: newChar }
      });
    });

    return checkbox;
  }

  ignoreEvent() {
    return false;
  }
}

class CopyCodeButtonWidget extends WidgetType {
  constructor(codeContent) {
    super();
    this.codeContent = codeContent;
  }

  eq(other) {
    return other.codeContent === this.codeContent;
  }

  toDOM() {
    const container = document.createElement('span');
    container.className = 'meo-copy-code-btn';
    container.setAttribute('aria-label', 'Copy code');
    container.setAttribute('role', 'button');
    container.setAttribute('tabindex', '0');
    container.textContent = 'copy';

    const updateText = (copied) => {
      container.textContent = copied ? 'copied' : 'copy';
      container.classList.toggle('copied', copied);
    };

    container.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(this.codeContent);
        updateText(true);
        setTimeout(() => updateText(false), 2000);
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    });

    container.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(this.codeContent);
          updateText(true);
          setTimeout(() => updateText(false), 2000);
        } catch (err) {
          console.error('Failed to copy:', err);
        }
      }
    });

    return container;
  }

  ignoreEvent(event) {
    return event !== 'pointerover' && event !== 'pointerout';
  }
}



function addRange(builder, from, to, deco) {
  if (to <= from) {
    return;
  }
  builder.push(deco.range(from, to));
}

function collectActiveLines(state) {
  const lines = new Set();
  for (const range of state.selection.ranges) {
    // In live mode, only reveal markdown markers on the focused line.
    const focusLine = state.doc.lineAt(range.head).number;
    lines.add(focusLine);
  }
  return lines;
}

function headingLevelFromName(name) {
  if (!name.startsWith('ATXHeading')) {
    return null;
  }
  const level = Number.parseInt(name.slice('ATXHeading'.length), 10);
  return Number.isInteger(level) && level >= 1 && level <= 6 ? level : null;
}

function addLineClass(builder, state, from, to, deco) {
  const startLine = state.doc.lineAt(from).number;
  const endLine = state.doc.lineAt(Math.max(from, to - 1)).number;
  for (let lineNo = startLine; lineNo <= endLine; lineNo += 1) {
    const line = state.doc.line(lineNo);
    builder.push(deco.range(line.from));
  }
}

function shouldSuppressTransientSetextHeading(state, node, activeLines) {
  const underlineLine = state.doc.lineAt(Math.max(node.to - 1, node.from));
  if (!activeLines.has(underlineLine.number)) {
    return false;
  }

  const underlineText = state.doc.sliceString(underlineLine.from, underlineLine.to);
  return /^[ \t]{0,3}-[ \t]*$/.test(underlineText);
}

function addAtxHeadingPrefixMarkers(builder, state, from, activeLines) {
  const line = state.doc.lineAt(from);
  const text = state.doc.sliceString(line.from, line.to);
  const match = /^(#{1,6}[ \t]+)/.exec(text);
  if (!match) {
    return;
  }

  const prefixTo = line.from + match[1].length;
  if (activeLines.has(line.number)) {
    addRange(builder, line.from, prefixTo, activeLineMarkerDeco);
    return;
  }
  addRange(builder, line.from, prefixTo, markerDeco);
}

function isFenceMarker(state, from, to) {
  const text = state.doc.sliceString(from, to);
  return /^`{3,}$/.test(text) || /^~{3,}$/.test(text);
}

function getFencedCodeInfo(state, node) {
  let codeInfo = null;
  for (let child = node.node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'CodeInfo') {
      codeInfo = state.doc.sliceString(child.from, child.to).trim().toLowerCase();
      break;
    }
  }
  return codeInfo;
}

function getFencedCodeContent(state, node) {
  const startLine = state.doc.lineAt(node.from);
  const endLine = state.doc.lineAt(Math.max(node.to - 1, node.from));
  
  const lines = [];
  let inContent = false;
  
  for (let lineNum = startLine.number; lineNum <= endLine.number; lineNum++) {
    const line = state.doc.line(lineNum);
    const lineText = state.doc.sliceString(line.from, line.to);
    
    if (!inContent) {
      if (/^[ \t]{0,3}(?:`{3,}|~{3,})/.test(lineText)) {
        inContent = true;
      }
      continue;
    }
    
    if (/^[ \t]{0,3}(?:`{3,}|~{3,})/.test(lineText)) {
      break;
    }
    
    lines.push(lineText);
  }
  
  return lines.join('\n');
}

function addFenceOpeningLineMarker(builder, state, from, activeLines) {
  const line = state.doc.lineAt(from);
  const text = state.doc.sliceString(line.from, line.to);
  if (!/^[ \t]{0,3}(?:`{3,}|~{3,})/.test(text)) {
    return;
  }

  // Show fence markers on all lines (not just active)
  if (activeLines.has(line.number)) {
    addRange(builder, line.from, line.to, activeLineMarkerDeco);
    return;
  }
  addRange(builder, line.from, line.to, fenceMarkerDeco);
}

function addMermaidDiagram(builder, state, node) {
  const diagramText = getFencedCodeContent(state, node);
  if (!diagramText.trim()) {
    return;
  }

  const startLine = state.doc.lineAt(node.from);
  const endLine = state.doc.lineAt(Math.max(node.to - 1, node.from));

  if (startLine.number >= endLine.number) {
    return;
  }

  const contentStartLine = state.doc.line(startLine.number + 1);
  const contentEndLine = state.doc.line(endLine.number - 1);

  if (contentStartLine.from >= contentEndLine.to) {
    return;
  }

  const fullBlockText = state.doc.sliceString(startLine.from, endLine.to);
  const copyWidget = new CopyCodeButtonWidget(fullBlockText);
  builder.push(
    Decoration.widget({
      widget: copyWidget,
      side: 1,
      class: 'meo-copy-code-btn'
    }).range(startLine.to)
  );

  const widget = new MermaidDiagramWidget(diagramText);
  
  builder.push(
    Decoration.replace({
      widget,
      block: true
    }).range(contentStartLine.from, contentEndLine.to)
  );
}

function addCopyCodeButton(builder, state, from, to) {
  const startLine = state.doc.lineAt(from);
  const endLine = state.doc.lineAt(Math.max(to - 1, from));

  let codeContent = '';
  for (let lineNum = startLine.number + 1; lineNum <= endLine.number; lineNum++) {
    const line = state.doc.line(lineNum);
    const lineText = state.doc.sliceString(line.from, line.to);

    if (lineNum === endLine.number) {
      const fenceMatch = /^[ \t]*[`~]{3,}.*$/.exec(lineText);
      if (fenceMatch) {
        continue;
      }
    }

    if (codeContent) {
      codeContent += '\n';
    }
    codeContent += lineText;
  }

  if (!codeContent) {
    return;
  }

  const widget = new CopyCodeButtonWidget(codeContent);
  builder.push(
    Decoration.widget({
      widget,
      side: 1,
      class: 'meo-copy-code-btn'
    }).range(startLine.to)
  );
}

export function listMarkerData(lineText, orderedDisplayIndex = null) {
  const match = /^(\s*)(?:([-+*])|(\d+)([.)]))\s+(?:\[([ xX])\]\s+)?/.exec(lineText);
  if (!match) {
    return null;
  }

  const indent = match[1].length;
  const orderedNumber = match[3];
  const orderedSuffix = match[4];
  const taskState = match[5];

  let markerText = '•';
  let classes = 'meo-md-list-marker-bullet';

  if (orderedNumber && orderedSuffix) {
    markerText = `${orderedDisplayIndex ?? orderedNumber}${orderedSuffix}`;
    classes = 'meo-md-list-marker-ordered';
  }

  const markerCharLength = match[2]?.length ?? (orderedNumber?.length ?? 0) + (orderedSuffix?.length ?? 0);
  const markerEndOffset = indent + markerCharLength;

  const result = {
    fromOffset: indent,
    markerEndOffset,
    toOffset: match[0].length,
    markerText,
    classes
  };

  if (taskState !== undefined) {
    result.taskBracketStart = markerEndOffset + 1;
    result.taskState = taskState.toLowerCase() === 'x';
  }

  return result;
}

function addListMarkerDecoration(builder, state, from, activeLines, orderedDisplayIndex = null) {
  const line = state.doc.lineAt(from);
  const lineText = state.doc.sliceString(line.from, line.to);
  const marker = listMarkerData(lineText, orderedDisplayIndex);
  if (!marker) {
    return;
  }

  const indentEnd = line.from + marker.fromOffset;
  const markerEnd = line.from + marker.markerEndOffset;

  if (marker.taskBracketStart !== undefined) {
    const bracketStart = line.from + marker.taskBracketStart;
    const fullEnd = line.from + marker.toOffset - 1;
    builder.push(
      Decoration.replace({
        widget: new CheckboxWidget(marker.taskState, bracketStart),
        inclusive: false
      }).range(indentEnd, fullEnd)
    );
    if (marker.taskState) {
      const textStart = line.from + marker.toOffset;
      if (textStart < line.to) {
        builder.push(
          Decoration.mark({ class: 'meo-task-complete' }).range(textStart, line.to)
        );
      }
    }
  } else if (markerEnd > indentEnd) {
    builder.push(
      Decoration.replace({
        widget: new ListMarkerWidget(marker.markerText, marker.classes),
        inclusive: false
      }).range(indentEnd, markerEnd)
    );
  }

  if (marker.fromOffset > 0) {
    for (let pos = line.from; pos < indentEnd; pos++) {
      builder.push(
        Decoration.mark({ class: 'meo-md-list-border' }).range(pos, pos + 1)
      );
    }
  }
}

function buildDecorations(state) {
  const ranges = [];
  const activeLines = collectActiveLines(state);
  const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);
  const orderedListItemCounts = new Map();

  tree.iterate({
    enter: (node) => {
      if (node.name === 'OrderedList') {
        orderedListItemCounts.set(node.from, 0);
      }

      const headingLevel = headingLevelFromName(node.name);
      if (headingLevel !== null) {
        addAtxHeadingPrefixMarkers(ranges, state, node.from, activeLines);
        addLineClass(ranges, state, node.from, node.to, lineStyleDecos[`h${headingLevel}`]);
      }

      if (node.name === 'SetextHeading1') {
        addLineClass(ranges, state, node.from, node.to, lineStyleDecos.h1);
      } else if (node.name === 'SetextHeading2') {
        if (!shouldSuppressTransientSetextHeading(state, node, activeLines)) {
          addLineClass(ranges, state, node.from, node.to, lineStyleDecos.h2);
        }
      } else if (node.name === 'HorizontalRule') {
        addLineClass(ranges, state, node.from, node.to, lineStyleDecos.hr);
        if (activeLines.has(state.doc.lineAt(node.from).number)) {
          addRange(ranges, node.from, node.to, activeLineMarkerDeco);
        } else {
          addRange(ranges, node.from, node.to, hrMarkerDeco);
        }
      } else if (node.name === 'Blockquote') {
        addLineClass(ranges, state, node.from, node.to, lineStyleDecos.quote);
      } else if (node.name === 'FencedCode' || node.name === 'CodeBlock') {
        addLineClass(ranges, state, node.from, node.to, lineStyleDecos.codeBlock);
        if (node.name === 'FencedCode') {
          addFenceOpeningLineMarker(ranges, state, node.from, activeLines);
          
          const codeInfo = getFencedCodeInfo(state, node);
          if (codeInfo === 'mermaid') {
            addMermaidDiagram(ranges, state, node);
            return;
          }
        }
        addCopyCodeButton(ranges, state, node.from, node.to);
      } else if (
        node.name === 'ListItem' ||
        node.name === 'BulletList' ||
        node.name === 'OrderedList'
      ) {
        addLineClass(ranges, state, node.from, node.to, lineStyleDecos.list);
        if (node.name === 'ListItem') {
          let orderedDisplayIndex = null;
          let parent = node.node.parent;
          while (parent && parent.name !== 'OrderedList' && parent.name !== 'BulletList') {
            parent = parent.parent;
          }

          if (parent?.name === 'OrderedList') {
            const nextCount = (orderedListItemCounts.get(parent.from) ?? 0) + 1;
            orderedListItemCounts.set(parent.from, nextCount);
            orderedDisplayIndex = nextCount;
          }

          addListMarkerDecoration(ranges, state, node.from, activeLines, orderedDisplayIndex);
        }
      }

      if (node.name === 'Emphasis') {
        addRange(ranges, node.from, node.to, inlineStyleDecos.em);
      } else if (node.name === 'StrongEmphasis') {
        addRange(ranges, node.from, node.to, inlineStyleDecos.strong);
      } else if (node.name === 'Strikethrough') {
        addRange(ranges, node.from, node.to, inlineStyleDecos.strike);
      } else if (node.name === 'InlineCode' || node.name === 'CodeText') {
        addRange(ranges, node.from, node.to, inlineStyleDecos.inlineCode);
      } else if (node.name === 'Link' || node.name === 'URL' || node.name === 'Autolink') {
        addRange(ranges, node.from, node.to, inlineStyleDecos.link);
      }

      if (!node.name.endsWith('Mark')) {
        return;
      }

      const line = state.doc.lineAt(node.from);
      if (isFenceMarker(state, node.from, node.to)) {
        // Show fence markers on all lines (not just active)
        if (activeLines.has(line.number)) {
          addRange(ranges, node.from, node.to, activeLineMarkerDeco);
        } else {
          addRange(ranges, node.from, node.to, fenceMarkerDeco);
        }
      } else if (activeLines.has(line.number)) {
        addRange(ranges, node.from, node.to, activeLineMarkerDeco);
      } else {
        addRange(ranges, node.from, node.to, markerDeco);
      }
    }
  });

  const result = Decoration.set(ranges, true);
  return result;
}

const liveDecorationField = StateField.define({
  create(state) {
    return buildDecorations(state);
  },
  update(decorations, transaction) {
    // Recompute on every transaction so live mode stays in sync with parser updates
    // that may arrive without direct doc/selection changes.
    const next = buildDecorations(transaction.state);

    // Guard against transient empty parse results on selection-only transactions.
    if (!transaction.docChanged && isEmptyDecorationSet(next) && !isEmptyDecorationSet(decorations)) {
      return decorations;
    }

    return next;
  },
  provide: (field) => EditorView.decorations.from(field)
});

export function liveModeExtensions() {
  return [
    markdown({ base: markdownLanguage, addKeymap: false, codeLanguages: resolveCodeLanguage }),
    syntaxHighlighting(highlightStyle),
    liveDecorationField
  ];
}

function isEmptyDecorationSet(set) {
  const cursor = set.iter();
  return cursor.value === null;
}
