import { afterAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, rename } from 'node:fs/promises';
import { Organizer } from '../src/server/service';
import { Store } from '../src/server/store';
import { fingerprint, exists, safePath, within } from '../src/server/paths';
import { moveWithoutReplacement } from '../src/server/move';
import { editOf, type Handoff, type Operation, type ReviewUpdate } from '../src/shared/model';
import { buildHandoffKit } from '../src/client/handoffKit';
import { buildHeldReviewKit } from '../src/client/heldReviewKit';
import { batchMarkdown } from '../src/shared/markdown';
import { loadConfig } from '../src/server/config';

const scratch =
  process.env.FO_TEST_DIR || path.join((await loadConfig()).tempDir, 'footage-organizer-tests');
await mkdir(scratch, { recursive: true });
const roots: string[] = [];
const stores: Store[] = [];
async function fixture(moveFile?: (from: string, to: string) => Promise<void>, count = 2) {
  const root = await mkdtemp(path.join(scratch, 'case-'));
  roots.push(root);
  const media = path.join(root, 'media');
  await mkdir(path.join(media, '_cut'), { recursive: true });
  const store = new Store(path.join(root, 'registry'));
  stores.push(store);
  const service = new Organizer(store, moveFile);
  await service.initialize();
  await service.createProject({
    id: 'test',
    name: 'Test project',
    mediaRoot: media,
    dataDir: path.join(root, 'plans'),
  });
  const clips: Handoff['clips'] = [];
  for (let id = 1; id <= count; id++) {
    const relativePath = `_cut/Clip ${id}.mp4`;
    await writeFile(
      path.join(media, relativePath),
      `fixture bytes ${id}; embedded marker title=Keep this marker`,
    );
    const info = await fingerprint(path.join(media, relativePath));
    clips.push({
      id,
      source: { relativePath, size: info.size, mtimeMs: info.mtimeMs },
      duration: 5,
      markers: [{ seconds: 1, label: 'Keep this marker' }],
      proposed: { folder: 'Narrative/Act 1', filename: `Renamed ${id}.mp4` },
      rationale: `Reason ${id}`,
      questions: [],
      hold: false,
    });
  }
  const handoff: Handoff = {
    schemaVersion: 1,
    handoffId: 'handoff-1',
    projectId: 'test',
    batchId: 'batch-1',
    title: 'First batch',
    createdAt: new Date().toISOString(),
    reviewNotes: 'Sampled footage',
    folders: [],
    clips,
  };
  return {
    root,
    media,
    store,
    service,
    handoff,
    importBatch: () => service.importHandoff('test', handoff),
  };
}
afterAll(async () => {
  for (const store of stores) await store.release();
  for (const root of roots) {
    const resolved = path.resolve(root);
    if (!within(path.resolve(scratch), resolved) || resolved === path.resolve(scratch))
      throw new Error('Unsafe test cleanup path');
    await rm(resolved, { recursive: true, force: true });
  }
});
it('preflights and moves only the reviewed queue, retaining unreviewed, held and unchanged clips', async () => {
  const f = await fixture(undefined, 4);
  const batch = await f.importBatch();
  const edit = editOf(batch);
  edit.clips[0].reviewed = true;
  // An unreviewed clip can have a conflicting proposal; it must not block or join the queue.
  edit.clips[1].proposed = { ...edit.clips[0].proposed };
  edit.clips[2].reviewed = true;
  edit.clips[2].held = true;
  edit.clips[3].reviewed = true;
  edit.clips[3].proposed = { folder: '_cut', filename: 'Clip 4.mp4' };
  const saved = await f.service.saveBatch('test', batch.id, edit);
  const review = await f.service.review('test', batch.id, 'queue');
  expect(review.items.map((item) => item.clipId)).toEqual([1]);
  expect(review).toMatchObject({
    scope: 'queue',
    unreviewed: 1,
    held: 1,
    unchanged: 1,
    issues: [],
  });
  const uncheck = editOf(saved);
  uncheck.clips[0].reviewed = false;
  await f.service.saveBatch('test', batch.id, uncheck);
  await expect(f.service.startMove('test', batch.id, review.id)).rejects.toThrow('plan changed');
  expect((await f.service.review('test', batch.id, 'queue')).items).toEqual([]);
  const recheck = editOf((await f.store.load('test')).batches[0]);
  recheck.clips[0].reviewed = true;
  await f.service.saveBatch('test', batch.id, recheck);
  const ready = await f.service.review('test', batch.id, 'queue');
  await f.service.startMove('test', batch.id, ready.id);
  await f.service.waitForIdle();
  const after = await f.store.load('test');
  expect(after.operations[0].items.map((item) => item.clipId)).toEqual([1]);
  expect(after.operations[0].status).toBe('completed');
  expect(after.batches[0].clips.map((clip) => clip.applied)).toEqual([true, false, false, false]);
  for (const id of [2, 3, 4])
    expect(await exists(path.join(f.media, `_cut/Clip ${id}.mp4`))).toBe(true);
  const empty = await f.service.review('test', batch.id, 'queue');
  expect(empty.items).toEqual([]);
  expect(empty.unchanged).toBe(1); // Filed clips are not counted again.
});

