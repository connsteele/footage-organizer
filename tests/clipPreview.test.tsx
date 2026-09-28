// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClipPreview } from '../src/client/ClipPreview';
import type { MediaInfo } from '../src/shared/media';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('../src/client/api', () => ({ api: apiMock, errorText: (e: Error) => e.message }));
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});
const embedded: MediaInfo = {
  video: null,
  audio: [],
  markers: [
    { seconds: 4, label: 'Embedded chapter' },
    { seconds: 2, label: 'Imported marker' },
  ],
};
async function setup(info: Promise<MediaInfo> = Promise.resolve(embedded)) {
  apiMock.mockResolvedValueOnce({ url: '/api/media/ticket' }).mockReturnValueOnce(info);
  const result = render(
    <ClipPreview
      prefix="/projects/test/batches/one"
      clipId={1}
      markers={[
        { seconds: 2, label: 'Imported marker' },
        { seconds: 90, label: 'Wrong timestamp' },
      ]}
      onExternal={vi.fn()}
    />,
  );
  const player = (await screen.findByLabelText('Video for clip 001')) as HTMLVideoElement;
  Object.defineProperty(player, 'duration', { configurable: true, value: 10 });
  fireEvent.loadedMetadata(player);
  return { ...result, player, user: userEvent.setup() };
}

it('merges marker sources, seeks without autoplay, and keeps out-of-range markers off the timeline', async () => {
  const { player, user } = await setup();
  const marker = await screen.findByRole('button', { name: 'Jump to 00:02.000: Imported marker' });
  expect(
    screen.getAllByRole('button', { name: 'Jump to 00:02.000: Imported marker' }),
  ).toHaveLength(1);
  await user.click(marker);
  expect(player.currentTime).toBe(2);
  expect(player.autoplay).toBe(false);
  expect(player.paused).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Jump to 00:04.000: Embedded chapter' }));
  expect(player.currentTime).toBe(4);
  expect(screen.queryByRole('button', { name: /Jump to .*Wrong timestamp/ })).toBeNull();
  fireEvent.change(screen.getByRole('slider'), { target: { value: '8.5' } });
  expect(player.currentTime).toBe(8.5);
  expect(screen.getByText('Markers', { exact: true }).closest('details')?.open).toBe(true);
  expect(
    (screen.getByRole('button', { name: /Wrong timestamp/ }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

it('keeps Markers collapsed while playback and optional metadata update', async () => {
  let resolve!: (info: MediaInfo) => void;
  const { player, user } = await setup(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const toggle = screen.getByText('Markers', { exact: true });
  await user.click(toggle);
  expect(toggle.closest('details')?.open).toBe(false);
  fireEvent.timeUpdate(player);
  resolve(embedded);
  await screen.findByRole('button', { name: 'Jump to 00:04.000: Embedded chapter' });
  expect(toggle.closest('details')?.open).toBe(false);
  await user.click(toggle);
  expect(toggle.closest('details')?.open).toBe(true);
  expect(screen.getByRole('button', { name: 'Time: 00:04.000 Embedded chapter' })).toBeTruthy();
});

it('plays independently of metadata loading/failure and releases the player on close', async () => {
  let reject!: (error: Error) => void;
  const { player, unmount } = await setup(
    new Promise((_resolve, fail) => {
      reject = fail;
    }),
  );
  expect(player.getAttribute('src')).toBe('/api/media/ticket');
  expect(screen.getByRole('button', { name: 'Jump to 00:02.000: Imported marker' })).toBeTruthy();
  reject(new Error('metadata unavailable'));
  await waitFor(() =>
    expect(screen.getAllByText(/Embedded markers could not be loaded/).length).toBeGreaterThan(0),
  );
  expect(screen.queryByRole('alert')).toBeNull();
  unmount();
  expect(player.getAttribute('src')).toBeNull();
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
});

it('treats decoding efficiency as an estimate and handles capability API failure', async () => {
  const decodingInfo = vi.fn().mockRejectedValue(new Error('unavailable'));
  Object.defineProperty(navigator, 'mediaCapabilities', {
    configurable: true,
    value: { decodingInfo },
  });
  const { user } = await setup(
    Promise.resolve({
      ...embedded,
      video: {
        codec: 'av1',
        width: 3840,
        height: 2160,
        bitrate: 20000000,
        framerate: 60,
        contentType: 'video/mp4; codecs="av01.0.13M.08"',
      },
    }),
  );
  await user.click(screen.getByText('Playback info', { exact: true }));
  await waitFor(() => expect(decodingInfo).toHaveBeenCalledOnce());
  expect(screen.getByText(/not confirmation that the GPU/).textContent).toContain(
    'has not reported',
  );
  expect(screen.queryByRole('alert')).toBeNull();
  Reflect.deleteProperty(navigator, 'mediaCapabilities');
});

it('does not enable seeking with an unknown or infinite duration', async () => {
  const { player } = await setup();
  Object.defineProperty(player, 'duration', { configurable: true, value: Infinity });
  fireEvent.durationChange(player);
  expect((screen.getByRole('slider') as HTMLInputElement).disabled).toBe(true);
  expect(screen.queryByRole('button', { name: /Jump to/ })).toBeNull();
});
