const hoverDelayMs = 0;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatAbsoluteDate(unixSeconds) {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) {
    return '';
  }
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(unixSeconds * 1000));
  } catch {
    return new Date(unixSeconds * 1000).toLocaleString();
  }
}

function buildTooltipDom() {
  const root = document.createElement('div');
  root.className = 'meo-git-blame-tooltip';
  root.hidden = true;

  const title = document.createElement('div');
  title.className = 'meo-git-blame-title';
  root.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'meo-git-blame-meta';
  root.appendChild(meta);

  return { root, title, meta };
}

function renderBlameResult(ui, result) {
  if (!result || typeof result !== 'object') {
    ui.title.textContent = 'Blame unavailable';
    ui.meta.textContent = '';
    return;
  }

  if (result.kind === 'commit') {
    ui.title.textContent = result.summary || '(no commit message)';
    const date = formatAbsoluteDate(result.authorTimeUnix);
    const parts = [
      result.author || 'Unknown',
      result.shortCommit || (result.commit ? result.commit.slice(0, 8) : '')
    ].filter(Boolean);
    if (date) {
      parts.push(date);
    }
    ui.meta.textContent = parts.join(' · ');
    return;
  }

  if (result.kind === 'uncommitted') {
    ui.title.textContent = 'Uncommitted changes';
    ui.meta.textContent = '';
    return;
  }

  ui.title.textContent = 'Blame unavailable';
  ui.meta.textContent = result.reason ? `${result.reason}` : '';
}

function shouldShowBlameTooltip(result) {
  if (!result || typeof result !== 'object') {
    return false;
  }
  return result.kind === 'commit' || result.kind === 'uncommitted';
}

function positionTooltip(ui, anchorRect) {
  const tooltip = ui.root;
  tooltip.style.left = '0px';
  tooltip.style.top = '0px';
  tooltip.hidden = false;

  const rect = tooltip.getBoundingClientRect();
  let left = anchorRect.right + 8;
  if (left + rect.width > window.innerWidth - 8) {
    left = anchorRect.left - rect.width - 8;
  }
  left = clamp(left, 8, Math.max(8, window.innerWidth - rect.width - 8));
  const anchorMidY = ((anchorRect.top ?? 0) + (anchorRect.bottom ?? anchorRect.top ?? 0)) / 2;
  const top = clamp(anchorMidY - rect.height / 2, 8, Math.max(8, window.innerHeight - rect.height - 8));

  tooltip.style.left = `${Math.round(left)}px`;
  tooltip.style.top = `${Math.round(top)}px`;
}

function isTrailingEofVisualLine(doc, lineNumber) {
  if (!doc || doc.length <= 0 || doc.lines <= 1 || lineNumber !== doc.lines) {
    return false;
  }
  const lastLine = doc.line(doc.lines);
  return lastLine.from === lastLine.to;
}

function getMarkerChangeKind(marker) {
  if (!(marker instanceof HTMLElement)) {
    return null;
  }
  if (marker.classList.contains('is-added')) {
    return 'added';
  }
  if (marker.classList.contains('is-modified')) {
    return 'modified';
  }
  return null;
}

function isChangedMarker(marker) {
  return getMarkerChangeKind(marker) !== null;
}

function normalizeTrailingEofVisualLineHit(doc, lineNumber, gutterRowElement, markerElement = null) {
  const rowMarker = gutterRowElement?.querySelector?.('.meo-git-gutter-marker') ?? null;
  const hitMarker = markerElement instanceof HTMLElement ? markerElement : null;
  if (!isTrailingEofVisualLine(doc, lineNumber)) {
    const changedMarker = (
      isChangedMarker(rowMarker)
        ? rowMarker
        : isChangedMarker(hitMarker)
          ? hitMarker
          : null
    );
    return {
      lineNumber,
      requestLineNumber: lineNumber,
      proxiedFromTrailingEof: false,
      effectiveChangeKind: getMarkerChangeKind(changedMarker)
    };
  }
  const previousRowMarker = (
    gutterRowElement instanceof HTMLElement
      ? gutterRowElement.previousElementSibling?.querySelector?.('.meo-git-gutter-marker') ?? null
      : null
  );
  const changedMarker = (
    isChangedMarker(rowMarker)
      ? rowMarker
      : isChangedMarker(hitMarker)
        ? hitMarker
      : isChangedMarker(previousRowMarker)
        ? previousRowMarker
        : null
  );
  // The synthetic trailing EOF row should always proxy to the previous real line so
  // unchanged last lines still support blame hover/click like the line above.
  return {
    lineNumber: Math.max(1, lineNumber - 1),
    requestLineNumber: lineNumber,
    proxiedFromTrailingEof: true,
    effectiveChangeKind: getMarkerChangeKind(changedMarker)
  };
}

