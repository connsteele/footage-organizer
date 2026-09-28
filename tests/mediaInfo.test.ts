import { expect, it } from 'vitest';
import { inspectMedia, parseMediaInfo } from '../src/server/mediaInfo';
import { markerTime, previewMarkers } from '../src/shared/media';

it('reads AV1 configuration, frame rate, audio codecs and chapter times', () => {
  expect(
    parseMediaInfo(
      {
        streams: [
          {
            codec_type: 'video',
            codec_name: 'av1',
            width: 3840,
            height: 2160,
            avg_frame_rate: '60000/1001',
            bit_rate: '20000000',
            extradata: '\n00000000: 810d 0c00 0a0f 0000 006a efbf e1bc 0219  .........j......\n',
          },
          { codec_type: 'audio', codec_name: 'flac' },
        ],
        chapters: [
          { start_time: '1.234', tags: { title: 'A moment' } },
          { start_time: '-1' },
          { start_time: 'NaN' },
        ],
      },
      'clip.mp4',
    ),
  ).toEqual({
    video: {
      codec: 'av1',
      width: 3840,
      height: 2160,
      framerate: 60000 / 1001,
      bitrate: 20000000,
      contentType: 'video/mp4; codecs="av01.0.13M.08"',
    },
    audio: ['flac'],
    markers: [{ id: 'embedded-1', chapterIndex: 0, seconds: 1.234, label: 'A moment' }],
    note: expect.stringContaining('partial list'),
  });
});

it('distinguishes AV1 10-bit high-tier from H.264 and does not guess unknown configurations', () => {
  const info = (codec_name: string, extradata?: string, file = 'clip.mp4') =>
    parseMediaInfo(
      {
        streams: [
          {
            codec_type: 'video',
            codec_name,
            extradata,
            avg_frame_rate: '0/0',
            bit_rate: 'N/A',
          },
        ],
      },
      file,
    ).video;
  expect(info('av1', '00000000: 810d cc00  ....')?.contentType).toContain('av01.0.13H.10');
  expect(info('h264', '00000000: 0164 0033  ....')?.contentType).toContain('avc1.640033');
  expect(info('av1')?.contentType).toBeUndefined();
  expect(info('h264', '00000000: 0164 0033  ....', 'clip.mkv')?.contentType).toBeUndefined();
  expect(info('unknown')).toMatchObject({ framerate: 0, bitrate: 0 });
  expect(parseMediaInfo({}, 'empty.mp4')).toEqual({ video: null, audio: [], markers: [] });
});

it('degrades gracefully when the optional probe is unavailable', async () => {
  expect(await inspectMedia('unused.mp4', 'missing-footage-organizer-ffprobe')).toMatchObject({
    video: null,
    markers: [],
    note: expect.stringContaining('Imported markers'),
  });
});

it('sorts and deduplicates imported/embedded markers without hiding different labels at one time', () => {
  expect(
    previewMarkers(
      [
        { seconds: 2, label: ' B ' },
        { seconds: 0, label: '' },
        { seconds: -1, label: 'bad' },
        { seconds: Infinity, label: 'bad' },
      ],
      [
        { seconds: 2.0001, label: 'B' },
        { seconds: 2, label: 'C' },
      ],
    ),
  ).toEqual([
    { seconds: 0, label: 'Unnamed marker' },
    { seconds: 2, label: 'B' },
    { seconds: 2, label: 'C' },
  ]);
  expect(markerTime(59.9999)).toBe('01:00.000');
  expect(markerTime(3600.125)).toBe('1:00:00.125');
});
