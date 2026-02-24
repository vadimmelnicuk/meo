import { getGitDiffOverviewSegments } from './gitDiffGutter';

const minMarkerHeightPx = 2;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getTrackMetrics(view, trackHeight) {
  const scrollEl = view?.scrollDOM;
  if (!scrollEl || trackHeight <= 0) {
    return {
      drawableHeight: trackHeight,
      fileEndY: trackHeight,
      showFileEndLine: false
    };
  }

  const totalScrollHeight = Math.max(0, scrollEl.scrollHeight || 0);
  if (totalScrollHeight <= 0) {
    return {
      drawableHeight: trackHeight,
      fileEndY: trackHeight,
      showFileEndLine: false
    };
  }

  let contentBottom = 0;
  try {
    const lastLine = view.state.doc.line(view.state.doc.lines);
    const lastBlock = view.lineBlockAt(lastLine.from);
    contentBottom = Number.isFinite(lastBlock?.bottom) ? lastBlock.bottom : 0;
  } catch {
    contentBottom = 0;
  }

  if (!(contentBottom > 0) && Number.isFinite(view.contentHeight)) {
    contentBottom = view.contentHeight;
  }

  contentBottom = clamp(Math.ceil(contentBottom), 0, totalScrollHeight);
  if (contentBottom <= 0) {
    contentBottom = totalScrollHeight;
  }

  const fileEndRatio = clamp(contentBottom / totalScrollHeight, 0, 1);
  const fileEndY = clamp(Math.round(trackHeight * fileEndRatio), 0, trackHeight);
  return {
    drawableHeight: Math.max(0, fileEndY),
    fileEndY,
    showFileEndLine: fileEndY > 0 && fileEndY < trackHeight
  };
}

export function createGitDiffOverviewRulerController({
  view,
  getMode,
  isGitChangesVisible
}) {
  let destroyed = false;
  let host = null;
  let lastRenderKey = '';
  let resizeObserver = null;
  let rafId = 0;
  let onWindowResize = null;

  const ensureHost = () => {
    if (host) {
      return host;
    }
    host = document.createElement('div');
    host.className = 'meo-git-overview-ruler';
    host.hidden = true;
    view.dom.appendChild(host);
    return host;
  };

  const cancelScheduledRender = () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };

  const hide = () => {
    const root = ensureHost();
    root.hidden = true;
    if (root.childElementCount) {
      root.textContent = '';
    }
  };

  const renderNow = () => {
    if (destroyed || !view) {
      return;
    }

    const mode = typeof getMode === 'function' ? getMode() : 'source';
    const visible = typeof isGitChangesVisible === 'function' ? isGitChangesVisible() : true;
    const root = ensureHost();
    if (!visible) {
      lastRenderKey = `hidden:${mode}:visibility-off`;
      hide();
      return;
    }

    const trackHeight = Math.floor(root.clientHeight || view.dom.clientHeight || 0);
    if (trackHeight <= 0) {
      lastRenderKey = `hidden:${mode}:no-height`;
      hide();
      return;
    }
    const trackMetrics = getTrackMetrics(view, trackHeight);

    const totalLines = Math.max(1, view.state.doc.lines);
    const segments = getGitDiffOverviewSegments(view.state);
    if (!segments.length) {
      lastRenderKey = `hidden:${mode}:no-segments:${totalLines}:${trackHeight}:${trackMetrics.fileEndY}`;
      hide();
      return;
    }

    const pixelSegments = [];
    for (const segment of segments) {
      const topRatio = (segment.fromLine - 1) / totalLines;
      const bottomRatio = segment.toLine / totalLines;
      let top = Math.floor(topRatio * trackMetrics.drawableHeight);
      let bottom = Math.ceil(bottomRatio * trackMetrics.drawableHeight);
      let height = Math.max(minMarkerHeightPx, bottom - top);

      top = clamp(top, 0, Math.max(0, trackMetrics.drawableHeight - 1));
      if (top + height > trackMetrics.drawableHeight) {
        if (height >= trackMetrics.drawableHeight) {
          top = 0;
          height = trackMetrics.drawableHeight;
        } else {
          top = Math.max(0, trackMetrics.drawableHeight - height);
        }
      }
      bottom = top + height;
      if (bottom > trackMetrics.drawableHeight) {
        bottom = trackMetrics.drawableHeight;
      }
      if (bottom <= top) {
        continue;
      }

      pixelSegments.push({
        top,
        height: bottom - top,
        added: segment.added,
        modified: segment.modified
      });
    }

    const renderKey = [
      mode,
      visible ? 1 : 0,
      totalLines,
      trackHeight,
      trackMetrics.fileEndY,
      trackMetrics.showFileEndLine ? 1 : 0,
      pixelSegments.map((segment) => (
        `${segment.top}:${segment.height}:${segment.added ? 1 : 0}:${segment.modified ? 1 : 0}`
      )).join(',')
    ].join('|');

    if (renderKey === lastRenderKey) {
      return;
    }
    lastRenderKey = renderKey;

    root.textContent = '';
    for (const segment of pixelSegments) {
      const marker = document.createElement('div');
      marker.className = 'meo-git-overview-ruler-marker';
      if (segment.added) {
        marker.classList.add('is-added');
      }
      if (segment.modified) {
        marker.classList.add('is-modified');
      }
      marker.style.top = `${segment.top}px`;
      marker.style.height = `${segment.height}px`;
      root.appendChild(marker);
    }
    if (trackMetrics.showFileEndLine) {
      const boundary = document.createElement('div');
      boundary.className = 'meo-git-overview-ruler-file-end';
      boundary.style.top = `${clamp(trackMetrics.fileEndY - 1, 0, trackHeight - 1)}px`;
      root.appendChild(boundary);
    }
    root.hidden = false;
  };

  const scheduleRender = () => {
    if (destroyed || rafId) {
      return;
    }
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      renderNow();
    });
  };

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      lastRenderKey = '';
      scheduleRender();
    });
    resizeObserver.observe(view.dom);
    resizeObserver.observe(view.scrollDOM);
    resizeObserver.observe(view.contentDOM);
  } else {
    onWindowResize = () => {
      lastRenderKey = '';
      scheduleRender();
    };
    window.addEventListener('resize', onWindowResize);
  }

  scheduleRender();

  return {
    refresh() {
      scheduleRender();
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      cancelScheduledRender();
      resizeObserver?.disconnect();
      resizeObserver = null;
      if (onWindowResize) {
        window.removeEventListener('resize', onWindowResize);
        onWindowResize = null;
      }
      if (host) {
        host.remove();
        host = null;
      }
    }
  };
}
