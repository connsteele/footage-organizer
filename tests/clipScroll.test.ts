// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { centerExpandedClip } from '../src/client/clipScroll';
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
function fixture(rowTop: number, panelTop: number, panelHeight: number) {
  const row = document.createElement('article');
  const panel = document.createElement('section');
  const bar = document.createElement('div');
  bar.setAttribute('data-review-actions', '');
  document.body.append(row, panel, bar);
  vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ top: rowTop } as DOMRect);
  vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
    top: panelTop,
    height: panelHeight,
    bottom: panelTop + panelHeight,
  } as DOMRect);
  vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({ height: 100 } as DOMRect);
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(1000);
  const scroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
  return { row, panel, scroll };
}
it('centers the heading and preview above the action bar', () => {
  const { row, panel, scroll } = fixture(700, 800, 400);
  centerExpandedClip(row, panel);
  expect(scroll).toHaveBeenCalledWith({ top: 500, behavior: 'smooth' });
});
it('aligns oversized details to the top so their beginning is not cut off', () => {
  const { row, panel, scroll } = fixture(0, 600, 1200);
  centerExpandedClip(row, panel);
  expect(scroll).toHaveBeenCalledWith({ top: 580, behavior: 'smooth' });
});
it('respects reduced motion', () => {
  const { row, panel, scroll } = fixture(700, 800, 400);
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({ matches: true }),
  });
  centerExpandedClip(row, panel);
  expect(scroll).toHaveBeenCalledWith({ top: 500, behavior: 'instant' });
  Reflect.deleteProperty(window, 'matchMedia');
});
