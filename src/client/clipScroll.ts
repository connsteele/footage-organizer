// Center the requested panel with its clip heading when they fit. For tall rows,
// favor the opened content instead of centering a block taller than the viewport.
export function centerExpandedClip(row: HTMLElement, panel: HTMLElement) {
  const bar = document.querySelector<HTMLElement>('[data-review-actions]');
  const bottom = window.innerHeight - (bar?.getBoundingClientRect().height || 0) - 20;
  const top = 20;
  const room = Math.max(100, bottom - top);
  const rowBox = row.getBoundingClientRect();
  const panelBox = panel.getBoundingClientRect();
  const combinedHeight = panelBox.bottom - rowBox.top;
  const start = combinedHeight <= room ? rowBox.top : panelBox.top;
  const height = combinedHeight <= room ? combinedHeight : panelBox.height;
  const target = height <= room ? top + (room - height) / 2 : top;
  window.scrollBy({
    top: start - target,
    behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ? 'instant'
      : 'smooth',
  });
}