describe('project deletion and retained plans', () => {
  it('removes registration, retains all records, and reopens the complete project', async () => {
    const f = await fixture();
    const batch = await f.importBatch();
    const edit = editOf(batch);
    edit.clips[0].note = 'Preserve this note';
    await f.service.saveBatch('test', batch.id, edit);
    const original = await f.store.load('test');
    const savedBytes = await readFile(path.join(f.root, 'plans/state.json'));
    expect(await f.service.deleteProject('test')).toEqual({ removed: true, plansDeleted: false });
    expect(await f.service.summaries()).toEqual([]);
    await expect(f.store.load('test')).rejects.toThrow('Project not found');
    expect(await readFile(path.join(f.root, 'plans/state.json'))).toEqual(savedBytes);
    expect(await exists(path.join(f.root, 'plans/.organizer.lock'))).toBe(false);
    expect(await exists(path.join(f.media, '_cut/Clip 1.mp4'))).toBe(true);
    const removed = (await f.service.removedProjects())[0];
    expect(removed.project).toEqual(original.project);
    await f.service.createProject(original.project);
    expect((await f.store.load('test')).batches).toEqual(original.batches);
    expect(await f.service.removedProjects()).toEqual([]);
    await expect(f.service.cleanupProject(removed.removalId)).rejects.toThrow('active project');
  });
  it('cleans retained app records while leaving footage, unrelated files, and other projects intact', async () => {
    const f = await fixture();
    await f.importBatch();
    await writeFile(path.join(f.root, 'plans/Personal notes.txt'), 'Keep me');
    await writeFile(path.join(f.root, 'plans/batches/Unrelated.mp4'), 'Not an app record');
    const otherMedia = path.join(f.root, 'other-media');
    await mkdir(otherMedia);
    await f.service.createProject({
      id: 'other',
      name: 'Other',
      mediaRoot: otherMedia,
      dataDir: path.join(f.root, 'other-plans'),
    });
    const otherBytes = await readFile(path.join(f.root, 'other-plans/state.json'));
    const clipBytes = await readFile(path.join(f.media, '_cut/Clip 1.mp4'));
    await f.service.deleteProject('test');
    const removed = (await f.service.removedProjects())[0];
    expect(await f.service.cleanupProject(removed.removalId)).toEqual({ retainedFiles: true });
    expect(await exists(path.join(f.root, 'plans/state.json'))).toBe(false);
    expect(await exists(path.join(f.root, 'plans/batches/batch-1.json'))).toBe(false);
    expect(await exists(path.join(f.root, 'plans/imports/handoff-1.json'))).toBe(false);
    expect(await readFile(path.join(f.root, 'plans/Personal notes.txt'), 'utf8')).toBe('Keep me');
    expect(await readFile(path.join(f.root, 'plans/batches/Unrelated.mp4'), 'utf8')).toBe(
      'Not an app record',
    );
    expect(await readFile(path.join(f.media, '_cut/Clip 1.mp4'))).toEqual(clipBytes);
    expect(await readFile(path.join(f.root, 'other-plans/state.json'))).toEqual(otherBytes);
    expect(await f.service.removedProjects()).toEqual([]);
    expect((await f.service.summaries()).map((p) => p.id)).toEqual(['other']);
  });
  it('supports permanent plan deletion immediately and never interrupts file moves', async () => {
    const f = await fixture();
    await f.importBatch();
    f.service.busy = 'active-job';
    await expect(f.service.deleteProject('test', true)).rejects.toThrow('move is in progress');
    expect(await f.service.removedProjects()).toEqual([]);
    f.service.busy = null;
    expect(await f.service.deleteProject('test', true)).toMatchObject({
      removed: true,
      plansDeleted: true,
      retainedFiles: false,
    });
    expect(await exists(path.join(f.root, 'plans'))).toBe(false);
    expect(await exists(path.join(f.media, '_cut/Clip 1.mp4'))).toBe(true);
    expect(await f.service.removedProjects()).toEqual([]);
  });
  it('rejects linked plan directories before deleting any records and allows retry after repair', async () => {
    const f = await fixture();
    await f.importBatch();
    const plans = path.join(f.root, 'plans');
    const outside = path.join(f.root, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'batch-1.json'), 'Unrelated data');
    await rename(path.join(plans, 'batches'), path.join(plans, 'saved-batches'));
    await symlink(
      outside,
      path.join(plans, 'batches'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const result = await f.service.deleteProject('test', true);
    expect(result).toMatchObject({
      removed: true,
      plansDeleted: false,
      cleanupError: expect.stringContaining('Linked paths'),
    });
    expect(await exists(path.join(plans, 'state.json'))).toBe(true);
    expect(await readFile(path.join(outside, 'batch-1.json'), 'utf8')).toBe('Unrelated data');
    const removal = (await f.service.removedProjects())[0];
    f.service.busy = 'moving';
    await expect(f.service.cleanupProject(removal.removalId)).rejects.toThrow(
      'move is in progress',
    );
    f.service.busy = null;
    // Unlink only the fixture junction; never recursively remove its target.
    await rm(path.join(plans, 'batches'));
    await rename(path.join(plans, 'saved-batches'), path.join(plans, 'batches'));
    expect(await f.service.cleanupProject(removal.removalId)).toEqual({ retainedFiles: false });
  });
  it('refuses tampered removal paths or foreign checkpoints without deleting files', async () => {
    const f = await fixture();
    await f.importBatch();
    const state = await f.store.load('test');
    const invalid = await f.store.rememberRemoved({ ...state.project, dataDir: f.media });
    await expect(f.service.cleanupProject(invalid.removalId)).rejects.toThrow('overlaps footage');
    await f.service.deleteProject('test');
    const removed = (await f.service.removedProjects()).find(
      (r) => r.project.dataDir === state.project.dataDir,
    )!;
    await writeFile(
      path.join(f.root, 'plans/checkpoints/9999999999.json'),
      JSON.stringify({ ...state, project: { ...state.project, id: 'foreign' } }),
    );
    await expect(f.service.cleanupProject(removed.removalId)).rejects.toThrow('another project');
    expect(await exists(path.join(f.root, 'plans/state.json'))).toBe(true);
    expect(await exists(path.join(f.root, 'plans/imports/handoff-1.json'))).toBe(true);
    expect(await exists(path.join(f.media, '_cut/Clip 1.mp4'))).toBe(true);
  });
});
describe('review folders and inventories', () => {
  it('adds defaults to an existing project and records a separate folder per batch', async () => {
    const f = await fixture();
    expect((await f.store.load('test')).project.reviewFolder).toBeUndefined();
    expect((await f.service.setReviewFolder('test', path.join(f.media, '_cut'))).reviewFolder).toBe(
      '_cut',
    );
    const first = await f.service.importHandoff('test', {
      ...f.handoff,
      reviewFolder: '_cut',
      clips: [f.handoff.clips[0]],
    });
    await mkdir(path.join(f.media, '_next'));
    await writeFile(path.join(f.media, '_next/Session 2.mp4'), 'next footage');
    const second = await f.service.importHandoff('test', {
      ...f.handoff,
      handoffId: 'second',
      batchId: 'second',
      reviewFolder: '_next',
      clips: [{ ...f.handoff.clips[1], source: { relativePath: '_next/Session 2.mp4' } }],
    });
    const state = await f.store.load('test');
    expect(state.project.reviewFolder).toBe('_cut');
    expect(first.reviewFolder).toBe('_cut');
    expect(second.reviewFolder).toBe('_next');
    await expect(
      f.service.importHandoff('test', {
        ...f.handoff,
        handoffId: 'outside',
        batchId: 'outside',
        reviewFolder: '_next',
      }),
    ).rejects.toThrow('outside the selected');
    await expect(f.service.setReviewFolder('test', f.root)).rejects.toThrow('inside Root Footage');
    await symlink(
      f.root,
      path.join(f.media, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(f.service.setReviewFolder('test', 'linked')).rejects.toThrow('linked');
    expect((await f.service.setReviewFolder('test', f.media)).reviewFolder).toBe('');
  });
  it('validates the review folder during project creation before registering the project', async () => {
    const f = await fixture();
    const mediaRoot = path.join(f.root, 'other-media');
    await mkdir(path.join(mediaRoot, 'Incoming'), { recursive: true });
    const input = {
      id: 'other',
      name: 'Other',
      mediaRoot,
      dataDir: path.join(f.root, 'other-plans'),
      reviewFolder: f.media,
    };
    await expect(f.service.createProject(input)).rejects.toThrow('inside Root Footage');
    expect((await f.store.registry()).map((p) => p.id)).toEqual(['test']);
    expect(
      (await f.service.createProject({ ...input, reviewFolder: path.join(mediaRoot, 'Incoming') }))
        .reviewFolder,
    ).toBe('Incoming');
  });
  it('inventories only selected media with metadata and existing IDs, without changing state', async () => {
    const f = await fixture();
    await f.service.importHandoff('test', { ...f.handoff, clips: [f.handoff.clips[0]] });
    await mkdir(path.join(f.media, '_cut/nested'));
    await writeFile(path.join(f.media, '_cut/nested/Third.MOV'), 'third');
    await writeFile(path.join(f.media, '_cut/notes.md'), 'sidecar');
    await writeFile(path.join(f.media, 'Unselected.mp4'), 'outside selection');
    await symlink(
      f.root,
      path.join(f.media, '_cut/linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const before = await f.store.load('test');
    const inventory = await f.service.inventory('test', '_cut');
    expect(inventory.files).toHaveLength(3);
    expect(inventory.files[0]).toMatchObject({
      relativePath: '_cut/Clip 1.mp4',
      existingClipId: 1,
      batchIds: ['batch-1'],
      size: f.handoff.clips[0].source.size,
    });
    expect(inventory.files[1]).toMatchObject({ existingClipId: null, batchIds: [] });
    expect(inventory.skippedFiles).toBe(2);
    const kit = buildHandoffKit(before, [], undefined, inventory);
    const snapshot = JSON.parse(kit.match(/(`{3,})json\n([\s\S]*?)\n\1/)![2]);
    expect(snapshot.reviewInventory).toEqual(inventory);
    expect(await f.store.load('test')).toEqual(before);
  });
});

async function heldFixture() {
  const f = await fixture(undefined, 3);
  f.handoff.clips[0].hold = true;
  f.handoff.clips[1].questions = ['Which story beat?'];
  const batch = await f.importBatch();
  const edit = editOf(batch);
  edit.notes = 'Keep the character names.';
  edit.clips[0].note = 'Use the introduction.';
  edit.clips[1].note = 'Check the map.';
  await f.service.saveBatch('test', batch.id, edit);
  const exported = await f.service.updates.exportHeld('test', batch.id);
  const update: ReviewUpdate = {
    schemaVersion: 1,
    kind: 'batch-update',
    updateId: 'follow-up-1',
    requestId: exported.request.id,
    projectId: 'test',
    batchId: batch.id,
    createdAt: new Date().toISOString(),
    reviewNotes: 'Rechecked markers.',
    clips: exported.request.clips.map((c) => ({
      id: c.id,
      proposed: { folder: 'Story/Follow-up', filename: `Updated ${c.id}.mp4` },
      rationale: `Addressed note ${c.id}`,
      questions: [],
    })),
  };
  return { ...f, ...exported, batchId: batch.id, update };
}
describe('held clip review updates', () => {
  it('exports complete held evidence and selectively applies suggestions, preserving history and files', async () => {
    const f = await heldFixture();
    const before = (await f.store.load('test')).batches[0];
    expect(f.request.clips.map((c) => c.id)).toEqual([1, 2]);
    expect(f.request.batchNotes).toBe(before.notes);
    const kit = buildHeldReviewKit(f.state, f.request, f.batchId);
    const snapshot = JSON.parse(kit.match(/(`{3,})json\n([\s\S]*?)\n\1/)![2]);
    expect(snapshot.request).toEqual(f.request);
    expect(kit).toContain('batch-update');
    expect(kit).toContain('Use the introduction.');
    const preview = await f.service.updates.preview('test', f.batchId, f.update);
    expect(preview.clips.map((c) => c.conflicts)).toEqual([[], []]);
    const result = await f.service.updates.apply('test', f.batchId, {
      update: f.update,
      revision: preview.revision,
      clipIds: [1],
    });
    expect(result.clips[0]).toMatchObject({
      proposed: f.update.clips[0].proposed,
      note: before.clips[0].note,
      original: before.clips[0].original,
      held: true,
      applied: false,
      currentPath: before.clips[0].currentPath,
      agentReview: { rationale: 'Addressed note 1', questions: [] },
    });
    expect(result.clips.slice(1)).toEqual(before.clips.slice(1));
    expect(result.reviewUpdates![0].before).toEqual([before.clips[0]]);
    expect((await f.store.load('test')).batches[0]).toEqual(result);
    expect((await f.store.load('test')).operations).toEqual([]);
    expect(await exists(path.join(f.media, '_cut/Clip 1.mp4'))).toBe(true);
    expect(await exists(path.join(f.media, 'Story'))).toBe(false);
    expect((await f.service.review('test', f.batchId)).items.map((c) => c.clipId)).toEqual([3]);
    // Ordinary autosaves must retain request snapshots and accepted follow-up history.
    const edit = editOf(result);
    edit.clips[2].note = 'Ordinary edit after update';
    const saved = await f.service.saveBatch('test', f.batchId, edit);
    expect(saved.reviewRequests).toEqual(result.reviewRequests);
    expect(saved.reviewUpdates).toEqual(result.reviewUpdates);
    const markdown = await readFile(path.join(f.root, 'plans/batches/batch-1.md'), 'utf8');
    expect(markdown).toContain('Accepted review update follow-up-1');
    expect(markdown).toContain('Your note: Use the introduction.');
    expect(markdown).toContain('Addressed note 1');
  });
  it('supports later acceptance from the same update and rejects replay or reuse with different content', async () => {
    const f = await heldFixture();
    f.update.clips[0].proposed.folder = 'Story\\Follow-up';
    const first = await f.service.updates.preview('test', f.batchId, f.update);
    await f.service.updates.apply('test', f.batchId, {
      update: f.update,
      revision: first.revision,
      clipIds: [1],
    });
    const second = await f.service.updates.preview('test', f.batchId, f.update);
    expect(second.clips[0].alreadyApplied).toBe(true);
    expect(second.clips[1].conflicts).toEqual([]);
    await expect(
      f.service.updates.apply('test', f.batchId, {
        update: f.update,
        revision: second.revision,
        clipIds: [1, 2],
      }),
    ).rejects.toThrow('cannot be updated');
    expect((await f.store.load('test')).batches[0].clips[1].agentReview).toBeUndefined();
    const done = await f.service.updates.apply('test', f.batchId, {
      update: f.update,
      revision: second.revision,
      clipIds: [2],
    });
    expect(done.reviewUpdates).toHaveLength(2);
    await expect(
      f.service.updates.preview('test', f.batchId, { ...f.update, reviewNotes: 'Changed payload' }),
    ).rejects.toThrow('already used');
  });
  it('blocks changed notes and decisions while letting an unaffected clip be accepted', async () => {
    const f = await heldFixture();
    const edit = editOf((await f.store.load('test')).batches[0]);
    edit.clips[0].note = 'Actually choose another beat';
    await f.service.saveBatch('test', f.batchId, edit);
    const preview = await f.service.updates.preview('test', f.batchId, f.update);
    expect(preview.clips[0].conflicts.join()).toContain('notes or suggestions changed');
    expect(preview.clips[1].conflicts).toEqual([]);
    const saved = await f.service.updates.apply('test', f.batchId, {
      update: f.update,
      revision: preview.revision,
      clipIds: [2],
    });
    expect(saved.clips[0].note).toBe(edit.clips[0].note);
    const decisions = editOf(saved);
    decisions.notes = 'New batch decisions';
    await f.service.saveBatch('test', f.batchId, decisions);
    expect(
      (await f.service.updates.preview('test', f.batchId, f.update)).clips[0].conflicts.join(),
    ).toContain('Batch decisions changed');
  });
  it('rechecks the batch revision and source identity when applying a previously valid preview', async () => {
    const f = await heldFixture();
    const preview = await f.service.updates.preview('test', f.batchId, f.update);
    const edit = editOf((await f.store.load('test')).batches[0]);
    edit.clips[2].note = 'A concurrent edit';
    await f.service.saveBatch('test', f.batchId, edit);
    await expect(
      f.service.updates.apply('test', f.batchId, {
        update: f.update,
        revision: preview.revision,
        clipIds: [1],
      }),
    ).rejects.toThrow('changed after the preview');
    const fresh = await f.service.updates.preview('test', f.batchId, f.update);
    await writeFile(path.join(f.media, '_cut/Clip 1.mp4'), 'Source was replaced after preview');
    await expect(
      f.service.updates.apply('test', f.batchId, {
        update: f.update,
        revision: fresh.revision,
        clipIds: [1],
      }),
    ).rejects.toThrow('cannot be updated');
    expect(
      (await f.service.updates.preview('test', f.batchId, f.update)).clips[0].conflicts.join(),
    ).toContain('source file changed');
  });
  it('rejects wrong scopes, unknown/duplicate IDs, unsafe paths, extension changes and extra write fields', async () => {
    const f = await heldFixture();
    const invalid = [
      { ...f.update, projectId: 'other' },
      { ...f.update, batchId: 'other' },
      { ...f.update, requestId: 'unknown' },
      { ...f.update, clips: [{ ...f.update.clips[0], id: 3 }] },
      { ...f.update, clips: [f.update.clips[0], f.update.clips[0]] },
      {
        ...f.update,
        clips: [{ ...f.update.clips[0], proposed: { folder: '../Escape', filename: 'Okay.mp4' } }],
      },
      {
        ...f.update,
        clips: [{ ...f.update.clips[0], proposed: { folder: 'Story', filename: 'Changed.mov' } }],
      },
      {
        ...f.update,
        clips: [{ ...f.update.clips[0], proposed: { folder: 'Story', filename: 'CON.mp4' } }],
      },
      { ...f.update, clips: [{ ...f.update.clips[0], note: 'Overwrite the user' }] },
      { ...f.update, clips: [{ ...f.update.clips[0], held: false }] },
    ];
    for (const payload of invalid)
      await expect(f.service.updates.preview('test', f.batchId, payload)).rejects.toThrow();
    expect((await f.store.load('test')).batches[0].reviewUpdates).toBeUndefined();
  });
  it('refuses updates for released or filed clips and blocks updates during moves', async () => {
    const f = await heldFixture();
    const edit = editOf((await f.store.load('test')).batches[0]);
    edit.clips[0].held = false;
    await f.service.saveBatch('test', f.batchId, edit);
    expect(
      (await f.service.updates.preview('test', f.batchId, f.update)).clips[0].conflicts.join(),
    ).toContain('no longer held');
    const move = await f.service.review('test', f.batchId);
    await f.service.startMove('test', f.batchId, move.id);
    await expect(f.service.updates.preview('test', f.batchId, f.update)).rejects.toThrow(
      'move is in progress',
    );
    await f.service.waitForIdle();
    const preview = await f.service.updates.preview('test', f.batchId, f.update);
    expect(preview.clips[0].conflicts.join()).toContain('already been filed');
    await expect(
      f.service.updates.apply('test', f.batchId, {
        update: f.update,
        revision: preview.revision,
        clipIds: [1],
      }),
    ).rejects.toThrow('cannot be updated');
    expect(
      (await f.service.updates.exportHeld('test', f.batchId)).request.clips.map((c) => c.id),
    ).toEqual([2]);
  });
});
describe('handoffs and saved plans', () => {
  it('keeps several batches and their decisions under one shared project catalog', async () => {
    const f = await fixture(undefined, 4);
    const first = await f.service.importHandoff('test', {
      ...f.handoff,
      clips: f.handoff.clips.slice(0, 2),
    });
    const edit = editOf(first);
    edit.notes = 'Session one decisions';
    edit.clips[0].held = true;
    await f.service.saveBatch('test', first.id, edit);
    const second = await f.service.importHandoff('test', {
      ...f.handoff,
      handoffId: 'handoff-2',
      batchId: 'batch-2',
      title: 'Second recording session',
      clips: f.handoff.clips.slice(2),
    });
    const state = await f.store.load('test');
    expect(state.batches.map((batch) => batch.id)).toEqual(['batch-2', first.id]);
    expect(Object.keys(state.catalog)).toEqual(['1', '2', '3', '4']);
    expect(state.batches[1].notes).toBe('Session one decisions');
    expect(state.batches[1].clips[0].held).toBe(true);
    expect(second.clips.map((clip) => clip.id)).toEqual([3, 4]);
    expect(second.folders).toEqual(first.folders);
    expect((await f.service.review('test', second.id)).items.map((item) => item.clipId)).toEqual([
      3, 4,
    ]);
    expect((await f.service.review('test', first.id)).items.map((item) => item.clipId)).toEqual([
      2,
    ]);
  });
  it('preserves all 44 IDs and does not overwrite edits when reimported', async () => {
    const f = await fixture(undefined, 44);
    const batch = await f.importBatch();
    expect(batch.clips.map((c) => c.id)).toEqual(Array.from({ length: 44 }, (_, i) => i + 1));
    const edit = editOf(batch);
    edit.clips[0].note = 'Keep my decision';
    await f.service.saveBatch('test', batch.id, edit);
    const reopened = await f.importBatch();
    expect(reopened.clips[0].note).toBe('Keep my decision');
    expect((await f.store.load('test')).batches).toHaveLength(1);
    expect(await exists(path.join(f.media, '_cut/Clip 1.mp4'))).toBe(true);
    expect(batchMarkdown((await f.store.load('test')).project, reopened)).toContain(
      'Keep my decision',
    );
  });
  it('rejects duplicate clip IDs, path traversal, and mismatched project IDs', async () => {
    const f = await fixture();
    const bad = structuredClone(f.handoff);
    bad.clips[1].id = 1;
    await expect(f.service.importHandoff('test', bad)).rejects.toThrow('duplicate clip IDs');
    bad.clips[1].id = 2;
    bad.clips[0].source.relativePath = '../outside.mp4';
    await expect(f.service.importHandoff('test', bad)).rejects.toThrow('Invalid relative path');
    await expect(
      f.service.importHandoff('test', { ...f.handoff, projectId: 'different' }),
    ).rejects.toThrow('different');
  });
  it('refuses a new identity for an existing catalog ID', async () => {
    const f = await fixture();
    await f.importBatch();
    const newer = structuredClone(f.handoff);
    newer.handoffId = 'new';
    newer.batchId = 'new';
    newer.clips[0].source.relativePath = '_cut/Different.mp4';
    await expect(f.service.importHandoff('test', newer)).rejects.toThrow('IDs must be preserved');
  });
  it('rejects stale saves and invalidates a reviewed plan when edited', async () => {
    const f = await fixture();
    const batch = await f.importBatch();
    const review = await f.service.review('test', batch.id);
    const edit = editOf(batch);
    edit.notes = 'Revised';
    await f.service.saveBatch('test', batch.id, edit);
    await expect(f.service.saveBatch('test', batch.id, edit)).rejects.toThrow('another tab');
    await expect(f.service.startMove('test', batch.id, review.id)).rejects.toThrow('plan changed');
  });
  it('flags missing and stale imports, and holds unresolved editorial questions', async () => {
    const f = await fixture();
    f.handoff.clips[0].source.size = 9999;
    f.handoff.clips[1].questions = ['Which chapter?'];
    const batch = await f.importBatch();
    expect(batch.clips[1].held).toBe(true);
    const review = await f.service.review('test', batch.id);
    expect(review.held).toBe(1);
    expect(review.issues[0].message).toContain('differs from the review');
  });
});
describe('preflight', () => {
  it('finds target collisions, invalid names, and changed source bytes', async () => {
    const f = await fixture();
    const batch = await f.importBatch();
    const edit = editOf(batch);
    edit.clips[1].proposed = { ...edit.clips[0].proposed };
    await f.service.saveBatch('test', batch.id, edit);
    expect(
      (await f.service.review('test', batch.id)).issues.some((i) =>
        i.message.includes('same destination'),
      ),
    ).toBe(true);
    const latest = (await f.store.load('test')).batches[0];
    const changes = editOf(latest);
    changes.clips[0].proposed.filename = 'CON.mp4';
    await f.service.saveBatch('test', batch.id, changes);
    expect(
      (await f.service.review('test', batch.id)).issues.some((i) =>
        i.message.includes('Invalid relative path'),
      ),
    ).toBe(true);
    await writeFile(path.join(f.media, '_cut/Clip 2.mp4'), 'Changed');
    expect(
      (await f.service.review('test', batch.id)).issues.some((i) =>
        i.message.includes('Source changed'),
      ),
    ).toBe(true);
  });
  it('rejects junction escapes and existing destinations', async () => {
    const f = await fixture();
    const outside = path.join(f.root, 'outside');
    await mkdir(outside);
    await symlink(
      outside,
      path.join(f.media, 'Escape'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(safePath(f.media, 'Escape/new.mp4')).rejects.toThrow('Linked paths');
    const batch = await f.importBatch();
    await mkdir(path.join(f.media, 'Narrative/Act 1'), { recursive: true });
    await writeFile(path.join(f.media, 'Narrative/Act 1/Renamed 1.mp4'), 'Existing data');
    expect((await f.service.review('test', batch.id)).issues[0].message).toContain(
      'already exists',
    );
  });
});
describe('verified Windows moves', () => {
  it('moves files without changing bytes, updates Markdown, and deduplicates repeated requests', async () => {
    const f = await fixture();
    const batch = await f.importBatch();
    const original = await readFile(path.join(f.media, '_cut/Clip 1.mp4'));
    const review = await f.service.review('test', batch.id);
    expect(review.issues).toEqual([]);
    await f.service.startMove('test', batch.id, review.id);
    await f.service.waitForIdle();
    const result = await f.service.startMove('test', batch.id, review.id);
    expect(result.status).toBe('completed');
    expect((await f.store.load('test')).operations).toHaveLength(1);
    expect(await readFile(path.join(f.media, 'Narrative/Act 1/Renamed 1.mp4'))).toEqual(original);
    expect(await exists(path.join(f.media, '_cut/Clip 1.mp4'))).toBe(false);
    expect((await f.store.load('test')).catalog['1'].path).toBe('Narrative/Act 1/Renamed 1.mp4');
    expect(await readFile(path.join(f.root, 'plans/batches/batch-1.md'), 'utf8')).toContain(
      '| 001 |',
    );
  });
  it('the move primitive refuses a target created after all checks', async () => {
    const f = await fixture(async (from, to) => {
      await writeFile(to, 'Concurrent file', { flag: 'wx' });
      await moveWithoutReplacement(from, to);
    });
    const batch = await f.importBatch();
    const review = await f.service.review('test', batch.id);
    await f.service.startMove('test', batch.id, review.id);
    await f.service.waitForIdle();
    expect(await readFile(path.join(f.media, 'Narrative/Act 1/Renamed 1.mp4'), 'utf8')).toBe(
      'Concurrent file',
    );
    expect(await exists(path.join(f.media, '_cut/Clip 1.mp4'))).toBe(true);
    const state = await f.store.load('test');
    expect(state.operations[0].status).toBe('failed');
    expect(state.operations[0].items[1].status).toBe('pending');
  });
  it('records partial success and only moves remaining clips on retry', async () => {
    let moves = 0;
    const f = await fixture(async (from, to) => {
      moves++;
      if (moves === 2) throw new Error('Simulated locked file');
      await moveWithoutReplacement(from, to);
    });
    const batch = await f.importBatch();
    const review = await f.service.review('test', batch.id);
    await f.service.startMove('test', batch.id, review.id);
    await f.service.waitForIdle();
    const state = await f.store.load('test');
    expect(state.batches[0].clips[0].applied).toBe(true);
    expect(state.batches[0].clips[1].applied).toBe(false);
    const retry = await f.service.review('test', batch.id);
    expect(retry.items.map((i) => i.clipId)).toEqual([2]);
    await f.service.startMove('test', batch.id, retry.id);
    await f.service.waitForIdle();
    expect((await f.store.load('test')).batches[0].clips.every((c) => c.applied)).toBe(true);
  });
  it('reconciles a crash after the filesystem move without replaying it', async () => {
    const f = await fixture();
    const batch = await f.importBatch();
    const state = await f.store.load('test');
    const clip = batch.clips[0];
    const to = 'Recovered/Clip 1.mp4';
    const operation: Operation = {
      id: 'crash-case',
      batchId: batch.id,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      status: 'running',
      items: [
        {
          clipId: clip.id,
          from: clip.currentPath,
          to,
          baseline: clip.baseline!,
          status: 'moving',
          error: null,
        },
      ],
    };
    state.operations.push(operation);
    await f.store.save(state);
    const target = await safePath(f.media, to, true);
    await moveWithoutReplacement(path.join(f.media, clip.currentPath), target);
    await f.store.release();
    const store = new Store(path.join(f.root, 'registry'));
    stores.push(store);
    const reopened = new Organizer(store);
    await reopened.initialize();
    const recovered = await store.load('test');
    expect(recovered.operations[0].status).toBe('completed');
    expect(recovered.catalog['1'].path).toBe(to);
    expect(recovered.batches[0].clips[0].applied).toBe(true);
  });
  it('stops recovery when file identity is ambiguous', async () => {
    const f = await fixture();
    const batch = await f.importBatch();
    const state = await f.store.load('test');
    const clip = batch.clips[0];
    state.operations.push({
      id: 'ambiguous-case',
      batchId: batch.id,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      status: 'running',
      items: [
        {
          clipId: 1,
          from: clip.currentPath,
          to: 'Different.mp4',
          baseline: clip.baseline!,
          status: 'moving',
          error: null,
        },
      ],
    });
    await f.store.save(state);
    await rename(path.join(f.media, clip.currentPath), path.join(f.media, 'Elsewhere.mp4'));
    await writeFile(path.join(f.media, 'Different.mp4'), 'Another file');
    await f.service.reconcile('test');
    expect((await f.store.load('test')).operations[0].items[0].status).toBe('ambiguous');
    expect(
      (await f.service.review('test', batch.id)).issues.some((i) =>
        i.message.includes('ambiguous result'),
      ),
    ).toBe(true);
  });
});
