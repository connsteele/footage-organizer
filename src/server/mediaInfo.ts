import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { z } from 'zod';
import type { MediaInfo } from '../shared/media.js';

const exec = promisify(execFile);
const probeSchema = z.object({
  streams: z
    .array(
      z.object({
        codec_type: z.string().optional(),
        codec_name: z.string().optional(),
        codec_tag_string: z.string().optional(),
        extradata: z.string().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
        avg_frame_rate: z.string().optional(),
        bit_rate: z.string().optional(),
      }),
    )
    .default([]),
  chapters: z
    .array(
      z.object({
        start_time: z.string(),
        tags: z.object({ title: z.string().optional() }).optional(),
      }),
    )
    .default([]),
});

export function parseMediaInfo(raw: unknown, file: string): MediaInfo {
  const data = probeSchema.parse(raw);
  const stream = data.streams.find((s) => s.codec_type === 'video');
  let video: MediaInfo['video'] = null;
  if (stream) {
    const [numerator, denominator = 1] = (stream.avg_frame_rate || '').split('/').map(Number);
    const positive = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
    const bytes = Buffer.from(
      (stream.extradata || '')
        .split('\n')
        .flatMap((line) => {
          const hex = line.match(/^[0-9a-f]+:\s+([0-9a-f ]+?)\s{2}/i)?.[1];
          return hex ? hex.replaceAll(' ', '') : [];
        })
        .join(''),
      'hex',
    );
    let codec: string | undefined;
    // RFC 6381 identifiers from the actual codec configuration, not guessed profiles.
    if (stream.codec_name === 'av1' && bytes.length >= 4 && bytes[0] === 0x81) {
      const depth = bytes[2] & 0x40 ? (bytes[2] & 0x20 ? 12 : 10) : 8;
      codec = `av01.${bytes[1] >> 5}.${String(bytes[1] & 31).padStart(2, '0')}${bytes[2] & 0x80 ? 'H' : 'M'}.${String(depth).padStart(2, '0')}`;
    } else if (stream.codec_name === 'h264' && bytes.length >= 4 && bytes[0] === 1) {
      codec = `${stream.codec_tag_string === 'avc3' ? 'avc3' : 'avc1'}.${bytes.subarray(1, 4).toString('hex')}`;
    }
    const mp4 = ['.mp4', '.m4v'].includes(path.extname(file).toLowerCase());
    video = {
      codec: stream.codec_name || 'Unknown',
      width: positive(stream.width || 0),
      height: positive(stream.height || 0),
      framerate: positive(numerator / denominator),
      bitrate: positive(Number(stream.bit_rate)),
      ...(mp4 && codec ? { contentType: `video/mp4; codecs="${codec}"` } : {}),
    };
  }
  return {
    video,
    audio: [
      ...new Set(
        data.streams.filter((s) => s.codec_type === 'audio').map((s) => s.codec_name || 'Unknown'),
      ),
    ],
    markers: data.chapters
      .slice(0, 10000)
      .map((chapter, index) => ({
        id: `embedded-${index + 1}`,
        chapterIndex: index,
        seconds: Number(chapter.start_time),
        label: chapter.tags?.title?.slice(0, 4000) ?? '',
      }))
      .filter((m) => Number.isFinite(m.seconds) && m.seconds >= 0),
    ...(data.chapters.length > 10000 ||
    data.chapters.some(
      (c) =>
        (c.tags?.title?.length ?? 0) > 4000 ||
        !Number.isFinite(Number(c.start_time)) ||
        Number(c.start_time) < 0,
    )
      ? {
          note: 'Some chapter information exceeded the supported limits or was invalid. Do not use this partial list for marker rewriting.',
        }
      : {}),
  };
}

export async function inspectMedia(
  file: string,
  ffprobePath = process.env.FFPROBE_PATH || 'ffprobe',
): Promise<MediaInfo> {
  try {
    const { stdout } = await exec(
      ffprobePath,
      [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_type,codec_name,codec_tag_string,extradata,width,height,avg_frame_rate,bit_rate:chapter=start_time:chapter_tags=title',
        '-show_data',
        '-of',
        'json',
        '-i',
        file,
      ],
      { windowsHide: true, timeout: 10000, maxBuffer: 2 * 1024 * 1024 },
    );
    return parseMediaInfo(JSON.parse(stdout), file);
  } catch {
    return {
      video: null,
      audio: [],
      markers: [],
      note: 'Embedded markers and codec details could not be read. Imported markers and video playback are still available.',
    };
  }
}
