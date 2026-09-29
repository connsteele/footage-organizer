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
      help: 'Rename only: edit New, then compare it with Original. The extension stays locked. Move clips will rename this file without changing its folder.',
    },
    {
      group: '02 Move only',
      source: 'Keep this name - move only.mp4',
      help: 'Move only: New and Original match. The file will keep its name and move into the existing destination folder.',
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
      help: 'Open Preview to play this 12-second test pattern. Try L to play, L again for 2×, then J to slow down and K to pause. Seek to 6 seconds and press J twice to rewind at 2×; K stops. Watch the direction and speed beneath the video. Keyboard shortcuts near App settings lists the controls. Typing in a marker name does not trigger playback. Click imported marker ticks at 2 and 6 seconds, and embedded chapter ticks at 0, 4 and 9 seconds. The expanded Markers panel combines imported name review and embedded chapter seeking in time order. Collapse it or scroll the list without enlarging the preview; open Playback info for codec details. See example 10 to review embedded marker names before refining the clip name.',
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
      help: 'Use the restore icon beside New to bring back Original. Try Undo and Redo in the toolbar. Details → Reset suggestion restores the imported proposal while keeping your note and hold status.',
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
    {
      group: '10 Markers first then clip name',
      source: 'Raw marker names - review events.mp4',
      name: 'Test pattern - beginning motion and final colors.mp4',
      help: 'Open Preview to review marker suggestions alongside the video. Click a marker card to seek; compare New above Original. Use the check icon to accept the first name, the return arrow to keep the second original, and edit then accept the third. Hover for action names; the information icon reveals the reasoning. Preview shows your accepted names immediately, but the file changes only when you confirm Move clips. The proposed clip name summarizes the sequence of marked events. Try Undo/Redo, Export markers, or hold this clip for an agent follow-up. After filing, Preview reads the new embedded labels; the move log records the retained original.',
    },
    {
      group: '11 Scroll through many markers',
      source: 'Many markers - scroll and review.mp4',
      name: 'Marker scroll test - review events.mp4',
      help: 'Open Preview: 24 imported review markers and three embedded chapters share the expanded Markers panel. Scroll inside it to reach the last marker while the video stays in place. Click a card background or name to seek, or focus a card and press Enter or Space. Editing New and using review buttons do not seek. Compare both card types, collapse and reopen Markers, and try a smaller window. These imported names are saved for export; example 10 demonstrates writing embedded names.',
    },
    {
      group: '12 Add delete and review markers',
      source: 'Marker editing - remove the start and add an event.mp4',
      help: 'Delete the start marker with the trash icon: cancel once, then confirm. It disappears from the timeline; Show deleted markers lets you restore it before filing. Seek to six seconds, choose Add marker, and name the visible event. Leave the embedded chapter option checked to write it with Move clips, or uncheck for app and export only. Try Undo/Redo and reload to check saved decisions. Confirm Move clips to remove the start chapter and write the new event while retaining the original footage as a backup. Needs review and Reviewed track the whole clip using its header button; individual marker buttons only accept names.',
    },
    {
      group: '13 Clip review progress',
      source: 'Whole clip review - no file changes needed.mp4',
      destination: `${practiceReviewFolder}/13 Clip review progress`,
      help: 'This unchanged clip starts Needs review. Look over the preview, name, destination and notes, then click Needs review in the clip header to mark the whole clip Reviewed. The reviewed count increases without moving a file or accepting marker suggestions. Use Review status to show only Needs review or Reviewed, and try Undo/Redo or reload. Click Reviewed to undo the check. Held and Filed are separate states. A returned agent update resets clip review so you can inspect the new suggestions. Review labels refer to whole clips, including in the earlier marker-editing lesson.',
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
      'With the initial suggestions, Move clips includes nine clips, skips one held clip and two unchanged clips. After filing, use Filed or All to inspect completed work, then Start next batch to see the handoff workflow.',
      'Example 10: review marker names before naming the clip. Accept, edit, or keep originals in Preview or Details. Accepted embedded names are written only with Move clips, keeping an original backup. Start next batch includes embedded marker extraction in its kit. Editor-only markers remain export-only.',
      'Example 11: scroll through many markers in Preview. The panel stays bounded even on a large display. Both marker card types seek when clicked; editing and review controls keep their own actions.',
      'Example 12: confirm marker deletion, restore deleted markers, and add a marker at the playhead. File the clip to apply embedded additions and deletions.',
      'Example 13: Needs review and Reviewed belong to the whole clip, independently of marker-name decisions, holds and filing. Try the clip header toggle, progress count and Review status filter without changing any files.',
    ].join('\n\n'),
    folders: [`${filed}/09 Try dropping a clip here`],
    clips: examples.map((item, index) => ({
      id: startId + index,
      source: { relativePath: `${practiceReviewFolder}/${item.group}/${item.source}` },
      duration: 12,
      markers:
        index === 8 || index === 10
          ? practiceEmbeddedMarkers()
          : index === 9
            ? Array.from({ length: 24 }, (_, i) => ({
                id: `scroll-${String(i + 1).padStart(2, '0')}`,
                seconds: Number((0.4 + i * 0.45).toFixed(3)),
                label: `Review event ${String(i + 1).padStart(2, '0')} - ${i === 23 ? 'last marker in the scrolling list' : 'watch the moving test pattern'}`,
              }))
            : index === 3
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
      ...(index === 8
        ? {
            markerProposals: {
              schemaVersion: 1 as const,
              items: practiceEmbeddedMarkers().map((m, i) => ({
                markerId: m.id!,
                seconds: m.seconds,
                originalLabel: m.label,
                proposedLabel: [
                  'Test pattern begins',
                  'Color motion midpoint',
                  'Final color pattern',
                ][i],
                rationale:
                  'Name the visible event before summarizing this sequence in the clip filename.',
              })),
            },
          }
        : {}),
    })),
  };
}
function practiceEmbeddedMarkers() {
  return [0, 4, 9].map((seconds, chapterIndex) => ({
    id: `embedded-${chapterIndex + 1}`,
    chapterIndex,
    seconds,
    label: [
      'Embedded chapter - start',
      'Embedded chapter - middle',
      'Embedded chapter - near the end',
    ][chapterIndex],
  }));
}

export async function createPracticeHandoff(
  media: string,
  tempDir: string,
  startId = 1,
  ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg',
  onlySources?: string[],
) {
  const handoff = practiceHandoff(startId);
  if (onlySources)
    handoff.clips = handoff.clips
      .filter((clip) => onlySources.includes(clip.source.relativePath))
      .map((clip, i) => ({ ...clip, id: startId + i }));
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
    for (const clip of handoff.clips) {
      const sample = clip.markers.length ? marked : plain;
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
      if (!clip.source.relativePath.includes('/08 New folder and dragging/'))
        await safePath(media, `${clip.proposed.folder}/placeholder.mp4`, true);
    }
    return handoff;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
