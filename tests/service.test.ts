import { afterAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, rename } from 'node:fs/promises';
import { Organizer } from '../src/server/service';
import { Store } from '../src/server/store';
import { fingerprint, exists, safePath, within } from '../src/server/paths';
import { moveWithoutReplacement } from '../src/server/move';
import { editOf, type Handoff, type Operation } from '../src/shared/model';
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
