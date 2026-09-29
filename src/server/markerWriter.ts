import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { open, statfs, writeFile, unlink } from 'node:fs/promises';
import { z } from 'zod';
import type { MarkerChange } from '../shared/model.js';
import { AppError } from './paths.js';
import { useNeroChapters } from './mp4Chapters.js';

const run = promisify(execFile);
const metadataSchema = z.object({
  format: z.object({ duration: z.string().optional() }).optional(),
  streams: z.array(
    z.object({
      codec_type: z.string(),
      index: z.number().optional(),
      codec_tag_string: z.string().optional(),
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
      ['-v', 'error', '-show_streams', '-show_chapters', '-show_format', '-of', 'json', '-i', file],
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
          'FFmpeg is required to write marker changes. Configure ffmpegPath or FFMPEG_PATH.',
        );
      },
    );
    await this.available;
    const original = await this.metadata(file);
    const changedChapters = new Set<number>();
    for (const change of changes) {
      if (change.action === 'add') {
        const duration = Number(original.format?.duration);
        if (!Number.isFinite(duration) || change.seconds >= duration || !change.label.trim())
          throw new AppError(
            'New markers must have a name and a time before the actual end of the clip.',
          );
        continue;
      }
      if (change.chapterIndex === undefined || changedChapters.has(change.chapterIndex))
        throw new AppError('Each marker change must identify a unique embedded chapter.');
      changedChapters.add(change.chapterIndex);
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
    this.chapters(original, changes);
    const space = await statfs(path.dirname(file));
    if (space.bavail * space.bsize < size + 64 * 1024 * 1024)
      throw new AppError(
        'Not enough free space to prepare the marker update while retaining the original footage.',
      );
    return original;
  }
  private chapters(original: z.infer<typeof metadataSchema>, changes: MarkerChange[]) {
    const byIndex = new Map(
      changes.filter((c) => c.action !== 'add').map((c) => [c.chapterIndex, c]),
    );
    const chapters = original.chapters.flatMap((chapter, index) => {
      const change = byIndex.get(index);
      return change?.action === 'delete'
        ? []
        : [
            {
              start: Number(chapter.start_time),
              end: Number(chapter.end_time),
              tags: { ...chapter.tags, title: change?.label ?? chapter.tags.title ?? '' },
            },
          ];
    });
    for (const change of changes.filter((c) => c.action === 'add')) {
      if (chapters.some((c) => Math.abs(c.start - change.seconds) < 0.001))
        throw new AppError(
          'A chapter already exists at the new marker time. Choose a different time.',
        );
      chapters.push({
        start: change.seconds,
        end: Number(original.format?.duration),
        tags: { title: change.label },
      });
    }
    chapters.sort((a, b) => a.start - b.start);
    return chapters.map((chapter, index) => ({
      ...chapter,
      end: chapters[index + 1]?.start ?? chapter.end,
    }));
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
    const chapters = this.chapters(original, changes);
    const metadataFile = `${output}.ffmeta`;
    const escape = (value: string) =>
      value.replace(/\\/g, '\\\\').replace(/[=;#\n\r]/g, (char) => `\\${char}`);
    const metadata = [
      ';FFMETADATA1',
      ...chapters.flatMap((c) => [
        '[CHAPTER]',
        'TIMEBASE=1/1000000',
        `START=${Math.round(c.start * 1e6)}`,
        `END=${Math.round(c.end * 1e6)}`,
        ...Object.entries(c.tags).map(([key, value]) => `${escape(key)}=${escape(value)}`),
      ]),
      '',
    ].join('\n');
    const args = [
      '-v',
      'error',
      '-nostdin',
      '-i',
      source,
      '-f',
      'ffmetadata',
      '-i',
      metadataFile,
      '-map',
      '0',
      '-map_metadata',
      '0',
      '-map_chapters',
      '1',
      '-c',
      'copy',
    ];
    // Replace QuickTime's chapter text track rather than copying stale chapter data.
    // Other data streams remain mapped; audio/video/subtitle packets are verified below.
    for (const stream of original.streams)
      if (
        original.chapters.length &&
        stream.codec_type === 'data' &&
        stream.codec_tag_string === 'text' &&
        stream.index !== undefined
      )
        args.push('-map', `-0:${stream.index}`);
    if (path.extname(output).toLowerCase() !== '.mkv') args.push('-movflags', '+faststart');
    args.push('-n', output);
    await writeFile(metadataFile, metadata, { flag: 'wx' });
    try {
      await run(this.ffmpeg, args, { windowsHide: true, timeout: 1800000, maxBuffer: 1024 * 1024 });
    } finally {
      await unlink(metadataFile);
    }
    let result = await this.metadata(output);
    if (
      path.extname(output).toLowerCase() !== '.mkv' &&
      chapters[0]?.start > 0 &&
      Number(result.chapters[0]?.start_time) === 0
    ) {
      if (
        chapters.length > 255 ||
        chapters.some((c) => Buffer.byteLength(c.tags.title, 'utf8') > 255)
      )
        throw new AppError(
          'A first MP4 chapter after time zero supports up to 255 chapters with names up to 255 UTF-8 bytes. Shorten names, use fewer chapters, or keep additions export-only. The original is preserved.',
        );
      await useNeroChapters(output);
      result = await this.metadata(output);
    }
    const sameTime = (a: string, b: string) =>
      Number.isFinite(Number(a)) &&
      Number.isFinite(Number(b)) &&
      Math.abs(Number(a) - Number(b)) <= 0.001;
    if (
      result.chapters.length !== chapters.length ||
      chapters.some((chapter, index) => {
        const next = result.chapters[index];
        return (
          !sameTime(String(chapter.start), next.start_time) ||
          !sameTime(String(chapter.end), next.end_time) ||
          (next.tags.title ?? '') !== chapter.tags.title
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
