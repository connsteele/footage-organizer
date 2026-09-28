import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { open, statfs } from 'node:fs/promises';
import { z } from 'zod';
import type { MarkerChange } from '../shared/model.js';
import { AppError } from './paths.js';

const run = promisify(execFile);
const metadataSchema = z.object({
  streams: z.array(
    z.object({
      codec_type: z.string(),
      codec_name: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      sample_rate: z.string().optional(),
      channels: z.number().optional(),
      duration: z.string().optional(),
    }),
  ),
  chapters: z
    .array(
      z.object({
        start_time: z.string(),
        end_time: z.string(),
        tags: z.record(z.string(), z.string()).default({}),
      }),
    )
    .default([]),
});

/** Prepares and verifies a new container. Publishing/backups are journaled by Organizer. */
export class MarkerWriter {
  private available?: Promise<unknown>;
  constructor(
    private ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg',
    private ffprobe = process.env.FFPROBE_PATH || 'ffprobe',
  ) {}
  private async metadata(file: string) {
    const { stdout } = await run(
      this.ffprobe,
      ['-v', 'error', '-show_streams', '-show_chapters', '-of', 'json', '-i', file],
      { windowsHide: true, timeout: 10000, maxBuffer: 8 * 1024 * 1024 },
    );
    return metadataSchema.parse(JSON.parse(stdout));
  }
  async check(file: string, changes: MarkerChange[], size: number) {
    if (!['.mp4', '.m4v', '.mov', '.mkv'].includes(path.extname(file).toLowerCase()))
      throw new AppError(
        'Embedded marker writing supports MP4, M4V, MOV and MKV. Keep original names or export markers for other formats.',
      );
    this.available ??= run(this.ffmpeg, ['-version'], { windowsHide: true, timeout: 10000 }).catch(
      () => {
        this.available = undefined;
        throw new AppError(
          'FFmpeg is required to write accepted marker names. Configure ffmpegPath or FFMPEG_PATH.',
        );
      },
    );
    await this.available;
    const original = await this.metadata(file);
    for (const change of changes) {
      const chapter = original.chapters[change.chapterIndex];
      if (
        !chapter ||
        !Number.isFinite(Number(chapter.start_time)) ||
        Math.abs(Number(chapter.start_time) - change.seconds) > 0.000001 ||
        (chapter.tags.title ?? '') !== change.originalLabel
      )
        throw new AppError(
          `Marker ${change.markerId} no longer matches the embedded chapter. Request a fresh marker inventory.`,
        );
    }
    const space = await statfs(path.dirname(file));
    if (space.bavail * space.bsize < size + 64 * 1024 * 1024)
      throw new AppError(
        'Not enough free space to prepare the marker update while retaining the original footage.',
      );
    return original;
  }
  private async streamHashes(file: string) {
    // Copied packet payloads, not decoded/re-encoded frames. Chapter data changes intentionally.
    const { stdout } = await run(
      this.ffmpeg,
      [
        '-v',
        'error',
        '-i',
        file,
        '-map',
        '0',
        '-map',
        '-0:d?',
        '-c',
        'copy',
        '-f',
        'streamhash',
        '-hash',
        'sha256',
        '-',
      ],
      { windowsHide: true, timeout: 1800000, maxBuffer: 1024 * 1024 },
    );
    return stdout.trim();
  }
  async prepare(source: string, output: string, changes: MarkerChange[], size: number) {
    const original = await this.check(source, changes, size);
    const args = [
      '-v',
      'error',
      '-nostdin',
      '-i',
      source,
      '-map',
      '0',
      '-map_metadata',
      '0',
      '-map_chapters',
      '0',
      '-c',
      'copy',
    ];
    for (const change of changes)
      args.push(`-metadata:c:${change.chapterIndex}`, `title=${change.label}`);
    if (path.extname(output).toLowerCase() !== '.mkv') args.push('-movflags', '+faststart');
    args.push('-n', output);
    await run(this.ffmpeg, args, { windowsHide: true, timeout: 1800000, maxBuffer: 1024 * 1024 });
    const result = await this.metadata(output);
    const sameTime = (a: string, b: string) =>
      Number.isFinite(Number(a)) &&
      Number.isFinite(Number(b)) &&
      Math.abs(Number(a) - Number(b)) <= 0.001;
    if (
      result.chapters.length !== original.chapters.length ||
      original.chapters.some((chapter, index) => {
        const next = result.chapters[index],
          change = changes.find((c) => c.chapterIndex === index);
        return (
          !sameTime(chapter.start_time, next.start_time) ||
          !sameTime(chapter.end_time, next.end_time) ||
          (next.tags.title ?? '') !== (change?.label ?? chapter.tags.title ?? '')
        );
      })
    )
      throw new AppError(
        'Rewritten chapter names or timing did not verify. The original file was preserved.',
      );
    const streams = (data: typeof original) => data.streams.filter((s) => s.codec_type !== 'data');
    const before = streams(original),
      after = streams(result);
    if (
      before.length !== after.length ||
      before.some((s, i) => {
        const next = after[i];
        return (
          s.codec_type !== next.codec_type ||
          s.codec_name !== next.codec_name ||
          s.width !== next.width ||
          s.height !== next.height ||
          s.sample_rate !== next.sample_rate ||
          s.channels !== next.channels ||
          (s.duration && next.duration && !sameTime(s.duration, next.duration))
        );
      })
    )
      throw new AppError(
        'Rewritten media streams did not verify. The original file was preserved.',
      );
    if ((await this.streamHashes(source)) !== (await this.streamHashes(output)))
      throw new AppError(
        'Copied media packet hashes did not match. The original file was preserved.',
      );
    const handle = await open(output, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}
