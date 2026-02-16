import { WidgetType } from '@codemirror/view';
import mermaid from 'mermaid';
import { createElement, ZoomIn, ZoomOut, RotateCcw, Maximize2, X } from 'lucide';

let mermaidInitialized = false;
const MERMAID_CACHE_LIMIT = 100;
const mermaidCache = new Map();
const mermaidRenderInFlight = new Map();
let mermaidIdCounter = 0;

function initMermaid() {
  if (mermaidInitialized) {
    return;
  }

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'dark'
  });
  mermaidInitialized = true;
}

function getCachedMermaidResult(diagramText) {
  const cached = mermaidCache.get(diagramText);
  if (!cached) {
    return null;
  }
  mermaidCache.delete(diagramText);
  mermaidCache.set(diagramText, cached);
  return cached;
}

function cacheMermaidResult(diagramText, result) {
  if (mermaidCache.has(diagramText)) {
    mermaidCache.delete(diagramText);
  }
  mermaidCache.set(diagramText, result);

  if (mermaidCache.size <= MERMAID_CACHE_LIMIT) {
    return;
  }

  const oldestKey = mermaidCache.keys().next().value;
  if (oldestKey !== undefined) {
    mermaidCache.delete(oldestKey);
  }
}

async function renderMermaidDiagram(diagramText) {
  const cached = getCachedMermaidResult(diagramText);
  if (cached) {
    return cached;
  }

  const inFlight = mermaidRenderInFlight.get(diagramText);
  if (inFlight) {
    return inFlight;
  }

  const id = `mermaid-${++mermaidIdCounter}`;
  const renderPromise = mermaid
    .render(id, diagramText)
    .then(({ svg }) => {
      const result = { svg };
      cacheMermaidResult(diagramText, result);
      return result;
    })
    .catch((err) => {
      const result = { error: err.message || String(err) };
      cacheMermaidResult(diagramText, result);
      return result;
    })
    .finally(() => {
      mermaidRenderInFlight.delete(diagramText);
    });

  mermaidRenderInFlight.set(diagramText, renderPromise);
  return renderPromise;
}

export function getFencedCodeContent(state, node) {
  const startLine = state.doc.lineAt(node.from);
  const endLine = state.doc.lineAt(Math.max(node.to - 1, node.from));

  const lines = [];
  let inContent = false;

  for (let lineNum = startLine.number; lineNum <= endLine.number; lineNum += 1) {
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

export class MermaidDiagramWidget extends WidgetType {
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
    this.inlineCleanup = null;
  }

  eq(other) {
    return other.diagramText === this.diagramText;
  }

  toDOM() {
    initMermaid();
    const container = document.createElement('div');
    container.className = 'meo-mermaid-block';

    const cached = getCachedMermaidResult(this.diagramText);
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

    (async () => {
      const result = await renderMermaidDiagram(this.diagramText);
      if (!container.contains(loading)) {
        return;
      }
      container.removeChild(loading);
      if (result.error) {
        this.renderError(container, result.error);
      } else {
        this.renderSvg(container, result.svg);
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
    zoomIn.appendChild(createElement(ZoomIn, { width: 16, height: 16 }));
    zoomIn.setAttribute('aria-label', 'Zoom in');

    const zoomOut = document.createElement('button');
    zoomOut.type = 'button';
    zoomOut.className = 'meo-mermaid-zoom-btn';
    zoomOut.appendChild(createElement(ZoomOut, { width: 16, height: 16 }));
    zoomOut.setAttribute('aria-label', 'Zoom out');

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'meo-mermaid-zoom-btn';
    reset.appendChild(createElement(RotateCcw, { width: 16, height: 16 }));
    reset.setAttribute('aria-label', 'Reset zoom');

    const fullscreen = document.createElement('button');
    fullscreen.type = 'button';
    fullscreen.className = 'meo-mermaid-zoom-btn';
    fullscreen.appendChild(createElement(Maximize2, { width: 16, height: 16 }));
    fullscreen.setAttribute('aria-label', 'Fullscreen');

    zoomIn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.setZoom(svgContainer, Math.min(4, this.zoom + 0.5));
    });

    zoomOut.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.setZoom(svgContainer, Math.max(0.25, this.zoom - 0.5));
    });

    reset.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.zoom = 1;
      this.panX = 0;
      this.panY = 0;
      this.applyTransform(svgContainer);
    });

    fullscreen.addEventListener('pointerdown', (e) => {
      e.preventDefault();
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
    if (this.isFullscreen) {
      return;
    }
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
    zoomIn.appendChild(createElement(ZoomIn, { width: 16, height: 16 }));
    zoomIn.setAttribute('aria-label', 'Zoom in');

    const zoomOut = document.createElement('button');
    zoomOut.type = 'button';
    zoomOut.className = 'meo-mermaid-zoom-btn';
    zoomOut.appendChild(createElement(ZoomOut, { width: 16, height: 16 }));
    zoomOut.setAttribute('aria-label', 'Zoom out');

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'meo-mermaid-zoom-btn';
    reset.appendChild(createElement(RotateCcw, { width: 16, height: 16 }));
    reset.setAttribute('aria-label', 'Reset zoom');

    const exitBtn = document.createElement('button');
    exitBtn.type = 'button';
    exitBtn.className = 'meo-mermaid-zoom-btn meo-mermaid-exit-btn';
    exitBtn.appendChild(createElement(X, { width: 16, height: 16 }));
    exitBtn.setAttribute('aria-label', 'Exit fullscreen');

    zoomIn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.zoom = Math.min(4, this.zoom + 0.5);
      const scale = (this.fullscreenBaseScale || 1) * this.zoom;
      svgContainer.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${scale})`;
    });

    zoomOut.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.zoom = Math.max(0.25, this.zoom - 0.5);
      const scale = (this.fullscreenBaseScale || 1) * this.zoom;
      svgContainer.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${scale})`;
    });

    reset.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.zoom = 1;
      this.panX = 0;
      this.panY = 0;
      const scale = (this.fullscreenBaseScale || 1) * this.zoom;
      svgContainer.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${scale})`;
    });

    exitBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
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
      if (!isDragging) {
        return;
      }
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
    if (!this.isFullscreen) {
      return;
    }
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
    if (this.inlineCleanup) {
      this.inlineCleanup();
      this.inlineCleanup = null;
    }

    const onMouseDown = (e) => {
      if (e.target.closest('.meo-mermaid-zoom-controls')) return;
      if (e.target.closest('.meo-mermaid-zoom-btn')) return;
      if (e.button !== 0) return;

      container.style.cursor = 'grabbing';
      container.classList.add('meo-mermaid-dragging');
      this.isDragging = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    };

    const onMouseMove = (e) => {
      if (!this.isDragging) {
        return;
      }
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

    container.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    this.inlineCleanup = () => {
      container.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
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

  destroy() {
    if (this.inlineCleanup) {
      this.inlineCleanup();
      this.inlineCleanup = null;
    }
    this.exitFullscreen();
  }
}