export function createGitBlameHoverController({
  view,
  getMode,
  requestBlame,
  openRevisionForLine,
  openWorktreeForLine
}) {
  const ui = buildTooltipDom();
  document.body.appendChild(ui.root);

  let hoverTimer = null;
  let activeLineNumber = 0;
  let hoverToken = 0;
  let destroyed = false;
  let lastAnchorRect = null;
  let activeMarkerElement = null;
  let activeGutterRowElement = null;
  let pendingBlameLineNumber = 0;

  const getGutterBandLayout = () => {
    const gutter = view.dom.querySelector('.cm-gutter.meo-git-gutter');
    if (!(gutter instanceof HTMLElement)) {
      return null;
    }
    const gutterRect = gutter.getBoundingClientRect();
    const foldGutter = view.dom.querySelector('.cm-gutter.meo-md-fold-gutter');
    const foldGutterRect = foldGutter instanceof HTMLElement ? foldGutter.getBoundingClientRect() : null;
    const contentRect = view.contentDOM.getBoundingClientRect();
    return {
      gutter,
      gutterRect,
      contentRect,
      bandLeft: foldGutterRect ? Math.min(foldGutterRect.left, gutterRect.left) : gutterRect.left,
      bandRight: Math.max(gutterRect.right, contentRect.left),
      bandTop: foldGutterRect ? Math.min(foldGutterRect.top, gutterRect.top) : gutterRect.top,
      bandBottom: foldGutterRect ? Math.max(foldGutterRect.bottom, gutterRect.bottom) : gutterRect.bottom
    };
  };

  const isWithinBand = (layout, clientX, clientY) => (
    clientX >= layout.bandLeft &&
    clientX < layout.bandRight &&
    clientY >= layout.bandTop &&
    clientY <= layout.bandBottom
  );

  const gutterProbeXs = (gutterRect) => {
    const minX = Math.round(gutterRect.left + 1);
    const maxX = Math.max(minX, Math.round(gutterRect.right - 1));
    const centerX = clamp(Math.round(gutterRect.left + gutterRect.width / 2), minX, maxX);
    return [centerX, minX, maxX];
  };

  const getMarkerAtY = (gutterRect, clientY) => {
    for (const sampleX of gutterProbeXs(gutterRect)) {
      const stack = typeof document.elementsFromPoint === 'function'
        ? document.elementsFromPoint(sampleX, clientY)
        : [document.elementFromPoint(sampleX, clientY)];
      for (const hit of stack) {
        if (!(hit instanceof Element)) {
          continue;
        }
        const marker = hit.closest('.meo-git-gutter-marker');
        if (marker instanceof HTMLElement) {
          return marker;
        }
      }
    }
    return null;
  };

  const getGutterRowAtY = (gutterRect, clientY) => {
    for (const sampleX of gutterProbeXs(gutterRect)) {
      const stack = typeof document.elementsFromPoint === 'function'
        ? document.elementsFromPoint(sampleX, clientY)
        : [document.elementFromPoint(sampleX, clientY)];
      for (const hit of stack) {
        if (!(hit instanceof Element)) {
          continue;
        }
        const row = hit.closest('.cm-gutterElement');
        if (
          row instanceof HTMLElement &&
          row.closest('.cm-gutter.meo-git-gutter')
        ) {
          return row;
        }
      }
    }
    return null;
  };

  const getRawLineNumberAtGutterRow = (gutterRowElement) => {
    if (!(gutterRowElement instanceof HTMLElement)) {
      return null;
    }
    const rowRect = gutterRowElement.getBoundingClientRect();
    const probeY = (rowRect.top + rowRect.bottom) / 2;
    const viewAny = /** @type {any} */ (view);
    if (typeof viewAny.lineBlockAtHeight === 'function') {
      const block = viewAny.lineBlockAtHeight(probeY - view.documentTop);
      if (block && Number.isFinite(block.from)) {
        return view.state.doc.lineAt(block.from).number;
      }
    }

    const contentRect = view.contentDOM.getBoundingClientRect();
    const x = clamp(
      contentRect.left + 4,
      contentRect.left + 1,
      Math.max(contentRect.left + 1, contentRect.right - 1)
    );
    const pos = view.posAtCoords({ x, y: probeY });
    return pos === null ? null : view.state.doc.lineAt(pos).number;
  };

  const setBandCursor = (active) => {
    const cursor = active ? 'pointer' : '';
    view.dom.style.cursor = cursor;
    view.scrollDOM.style.cursor = cursor;
  };

  const clearMarkerHover = () => {
    if (activeMarkerElement) {
      activeMarkerElement.classList.remove('is-hit-hover');
      activeMarkerElement = null;
    }
    if (activeGutterRowElement) {
      activeGutterRowElement.classList.remove('is-git-hover-empty');
      activeGutterRowElement = null;
    }
    view.dom.classList.remove('meo-git-hover-band');
    setBandCursor(false);
  };

  const updateMarkerHoverForY = (gutterRect, y) => {
    const hit = getMarkerAtY(gutterRect, y);
    const gutterRowElement = getGutterRowAtY(gutterRect, y);
    if (activeGutterRowElement && activeGutterRowElement !== gutterRowElement) {
      activeGutterRowElement.classList.remove('is-git-hover-empty');
    }
    activeGutterRowElement = gutterRowElement;
    const marker = hit instanceof Element ? hit.closest('.meo-git-gutter-marker') : null;
    const rowMarker = gutterRowElement?.querySelector?.('.meo-git-gutter-marker') ?? null;
    let changedMarker = isChangedMarker(rowMarker)
      ? rowMarker
      : isChangedMarker(marker)
        ? marker
        : null;
    if (!changedMarker && gutterRowElement instanceof HTMLElement) {
      const rawLineNumber = getRawLineNumberAtGutterRow(gutterRowElement);
      if (rawLineNumber !== null && isTrailingEofVisualLine(view.state.doc, rawLineNumber)) {
        const previousRowMarker = gutterRowElement.previousElementSibling?.querySelector?.('.meo-git-gutter-marker') ?? null;
        if (isChangedMarker(previousRowMarker)) {
          changedMarker = previousRowMarker;
        }
      }
    }
    if (changedMarker === activeMarkerElement) {
      if (activeGutterRowElement) {
        activeGutterRowElement.classList.toggle('is-git-hover-empty', !changedMarker);
      }
      return;
    }
    if (activeMarkerElement) {
      activeMarkerElement.classList.remove('is-hit-hover');
    }
    activeMarkerElement = changedMarker instanceof HTMLElement ? changedMarker : null;
    if (activeMarkerElement) {
      activeMarkerElement.classList.add('is-hit-hover');
    }
    if (activeGutterRowElement) {
      activeGutterRowElement.classList.toggle('is-git-hover-empty', !activeMarkerElement);
    }
  };

  const clearHoverTimer = () => {
    if (hoverTimer !== null) {
      window.clearTimeout(hoverTimer);
      hoverTimer = null;
    }
  };

  const hideTooltipOnly = () => {
    clearHoverTimer();
    pendingBlameLineNumber = 0;
    activeLineNumber = 0;
    hoverToken += 1;
    ui.root.hidden = true;
  };

  const hide = () => {
    hideTooltipOnly();
    clearMarkerHover();
  };

  const lineNumberAtClientY = (layout, clientY, gutterRowElement = null, markerElement = null) => {
    const viewAny = /** @type {any} */ (view);
    if (typeof viewAny.lineBlockAtHeight === 'function') {
      const rowRect = gutterRowElement instanceof HTMLElement ? gutterRowElement.getBoundingClientRect() : null;
      const probeY = rowRect ? (rowRect.top + rowRect.bottom) / 2 : clientY;
      const block = viewAny.lineBlockAtHeight(probeY - view.documentTop);
      if (block && Number.isFinite(block.from)) {
        const lineNumber = view.state.doc.lineAt(block.from).number;
        return normalizeTrailingEofVisualLineHit(view.state.doc, lineNumber, gutterRowElement, markerElement);
      }
    }

    const x = clamp(
      layout.contentRect.left + 4,
      layout.contentRect.left + 1,
      Math.max(layout.contentRect.left + 1, layout.contentRect.right - 1)
    );
    const pos = view.posAtCoords({ x, y: clientY });
    if (pos === null) {
      return {
        lineNumber: null,
        requestLineNumber: null,
        proxiedFromTrailingEof: false,
        effectiveChangeKind: null
      };
    }
    const lineNumber = view.state.doc.lineAt(pos).number;
    return normalizeTrailingEofVisualLineHit(view.state.doc, lineNumber, gutterRowElement, markerElement);
  };

  const getLineAnchorRect = (lineNumber, layout, gutterRowElement, clientY) => {
    const line = view.state.doc.line(lineNumber);
    const rowRect = gutterRowElement instanceof HTMLElement ? gutterRowElement.getBoundingClientRect() : null;
    const startCoords = view.coordsAtPos(line.from);
    const endCoords = view.coordsAtPos(line.to, -1) || view.coordsAtPos(line.to);

    const topCandidates = [
      startCoords?.top,
      endCoords?.top,
      rowRect?.top,
      clientY
    ].filter(Number.isFinite);
    const bottomCandidates = [
      startCoords?.bottom,
      endCoords?.bottom,
      rowRect?.bottom,
      clientY
    ].filter(Number.isFinite);

    const top = topCandidates.length ? Math.min(...topCandidates) : clientY;
    const bottom = bottomCandidates.length ? Math.max(...bottomCandidates) : clientY;

    return {
      left: layout.gutterRect.left,
      right: layout.gutterRect.right,
      top,
      bottom
    };
  };

  const triggerHover = (
    lineNumber,
    anchorRect,
    { proxiedFromTrailingEof = false, effectiveChangeKind = null, requestLineNumber = lineNumber } = {}
  ) => {
    if (destroyed || getMode?.() !== 'source' || lineNumber < 1) {
      hide();
      return;
    }

    clearHoverTimer();
    activeLineNumber = lineNumber;
    lastAnchorRect = anchorRect;
    const token = hoverToken + 1;
    hoverToken = token;
    hoverTimer = window.setTimeout(async () => {
      hoverTimer = null;
      if (destroyed || token !== hoverToken || activeLineNumber !== lineNumber || getMode?.() !== 'source') {
        return;
      }

      // Pure inserted lines should always show as uncommitted. The synthetic EOF row
      // is a proxy interaction though, so let the extension resolve history/mapping.
      if (!proxiedFromTrailingEof && effectiveChangeKind === 'added') {
        pendingBlameLineNumber = 0;
        renderBlameResult(ui, { kind: 'uncommitted' });
        if (lastAnchorRect) {
          positionTooltip(ui, lastAnchorRect);
        }
        return;
      }

      // Avoid showing a transient loading tooltip to reduce hover flicker.

      let result = null;
      pendingBlameLineNumber = lineNumber;
      try {
        result = await requestBlame?.({
          lineNumber: requestLineNumber
        });
      } catch {
        result = { kind: 'unavailable', reason: 'error' };
      }

      if (destroyed || token !== hoverToken || activeLineNumber !== lineNumber || getMode?.() !== 'source') {
        if (pendingBlameLineNumber === lineNumber) {
          pendingBlameLineNumber = 0;
        }
        return;
      }

      if (!shouldShowBlameTooltip(result)) {
        pendingBlameLineNumber = 0;
        ui.root.hidden = true;
        return;
      }
      renderBlameResult(ui, result);
      pendingBlameLineNumber = 0;
      if (lastAnchorRect) {
        positionTooltip(ui, lastAnchorRect);
      }
    }, hoverDelayMs);
  };

  const onMouseMove = (event) => {
    if (destroyed) {
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    const mode = getMode?.();
    if (mode !== 'source' || view.dom.classList.contains('meo-git-gutter-hidden')) {
      clearMarkerHover();
      if (!ui.root.contains(target)) {
        hideTooltipOnly();
      }
      return;
    }

    const layout = getGutterBandLayout();
    if (!layout) {
      if (!ui.root.contains(target)) {
        hide();
      }
      return;
    }

    if (!isWithinBand(layout, event.clientX, event.clientY)) {
      clearMarkerHover();
      if (!ui.root.contains(target)) {
        hideTooltipOnly();
      }
      return;
    }

    view.dom.classList.add('meo-git-hover-band');
    setBandCursor(true);
    updateMarkerHoverForY(layout.gutterRect, event.clientY);
    const hoveredGutterRowElement = activeGutterRowElement;
    const hoveredMarkerElement = activeMarkerElement;

    const hit = lineNumberAtClientY(layout, event.clientY, hoveredGutterRowElement, hoveredMarkerElement);
    const lineNumber = hit.lineNumber;
    if (lineNumber === null) {
      hide();
      return;
    }
    const requestLineNumber = (
      Number.isFinite(hit.requestLineNumber) ? hit.requestLineNumber : lineNumber
    );
    const effectiveChangeKind = (
      hit.effectiveChangeKind ??
      getMarkerChangeKind(hoveredMarkerElement)
    );
    const proxiedFromTrailingEof = hit.proxiedFromTrailingEof === true;
    const anchorRect = getLineAnchorRect(lineNumber, layout, hoveredGutterRowElement, event.clientY);

    if (lineNumber === activeLineNumber && (hoverTimer !== null || pendingBlameLineNumber === lineNumber)) {
      lastAnchorRect = anchorRect;
      if (!ui.root.hidden) {
        positionTooltip(ui, anchorRect);
      }
      return;
    }

    if (lineNumber === activeLineNumber && !ui.root.hidden) {
      lastAnchorRect = anchorRect;
      positionTooltip(ui, anchorRect);
      return;
    }

    triggerHover(lineNumber, anchorRect, { proxiedFromTrailingEof, effectiveChangeKind, requestLineNumber });
  };

  const onMouseLeave = (event) => {
    const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (nextTarget && ui.root.contains(nextTarget)) {
      return;
    }
    hide();
  };

  const onScroll = () => hide();
  const onPointerDown = () => hide();
  const pointerDownCapture = true;
  const onClick = (event) => {
    if (destroyed || getMode?.() !== 'source' || view.dom.classList.contains('meo-git-gutter-hidden')) {
      return;
    }
    if (event.button !== 0 || event.defaultPrevented) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.meo-md-fold-toggle')) {
      return;
    }

    const layout = getGutterBandLayout();
    if (!layout) {
      return;
    }
    if (!isWithinBand(layout, event.clientX, event.clientY)) {
      return;
    }

    const marker = getMarkerAtY(layout.gutterRect, event.clientY);

    const hoveredGutterRowElement = getGutterRowAtY(layout.gutterRect, event.clientY);
    const hit = lineNumberAtClientY(layout, event.clientY, hoveredGutterRowElement, marker);
    const lineNumber = hit.lineNumber;
    if (lineNumber === null) {
      return;
    }
    const requestLineNumber = (
      Number.isFinite(hit.requestLineNumber) ? hit.requestLineNumber : lineNumber
    );
    const effectiveChangeKind = (
      hit.effectiveChangeKind ??
      getMarkerChangeKind(marker)
    );
    const proxiedFromTrailingEof = hit.proxiedFromTrailingEof === true;

    event.preventDefault();
    event.stopPropagation();
    // Synthetic trailing EOF row clicks intentionally open history (revision), not
    // worktree diff, because the row is a visual proxy for the previous real line.
    if (proxiedFromTrailingEof) {
      void openRevisionForLine?.({ lineNumber: requestLineNumber });
      return;
    }
    if (effectiveChangeKind === 'added') {
      return;
    }
    if (effectiveChangeKind === 'modified') {
      void openWorktreeForLine?.({ lineNumber });
      return;
    }
    void openRevisionForLine?.({ lineNumber: requestLineNumber });
  };

  view.dom.addEventListener('mousemove', onMouseMove);
  view.dom.addEventListener('mouseleave', onMouseLeave);
  view.dom.addEventListener('mousedown', onPointerDown, pointerDownCapture);
  view.dom.addEventListener('click', onClick, true);
  view.scrollDOM.addEventListener('scroll', onScroll, { passive: true });

  return {
    hide,
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      hide();
      view.dom.removeEventListener('mousemove', onMouseMove);
      view.dom.removeEventListener('mouseleave', onMouseLeave);
      view.dom.removeEventListener('mousedown', onPointerDown, pointerDownCapture);
      view.dom.removeEventListener('click', onClick, true);
      view.scrollDOM.removeEventListener('scroll', onScroll);
      ui.root.remove();
    }
  };
}
