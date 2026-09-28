import path from 'node:path';
import { createPracticeHandoff, practiceBatchId } from './practice-fixture.js';
import { validateHandoff } from './validate-handoff.js';
import { fingerprint, safePath } from '../src/server/paths.js';
import { initialMarkerDecisions } from '../src/shared/markers.js';
import { atomicWrite, type Store } from '../src/server/store.js';

// Demo-only, offline maintenance. Append a lesson without resetting any saved user decisions.
export async function upgradePracticeTour(store: Store, tempDir: string, ffmpeg?: string) {
  return store.serial(async () => {
    const state = await store.load('practice');
    const batch = state.batches.find((b) => b.id === practiceBatchId);
    if (
      !batch ||
      batch.clips.some((c) =>
        c.original.source.relativePath.includes('/10 Markers first then clip name/'),
      )
    )
      return false;
    const nextId = Math.max(0, ...Object.keys(state.catalog).map(Number)) + 1;
    const handoff = validateHandoff(
      await createPracticeHandoff(state.project.mediaRoot, tempDir, nextId, ffmpeg, true),
    );
    handoff.handoffId = 'practice-marker-lesson-v1';
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
    // These are generated lesson descriptions, never the user's notes or proposals.
    for (const clip of batch.clips)
      clip.original.rationale = clip.original.rationale.replace(
        'Markers are read-only: this app does not rename or rewrite them.',
        'See example 10 to review embedded marker names before refining the clip name.',
      );
    batch.reviewNotes =
      batch.reviewNotes.replace('six clips', 'seven clips').replace(/Marker limits:[\s\S]*$/, '') +
      '\n\nNew lesson 10: review marker names first, then refine the clip name. Accepting saves a decision; Move clips writes accepted embedded names and retains the original. Editor-only markers remain export-only.';
    batch.revision++;
    await atomicWrite(
      path.join(state.project.dataDir, 'imports', `${handoff.handoffId}.json`),
      handoff,
    );
    await store.save(state);
    return true;
  });
}
