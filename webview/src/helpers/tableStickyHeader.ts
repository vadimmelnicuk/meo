/** Put the editable header outside the body's horizontal scroller so CSS can pin it. */
export function createStickyTableHeader(
  shell: HTMLElement,
  wrap: HTMLElement,
  header: HTMLTableSectionElement,
  columnCount: number
) {
  const band = document.createElement('div');
  band.className = 'meo-md-html-table-sticky-header';
  const viewport = document.createElement('div');
  viewport.className = 'meo-md-html-table-header-wrap';
  const table = document.createElement('table');
  table.className = 'meo-md-html-table';
  const columns = Array.from({ length: columnCount }, () => document.createElement('col'));
  const colgroup = document.createElement('colgroup');
  colgroup.append(...columns);
  table.append(colgroup, header);
  viewport.append(table);
  band.append(viewport);

  const syncFromBody = (): void => { viewport.scrollLeft = wrap.scrollLeft; };
  const syncFromHeader = (): void => { wrap.scrollLeft = viewport.scrollLeft; };
  wrap.addEventListener('scroll', syncFromBody, { passive: true });
  viewport.addEventListener('scroll', syncFromHeader, { passive: true });
  const observer = new ResizeObserver(() => {
    shell.style.setProperty('--meo-table-sticky-height', `${band.getBoundingClientRect().height}px`);
    syncFromBody();
  });
  observer.observe(band);
  return {
    band,
    table,
    columns,
    destroy(): void {
      observer.disconnect();
      wrap.removeEventListener('scroll', syncFromBody);
      viewport.removeEventListener('scroll', syncFromHeader);
    }
  };
}
