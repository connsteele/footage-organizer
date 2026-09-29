// @vitest-environment jsdom
import { useRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useShuttlePlayback } from '../src/client/useShuttlePlayback';

let paused = true;
let time = 0;
let nextFrame = 0;
const frames = new Map<number, FrameRequestCallback>();
beforeEach(() => {
  paused = true;
  time = 0;
  frames.clear();
  vi.spyOn(performance, 'now').mockImplementation(() => time);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(() => paused);
  vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(60);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    paused = false;
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    if (!paused) {
      paused = true;
      this.dispatchEvent(new Event('pause'));
    }
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function Harness({ ready = true }: { ready?: boolean }) {
  const player = useRef<HTMLVideoElement>(null);
  const result = useShuttlePlayback(player, '/video', ready);
  return (
    <>
      <video ref={player} aria-label="Player" />
      <output>{result.speed}</output>
      <p>{result.error}</p>
      <input aria-label="Name" />
      <textarea aria-label="Note" />
      <select aria-label="Choice">
        <option>A</option>
      </select>
      <div contentEditable suppressContentEditableWarning aria-label="Editable">
        text
      </div>
    </>
  );
}
const key = (key: string, extra: KeyboardEventInit = {}) =>
  fireEvent.keyDown(document, { key, ...extra });
const speed = () => Number(screen.getByRole('status').textContent);
function advance(ms: number) {
  act(() => {
    time += ms;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(time));
  });
}

it('shuttles in speed steps, slows with the opposite key, pauses with K and caps repeated taps', () => {
  render(<Harness />);
  const player = screen.getByLabelText('Player') as HTMLVideoElement;
  player.currentTime = 30;
  key('l');
  expect(speed()).toBe(1);
  expect(paused).toBe(false);
  key('l');
  key('l');
  expect(speed()).toBe(4);
  expect(player.playbackRate).toBe(4);
  key('j');
  expect(speed()).toBe(2);
  key('j');
  expect(speed()).toBe(1);
  key('j');
  expect(speed()).toBe(0);
  expect(paused).toBe(true);
  key('j');
  expect(speed()).toBe(-1);
  key('j');
  expect(speed()).toBe(-2);
  key('l');
  expect(speed()).toBe(-1);
  key('l');
  expect(speed()).toBe(0);
  key('l');
  expect(speed()).toBe(1);
  for (let i = 0; i < 12; i++) key('l');
  expect(speed()).toBe(16);
  key('k');
  expect(speed()).toBe(0);
  expect(player.playbackRate).toBe(1);
  key('j');
  expect(speed()).toBe(-1);
  for (let i = 0; i < 12; i++) key('j');
  expect(speed()).toBe(-16);
});

it('rewinds silently, waits for outstanding seeks and stops at the start or on cleanup', () => {
  const { unmount } = render(<Harness />);
  const player = screen.getByLabelText('Player') as HTMLVideoElement;
  player.currentTime = 3;
  key('j');
  key('j');
  advance(100);
  expect(player.currentTime).toBeCloseTo(2.8);
  expect(paused).toBe(true);
  Object.defineProperty(player, 'seeking', { configurable: true, value: true });
  advance(100);
  expect(player.currentTime).toBeCloseTo(2.8);
  Object.defineProperty(player, 'seeking', { configurable: true, value: false });
  player.currentTime = 0.1;
  advance(100);
  expect(player.currentTime).toBe(0);
  expect(speed()).toBe(0);
  expect(frames.size).toBe(0);
  player.currentTime = 20;
  key('j');
  unmount();
  advance(200);
  expect(player.currentTime).toBe(20);
  expect(frames.size).toBe(0);
  const playCalls = vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length;
  key('l');
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(playCalls);
});

it('ignores held keys, modifiers, composition, editable fields, selection menus and dialogs', () => {
  render(<Harness />);
  for (const extra of [
    { repeat: true },
    { ctrlKey: true },
    { altKey: true },
    { metaKey: true },
    { shiftKey: true },
    { isComposing: true },
  ])
    key('l', extra);
  for (const label of ['Name', 'Note', 'Choice', 'Editable']) {
    const field = screen.getByLabelText(label);
    field.focus();
    fireEvent.keyDown(field, { key: 'l' });
    field.blur();
  }
  const dialog = document.createElement('dialog');
  dialog.open = true;
  document.body.append(dialog);
  key('l');
  dialog.remove();
  expect(speed()).toBe(0);
  expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  key('L');
  expect(speed()).toBe(1);
  key('l', { repeat: true });
  expect(speed()).toBe(1);
});

it('follows native player controls and stops when playback ends or becomes unavailable', () => {
  const { rerender } = render(<Harness />);
  const player = screen.getByLabelText('Player') as HTMLVideoElement;
  key('l');
  key('l');
  act(() => player.pause());
  expect(speed()).toBe(0);
  expect(player.playbackRate).toBe(1);
  act(() => {
    player.playbackRate = 2;
    void player.play();
  });
  expect(speed()).toBe(2);
  fireEvent.ended(player);
  expect(speed()).toBe(0);
  player.currentTime = 60;
  key('l');
  expect(player.currentTime).toBe(0);
  key('k');
  player.currentTime = 30;
  key('j');
  act(() => {
    void player.play();
  });
  expect(speed()).toBe(1);
  expect(frames.size).toBe(0);
  rerender(<Harness ready={false} />);
  key('l');
  expect(paused).toBe(true);
  expect(speed()).toBe(0);
});

it('handles rejected playback without stale requests cancelling a newer rewind', async () => {
  render(<Harness />);
  const player = screen.getByLabelText('Player') as HTMLVideoElement;
  player.currentTime = 30;
  let reject!: (reason: Error) => void;
  vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(
    () =>
      new Promise((_ok, fail) => {
        reject = fail;
      }),
  );
  key('l');
  key('k');
  key('j');
  await act(async () => reject(new DOMException('interrupted', 'AbortError')));
  expect(speed()).toBe(-1);
  expect(screen.queryByText(/could not start/)).toBeNull();
  key('k');
  vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error('unsupported'));
  await act(async () => key('l'));
  expect(speed()).toBe(0);
  expect(screen.getByText(/could not start/)).toBeTruthy();
});
