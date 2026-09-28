import path from 'node:path';
import { constants } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { errorCode, fingerprint, safePath, within } from '../src/server/paths.js';
import type { Handoff } from '../src/shared/model.js';

const run = promisify(execFile);
export const practiceBatchId = 'feature-tour-v2';
export const practiceReviewFolder = 'Feature tour v2/Review';
const filed = 'Feature tour v2/Filed';
export function practiceHandoff(startId = 1): Handoff {
  const examples = [
    {
      group: '01 Rename only',
      source: 'Original name - click to edit.mp4',
      name: 'Clear name - same folder.mp4',
      destination: `${practiceReviewFolder}/01 Rename only`,
      help: 'Rename only: edit New, then compare it with Current. The extension stays locked. Move clips will rename this file without changing its folder.',
    },
    {
      group: '02 Move only',
      source: 'Keep this name - move only.mp4',
      help: 'Move only: New and Current match. The file will keep its name and move into the existing destination folder.',
    },
    {
      group: '03 Rename and move',
      source: 'Original name and location.mp4',
      name: 'Reviewed name and location.mp4',
      help: 'Rename + move: both the filename and destination change. Review both paths in Move clips before confirming.',
    },
    {
      group: '04 Video and markers',
      source: 'Preview - scrub and click markers.mp4',
      help: 'Open Preview to play this 12-second test pattern. Click imported marker ticks at 2 and 6 seconds, and embedded chapter ticks at 0, 4 and 9 seconds. Hover for names; open Marker list and Playback info. Markers are read-only: this app does not rename or rewrite them.',
    },
    {
      group: '05 Held review',
      source: 'Held - add a question for your agent.mp4',
      help: 'Held for review: add a question in Your note, then use Agent follow-up to export held clips. Returned batch updates can change the proposed filename/folder and reasoning. Accepting an update keeps this clip held until you release it.',
      question:
        'What would you like the agent to check? Write it in Your note before exporting held clips.',
    },
    {
      group: '06 Restore and undo',
      source: 'Original filename - restore me.mp4',
      name: 'Proposed filename - try the restore icon.mp4',
      help: 'Use the restore icon beside New to bring back Current. Try Undo and Redo in the toolbar. Details → Reset suggestion restores the imported proposal while keeping your note and hold status.',
    },
    {
      group: '07 Unchanged clip',
      source: 'Already named and placed.mp4',
      destination: `${practiceReviewFolder}/07 Unchanged clip`,
      help: 'Unchanged: this clip already matches its proposal. Move clips skips it. It remains in Remaining because no file operation has filed it; this is different from a completed move.',
    },
    {
      group: '08 New folder and dragging',
      source: 'Drag me into another destination.mp4',
      help: 'This proposed destination does not exist yet. It is created only when a move needs it. Drag this clip to the empty “09 Try dropping a clip here” group, or choose a destination in Details. Undo restores the prior proposal.',
    },
  ];
  return {
    schemaVersion: 1,
    projectId: 'practice',
    batchId: practiceBatchId,
    handoffId: 'practice-feature-tour-v2',
    title: 'App feature tour — names, moves, markers, and held review',
    createdAt: new Date().toISOString(),
    reviewFolder: practiceReviewFolder,
    reviewNotes: [
      'These are generated practice videos. Each numbered folder demonstrates a feature; open Details for the steps. No real footage is included.',
      'Start with Rename only, Move only, and Rename and move. Try restoring a name, Undo/Redo, dragging, and a new destination folder. Open Video and markers to practice playback and marker seeking.',
      'Held review starts held; leave a question in Your note and export it through Agent follow-up. Unchanged clip is deliberately skipped by Move clips and stays in Remaining.',
      'With the initial suggestions, Move clips includes six clips, skips one held clip and one unchanged clip. After filing, use Filed or All to inspect completed work, then Start next batch to see the handoff workflow.',
      'Marker limits: handoff markers and embedded chapters can be displayed and sought. Marker rename proposals, acceptance, and writing new labels into video files are not implemented. New-batch kits list files but do not extract their markers.',
    ].join('\n\n'),
    folders: [`${filed}/09 Try dropping a clip here`],
    clips: examples.map((item, index) => ({
      id: startId + index,
      source: { relativePath: `${practiceReviewFolder}/${item.group}/${item.source}` },
      duration: 12,
      markers:
        index === 3
          ? [
              { seconds: 2, label: 'Imported marker - jump to 2 seconds' },
              { seconds: 6, label: 'Imported marker - compare at 6 seconds' },
            ]
          : [],
      proposed: {
        folder: item.destination || `${filed}/${item.group}`,
        filename: item.name || item.source,
      },
      rationale: item.help,
      questions: item.question ? [item.question] : [],
      hold: !!item.question,
    })),
  };
}

export async function createPracticeHandoff(
  media: string,
  tempDir: string,
  startId = 1,
  ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg',
) {
  const handoff = practiceHandoff(startId);
  await mkdir(media, { recursive: true });
  await mkdir(tempDir, { recursive: true });
  const scratch = await mkdtemp(path.join(tempDir, 'practice-feature-tour-'));
  if (
    !within(path.resolve(tempDir), path.resolve(scratch)) ||
    path.resolve(scratch) === path.resolve(tempDir)
  )
    throw new Error('Unsafe practice scratch cleanup path');
  try {
    const plain = path.join(scratch, 'plain.mp4');
    const marked = path.join(scratch, 'marked.mp4');
    const chapters = path.join(scratch, 'chapters.txt');
    const options = {
      windowsHide: true,
      timeout: 60000,
      env: { ...process.env, TEMP: tempDir, TMP: tempDir },
    };
    await run(
      ffmpeg,
      [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=640x360:rate=24',
        '-t',
        '12',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        '-n',
        plain,
      ],
      options,
    );
    await writeFile(
      chapters,
      ';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=4000\ntitle=Embedded chapter - start\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=4000\nEND=9000\ntitle=Embedded chapter - middle\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=9000\nEND=12000\ntitle=Embedded chapter - near the end\n',
    );
    await run(
      ffmpeg,
      [
        '-v',
        'error',
        '-i',
        plain,
        '-i',
        chapters,
        '-map',
        '0',
        '-map_metadata',
        '1',
        '-map_chapters',
        '1',
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        '-n',
        marked,
      ],
      options,
    );
    for (const [index, clip] of handoff.clips.entries()) {
      const sample = index === 3 ? marked : plain;
      const file = await safePath(media, clip.source.relativePath, true);
      try {
        await copyFile(sample, file, constants.COPYFILE_EXCL);
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') throw error;
        // Resume interrupted setup only when an existing file is the same generated asset.
        const expected = await fingerprint(sample),
          actual = await fingerprint(file);
        const hash = async (value: string) =>
          createHash('sha256')
            .update(await readFile(value))
            .digest('hex');
        if (actual.size !== expected.size || (await hash(file)) !== (await hash(sample)))
          throw new Error(
            `Practice file already exists with different contents; it was preserved: ${file}`,
          );
      }
      const info = await fingerprint(file);
      clip.source.size = info.size;
      clip.source.mtimeMs = info.mtimeMs;
      // Most destinations already exist; example 08 deliberately demonstrates NEW FOLDER.
      if (index !== 7) await safePath(media, `${clip.proposed.folder}/placeholder.mp4`, true);
    }
    return handoff;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
