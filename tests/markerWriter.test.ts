import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { loadConfig } from '../src/server/config';
import { within } from '../src/server/paths';
import { MarkerWriter } from '../src/server/markerWriter';
import { useNeroChapters } from '../src/server/mp4Chapters';
import type { MarkerChange } from '../src/shared/model';

const run = promisify(execFile);
const config = await loadConfig();
const ffmpegPath = config.ffmpegPath || 'ffmpeg',
  ffprobePath = config.ffprobePath || 'ffprobe';
const scratch = path.resolve(
  process.env.FO_TEST_DIR || path.join(config.tempDir, 'footage-organizer-tests'),
);
await mkdir(scratch, { recursive: true });
const root = await mkdtemp(path.join(scratch, 'chapter-writer-'));
const options = {
  windowsHide: true,
  timeout: 60000,
  env: { ...process.env, TEMP: config.tempDir, TMP: config.tempDir },
};
const available = await Promise.all(
  [ffmpegPath, ffprobePath].map((bin) =>
    run(bin, ['-version'], options).then(
      () => true,
      () => false,
    ),
  ),
);
const writer = new MarkerWriter(config.ffmpegPath, config.ffprobePath);
const plain = path.join(root, 'plain.mp4');
const ffmpeg = (args: string[]) => run(ffmpegPath, ['-v', 'error', '-nostdin', ...args], options);
async function chapters(file: string) {
  const result = await run(
    ffprobePath,
    ['-v', 'error', '-show_chapters', '-of', 'json', file],
    options,
  );
  return (
    JSON.parse(result.stdout).chapters as { start_time: string; tags: { title: string } }[]
  ).map((c) => ({ seconds: Number(c.start_time), label: c.tags.title }));
}
afterAll(async () => {
  if (!within(scratch, root) || root === scratch) throw new Error('Unsafe test cleanup path');
  await rm(root, { recursive: true, force: true });
});

describe.skipIf(available.includes(false))(
  'verified embedded marker writes with real generated media',
  () => {
    beforeAll(async () => {
      await ffmpeg([
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=160x90:rate=10',
        '-f',
        'lavfi',
        '-i',
        'sine=sample_rate=48000',
        '-t',
        '4',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-n',
        plain,
      ]);
      await writeFile(
        path.join(root, 'chapters.ffmeta'),
        ';FFMETADATA1\n' +
          [0, 1, 3]
            .map(
              (start, index) =>
                `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${start * 1000}\nEND=${[1, 3, 4][index] * 1000}\ntitle=Event ${index}\n`,
            )
            .join(''),
      );
      for (const ext of ['mp4', 'mkv'])
        await ffmpeg([
          '-i',
          plain,
          '-i',
          path.join(root, 'chapters.ffmeta'),
          '-map',
          '0',
          '-map_metadata',
          '0',
          '-map_chapters',
          '1',
          '-c',
          'copy',
          '-n',
          path.join(root, `marked.${ext}`),
        ]);
    }, 60000);

    it.each(['mp4', 'mkv'])(
      'deletes the first chapter, adds and renames without shifting surviving timestamps (%s)',
      async (ext) => {
        const source = path.join(root, `marked.${ext}`),
          output = path.join(root, `edited.${ext}`);
        const before = await readFile(source);
        const changes: MarkerChange[] = [
          {
            markerId: 'first',
            chapterIndex: 0,
            seconds: 0,
            originalLabel: 'Event 0',
            label: 'Event 0',
            action: 'delete',
          },
          {
            markerId: 'middle',
            chapterIndex: 1,
            seconds: 1,
            originalLabel: 'Event 1',
            label: 'Reviewed middle',
          },
          {
            markerId: 'new',
            seconds: 2,
            originalLabel: '',
            label: 'Café #1 = event; \\ new',
            action: 'add',
          },
        ];
        await writer.prepare(source, output, changes, before.length);
        expect(await chapters(output)).toEqual([
          { seconds: 1, label: 'Reviewed middle' },
          { seconds: 2, label: 'Café #1 = event; \\ new' },
          { seconds: 3, label: 'Event 2' },
        ]);
        expect(await readFile(source)).toEqual(before);
        await expect(stat(`${output}.ffmeta`)).rejects.toMatchObject({ code: 'ENOENT' });
      },
      60000,
    );

    it('deletes every embedded chapter without retaining a hidden chapter track', async () => {
      const source = path.join(root, 'marked.mp4'),
        output = path.join(root, 'empty.mp4');
      await writer.prepare(
        source,
        output,
        [0, 1, 3].map((seconds, chapterIndex) => ({
          markerId: `m${chapterIndex}`,
          chapterIndex,
          seconds,
          originalLabel: `Event ${chapterIndex}`,
          label: '',
          action: 'delete',
        })),
        (await stat(source)).size,
      );
      expect(await chapters(output)).toEqual([]);
    }, 60000);

    it('adds a first chapter after zero to footage with no chapters and rejects duplicate/end times', async () => {
      const output = path.join(root, 'first-added.mp4');
      const change: MarkerChange = {
        markerId: 'new',
        action: 'add',
        seconds: 2,
        label: 'New event',
        originalLabel: '',
      };
      const size = (await stat(plain)).size;
      await writer.prepare(plain, output, [change], size);
      expect(await chapters(output)).toEqual([{ seconds: 2, label: 'New event' }]);
      await expect(
        writer.check(plain, [change, { ...change, markerId: 'duplicate' }], size),
      ).rejects.toThrow('already exists');
      await expect(writer.check(plain, [{ ...change, seconds: 4 }], size)).rejects.toThrow(
        'before the actual end',
      );
    }, 60000);
  },
);

it('refuses malformed MP4 atom bounds without writing into media data', async () => {
  for (const size of [4, 1000]) {
    const file = path.join(root, `bad-${size}.mp4`);
    const bytes = Buffer.alloc(16);
    bytes.writeUInt32BE(size);
    bytes.write('moov', 4);
    await writeFile(file, bytes);
    await expect(useNeroChapters(file)).rejects.toThrow('bounds');
    expect(await readFile(file)).toEqual(bytes);
  }
});
