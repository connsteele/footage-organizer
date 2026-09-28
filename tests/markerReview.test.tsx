// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClipPreview } from '../src/client/ClipPreview';
import { MarkerReview } from '../src/client/MarkerReview';
import type { BatchClip } from '../src/shared/model';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('../src/client/api', () => ({ api: apiMock, errorText: (e: Error) => e.message }));
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  apiMock.mockResolvedValueOnce({ url: '/api/media/ticket' }).mockResolvedValueOnce({
    video: null,
    audio: [],
    markers: [{ seconds: 4, label: 'Original chapter', chapterIndex: 0 }],
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

function fixture(): BatchClip {
  return {
    id: 1,
    currentPath: 'Incoming/Clip.mp4',
    baseline: null,
    importIssue: null,
    original: {
      id: 1,
      source: { relativePath: 'Incoming/Clip.mp4' },
      duration: 12,
      markers: [{ id: 'chapter-1', seconds: 4, label: 'Original chapter', chapterIndex: 0 }],
      markerProposals: {
        schemaVersion: 1,
        items: [
          {
            markerId: 'chapter-1',
            originalLabel: 'Original chapter',
            seconds: 4,
            proposedLabel: 'Reviewed event',
            rationale: 'The visible event explains this name.',
          },
        ],
      },
      proposed: { folder: 'Filed', filename: 'Reviewed clip.mp4' },
      rationale: '',
      questions: [],
      hold: false,
    },
    proposed: { folder: 'Filed', filename: 'Reviewed clip.mp4' },
    held: false,
    applied: false,
    note: '',
    markerDecisions: [{ markerId: 'chapter-1', label: 'Reviewed event', status: 'pending' }],
  };
}
function Editor({ preview = false, locked = false, applied = false, initial = fixture() }) {
  const [clip, setClip] = useState(() => ({ ...initial, applied }));
  const onChange = (update: (clip: BatchClip) => void) =>
    setClip((previous) => {
      const next = structuredClone(previous);
      update(next);
      return next;
    });
  return preview ? (
    <ClipPreview
      prefix="/projects/test/batches/one"
      clipId={clip.id}
      markers={clip.original.markers}
      markerDecisions={clip.markerDecisions}
      review={{ clip, locked, onChange }}
      onExternal={vi.fn()}
    />
  ) : (
    <MarkerReview clip={clip} locked={locked} onChange={onChange} />
  );
}

it('compares New above Original with icon actions and reasoning available on demand', async () => {
  render(<Editor />);
  const user = userEvent.setup();
  const field = screen.getByRole('textbox', { name: 'New marker name chapter-1 for clip 1' });
  expect(
    field.compareDocumentPosition(screen.getByText('Original chapter')) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.getByText('Time:', { exact: false })).toBeTruthy();
  const accept = screen.getByRole('button', { name: 'Accept name for marker chapter-1' });
  expect(accept.textContent).toBe('');
  expect(accept.title).toBe('Accept name');
  const reason = screen.getByText('The visible event explains this name.');
  expect(reason.hidden).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Why this name for marker chapter-1?' }));
  expect(reason.hidden).toBe(false);
  await user.click(accept);
  expect(accept.getAttribute('aria-pressed')).toBe('true');
  await user.click(screen.getByRole('button', { name: 'Keep original for marker chapter-1' }));
  expect(screen.getByText(/Keeping original/)).toBeTruthy();
  expect((field as HTMLInputElement).value).toBe('Reviewed event');
  await user.click(screen.getByRole('button', { name: 'Reset marker chapter-1' }));
  expect(screen.getByText(/Needs review/)).toBeTruthy();
});

it('reviews and seeks inside Preview without remounting playback or duplicating original chapter ticks', async () => {
  render(<Editor preview />);
  const user = userEvent.setup();
  const seek = screen.getByRole('button', {
    name: 'Seek to marker chapter-1 at 00:04.000',
  }) as HTMLButtonElement;
  expect(seek.disabled).toBe(true);
  const player = (await screen.findByLabelText('Video for clip 001')) as HTMLVideoElement;
  Object.defineProperty(player, 'duration', { configurable: true, value: 12 });
  fireEvent.loadedMetadata(player);
  await user.click(seek);
  expect(player.currentTime).toBe(4);
  expect(player.paused).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Accept name for marker chapter-1' }));
  expect(screen.getAllByRole('button', { name: /^Jump to/ })).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Jump to 00:04.000: Reviewed event' })).toBeTruthy();
  expect(screen.getByLabelText('Video for clip 001')).toBe(player);
  expect(player.currentTime).toBe(4);
  expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Keep original for marker chapter-1' }));
  expect(screen.getByRole('button', { name: 'Jump to 00:04.000: Original chapter' })).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '  ' } });
  expect(
    (screen.getByRole('button', { name: 'Accept name for marker chapter-1' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  Object.defineProperty(player, 'duration', { configurable: true, value: 2 });
  fireEvent.durationChange(player);
  expect(seek.disabled).toBe(true);
});

it.each([
  { locked: true, applied: false },
  { locked: false, applied: true },
])('locks marker edits for %j', (props) => {
  render(<Editor {...props} />);
  expect((screen.getByRole('textbox') as HTMLInputElement).disabled).toBe(true);
  for (const name of [
    'Accept name for marker chapter-1',
    'Keep original for marker chapter-1',
    'Reset marker chapter-1',
  ]) {
    expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
  }
});

it('combines imported name review and playback-only chapters once, in time order', async () => {
  apiMock
    .mockReset()
    .mockResolvedValueOnce({ url: '/api/media/ticket' })
    .mockResolvedValueOnce({
      video: null,
      audio: [],
      markers: [
        { seconds: 0, label: 'Playback opening', chapterIndex: 0 },
        { seconds: 4, label: 'Original chapter', chapterIndex: 1 },
        { seconds: 9, label: 'Playback ending', chapterIndex: 2 },
      ],
    });
  const clip = fixture();
  clip.original.markers[0].chapterIndex = 1;
  clip.original.markers.push({ id: 'imported-1', seconds: 2, label: 'Imported note' });
  render(<Editor preview initial={clip} />);
  const user = userEvent.setup();
  const player = (await screen.findByLabelText('Video for clip 001')) as HTMLVideoElement;
  Object.defineProperty(player, 'duration', { configurable: true, value: 12 });
  fireEvent.loadedMetadata(player);
  const panel = within(screen.getByRole('region', { name: 'Markers for clip 001' }));
  expect(screen.queryByText('Marker list', { exact: true })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Marker names' })).toBeNull();
  const times = [
    ...screen.getByRole('region', { name: 'Markers for clip 001' }).querySelectorAll('time'),
  ];
  expect(times.map((time) => time.textContent?.replace('Time: ', ''))).toEqual([
    '00:00.000',
    '00:02.000',
    '00:04.000',
    '00:09.000',
  ]);
  await user.click(times[3]);
  expect(player.currentTime).toBe(9);
  await user.click(panel.getByRole('button', { name: 'Accept name for marker chapter-1' }));
  expect(panel.getAllByRole('textbox')).toHaveLength(2);
  expect(panel.getAllByText('Original chapter', { exact: true })).toHaveLength(1);
  expect(panel.queryByRole('button', { name: 'Time: 00:04.000 Original chapter' })).toBeNull();
  await user.click(screen.getByText('Markers', { exact: true }));
  await user.click(screen.getByText('Markers', { exact: true }));
  expect(
    panel
      .getByRole('button', { name: 'Accept name for marker chapter-1' })
      .getAttribute('aria-pressed'),
  ).toBe('true');
});

it('seeks from the review card with pointer or keyboard while keeping edit controls independent', async () => {
  const onSeek = vi.fn(),
    onChange = vi.fn();
  render(
    <MarkerReview
      clip={fixture()}
      locked={false}
      onChange={onChange}
      onSeek={onSeek}
      duration={12}
    />,
  );
  const user = userEvent.setup();
  const seek = screen.getByRole('button', { name: 'Seek to marker chapter-1 at 00:04.000' });
  expect(seek.textContent).toBe('');
  await user.click(screen.getByText('Original chapter', { exact: true }));
  expect(onSeek).toHaveBeenLastCalledWith(4);
  await user.click(seek.parentElement!);
  expect(onSeek).toHaveBeenCalledTimes(2);
  seek.focus();
  await user.keyboard('{Enter}');
  await user.keyboard(' ');
  expect(onSeek).toHaveBeenCalledTimes(4);
  onSeek.mockClear();
  await user.click(screen.getByText('New:', { exact: true }));
  await user.type(screen.getByRole('textbox'), ' extra words{Enter}');
  for (const name of [
    'Accept name for marker chapter-1',
    'Keep original for marker chapter-1',
    'Reset marker chapter-1',
    'Why this name for marker chapter-1?',
  ]) {
    await user.click(screen.getByRole('button', { name }));
  }
  expect(onChange).toHaveBeenCalled();
  expect(onSeek).not.toHaveBeenCalled();
});
