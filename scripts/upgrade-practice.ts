import path from 'node:path';
import { createPracticeHandoff, practiceBatchId, practiceHandoff } from './practice-fixture.js';
import { validateHandoff } from './validate-handoff.js';
import { fingerprint, safePath } from '../src/server/paths.js';
import { initialMarkerDecisions } from '../src/shared/markers.js';
import { atomicWrite, type Store } from '../src/server/store.js';

// Demo-only, offline maintenance. Append a lesson without resetting any saved user decisions.
export async function upgradePracticeTour(store: Store, tempDir: string, ffmpeg?: string) {
  return store.serial(async () => {
    const state = await store.load('practice');
    const batch = state.batches.find((b) => b.id === practiceBatchId);
    if (!batch) return false;
    // The original feature tour had eight clips. Later lessons are appended in place;
    // compare imported paths because an existing lesson may already have been filed.
    const missing = practiceHandoff()
      .clips.slice(8)
      .filter(
        (lesson) =>
          !batch.clips.some(
            (clip) => clip.original.source.relativePath === lesson.source.relativePath,
          ),
      );
    if (!missing.length) return false;
    const nextId = Math.max(0, ...Object.keys(state.catalog).map(Number)) + 1;
    const handoff = validateHandoff(
      await createPracticeHandoff(
        state.project.mediaRoot,
        tempDir,
        nextId,
        ffmpeg,
        missing.map((c) => c.source.relativePath),
      ),
    );
    handoff.handoffId = `practice-lessons-${nextId}-v1`;
    for (const original of handoff.clips) {
      const baseline = await fingerprint(
        await safePath(state.project.mediaRoot, original.source.relativePath),
      );
      batch.clips.push({
        id: original.id,
        original,
        currentPath: original.source.relativePath,
        baseline,
        importIssue: null,
        proposed: original.proposed,
        note: '',
        held: false,
        applied: false,
        markerDecisions: initialMarkerDecisions(original.markerProposals),
      });
      state.catalog[String(original.id)] = { path: original.source.relativePath, baseline };
      if (!batch.folders.includes(original.proposed.folder))
        batch.folders.push(original.proposed.folder);
    }
    batch.reviewNotes +=
      '\n\nAdded practice lessons: ' +
      missing.map((clip) => clip.source.relativePath.split('/').at(-2)).join('; ') +
      '. Open Details for steps and Preview to try the marker controls.';
    batch.revision++;
    await atomicWrite(
      path.join(state.project.dataDir, 'imports', `${handoff.handoffId}.json`),
      handoff,
    );
    await store.save(state);
    return true;
  });
}
