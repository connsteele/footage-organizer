import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { Organizer } from '../src/server/service';
import { Store } from '../src/server/store';
import { exists, within } from '../src/server/paths';
import { loadConfig } from '../src/server/config';
import * as media from '../src/server/move';
import { editOf, type Handoff } from '../src/shared/model';

const scratch =
  process.env.FO_TEST_DIR || path.join((await loadConfig()).tempDir, 'footage-organizer-tests');
await mkdir(scratch, { recursive: true });
const fixtures: { root: string; store: Store; service: Organizer }[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(scratch, 'audit-'));
  const mediaRoot = path.join(root, 'library/media');
  const dataDir = path.join(root, 'plans');
  await mkdir(mediaRoot, { recursive: true });
  await writeFile(path.join(mediaRoot, 'Clip.mp4'), 'Original footage and embedded markers');
  const store = new Store(path.join(root, 'registry'));
  const service = new Organizer(store, rename);
  fixtures.push({ root, store, service });
  await service.initialize();
  const project = await service.createProject({ id: 'test', name: 'Audit', mediaRoot, dataDir });
  const handoff: Handoff = {
    schemaVersion: 1,
    handoffId: 'handoff',
    projectId: 'test',
    batchId: 'batch',
    title: 'Batch',
    createdAt: new Date().toISOString(),
    reviewNotes: '',
    folders: [],
    clips: [
      {
        id: 1,
        source: { relativePath: 'Clip.mp4' },
        duration: 2,
        markers: [],
        proposed: { folder: 'Filed', filename: 'First.mp4' },
        rationale: '',
        questions: [],
        hold: false,
      },
    ],
  };
  const batch = await service.importHandoff('test', handoff);
  return { root, mediaRoot, dataDir, store, service, project, handoff, batch };
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) {
    await f.service.waitForIdle();
    await f.store.release();
    if (
      !within(path.resolve(scratch), path.resolve(f.root)) ||
      path.resolve(f.root) === path.resolve(scratch)
    )
      throw new Error('Unsafe test cleanup');
    await rm(f.root, { recursive: true, force: true });
  }
});

describe('audit: saved records and Windows paths', () => {
  it('can edit a valid handoff with more than 1,000 destination folders', async () => {
    const f = await fixture();
    const folders = Array.from({ length: 1001 }, (_, i) => `Destination ${i + 1}`);
    const batch = await f.service.importHandoff('test', {
      ...f.handoff,
      batchId: 'many-folders',
      handoffId: 'many-folders',
      folders,
    });
    const edit = editOf(batch);
    edit.clips[0].note = 'Saved after a large import';
    edit.clips[0].proposed.folder = folders.at(-1)!;
    await f.service.saveBatch('test', batch.id, edit);
    const saved = (await f.store.load('test')).batches.find((b) => b.id === batch.id)!;
    expect(saved.folders).toEqual(batch.folders);
    expect(saved.clips[0].note).toBe('Saved after a large import');
    expect(saved.clips[0].proposed.folder).toBe('Destination 1001');
    expect(await exists(path.join(f.mediaRoot, 'Clip.mp4'))).toBe(true);
  });
  it.each(['CON', 'NUL', 'aux', 'COM1', 'lpt9'])(
    'rejects reserved record ID %s before touching saved files',
    async (id) => {
      const f = await fixture();
      await expect(
        f.service.importHandoff('test', { ...f.handoff, batchId: id, handoffId: 'new' }),
      ).rejects.toThrow(/reserved Windows/);
      await expect(
        f.service.importHandoff('test', { ...f.handoff, handoffId: id, batchId: 'new' }),
      ).rejects.toThrow(/reserved Windows/);
      expect((await f.store.load('test')).batches).toHaveLength(1);
    },
  );
  it.each(['handoff', 'batch'] as const)(
    'rejects case-only %s IDs without overwriting saved records',
    async (kind) => {
      const f = await fixture();
      const file = path.join(
        f.dataDir,
        kind === 'handoff' ? 'imports/handoff.json' : 'batches/batch.json',
      );
      const before = await readFile(file);
      const next = {
        ...f.handoff,
        handoffId: 'next-handoff',
        batchId: 'next-batch',
        title: 'Must not replace original',
      };
      next[kind === 'handoff' ? 'handoffId' : 'batchId'] = kind.toUpperCase();
      await expect(f.service.importHandoff('test', next)).rejects.toThrow(
        /already|capitalization/i,
      );
      expect(await readFile(file)).toEqual(before);
      expect((await f.store.load('test')).batches).toHaveLength(1);
    },
  );
  it('rejects extension changes at import instead of deferring them until move review', async () => {
    const f = await fixture();
    const next = structuredClone(f.handoff);
    next.handoffId = next.batchId = 'wrong-extension';
    next.clips[0].proposed.filename = 'Wrong.mov';
    await expect(f.service.importHandoff('test', next)).rejects.toThrow(/extension/i);
    expect((await f.store.load('test')).batches).toHaveLength(1);
  });
  it('rejects directory separators inside an edited filename before moving', async () => {
    const f = await fixture();
    const edit = editOf(f.batch);
    edit.clips[0].proposed.filename = 'Unexpected/Nested.mp4';
    await f.service.saveBatch('test', f.batch.id, edit);
    expect(
      (await f.service.review('test', f.batch.id)).issues.map((i) => i.message).join(),
    ).toMatch(/separator|filename/i);
    expect(await exists(path.join(f.mediaRoot, 'Clip.mp4'))).toBe(true);
  });
  it.each(['inside existing plan', 'around existing footage', 'registry'] as const)(
    'rejects overlapping project storage: %s',
    async (scenario) => {
      const f = await fixture();
      const mediaRoot =
        scenario === 'inside existing plan'
          ? path.join(f.dataDir, 'other-media')
          : path.join(f.root, 'other-media');
      await mkdir(mediaRoot);
      const dataDir =
        scenario === 'around existing footage'
          ? path.dirname(f.mediaRoot)
          : scenario === 'registry'
            ? f.store.dataDir
            : path.join(f.root, 'other-plans');
      await expect(
        f.service.createProject({ id: 'other', name: 'Other', mediaRoot, dataDir }),
      ).rejects.toThrow(/separate|overlap|storage/i);
      expect((await f.store.registry()).map((p) => p.id)).toEqual(['test']);
    },
  );
  it('resumes cleanup after files were removed but registry bookkeeping failed', async () => {
    const f = await fixture();
    await writeFile(path.join(f.dataDir, 'Personal notes.txt'), 'Preserve me');
    vi.spyOn(f.store, 'forgetRemoved').mockRejectedValueOnce(
      new Error('Simulated disk write failure'),
    );
    expect(await f.service.deleteProject('test', true)).toMatchObject({
      removed: true,
      plansDeleted: false,
    });
    const [removed] = await f.service.removedProjects();
    expect(await exists(path.join(f.dataDir, 'state.json'))).toBe(false);
    await expect(f.service.cleanupProject(removed.removalId)).resolves.toEqual({
      retainedFiles: true,
    });
    expect(await f.service.removedProjects()).toEqual([]);
    expect(await readFile(path.join(f.dataDir, 'Personal notes.txt'), 'utf8')).toBe('Preserve me');
    expect(await exists(path.join(f.mediaRoot, 'Clip.mp4'))).toBe(true);
  });
  it('preserves records replaced after cleanup intent was saved', async () => {
    const f = await fixture();
    const record = f.store.recordCleanup.bind(f.store);
    vi.spyOn(f.store, 'recordCleanup').mockImplementationOnce(async (...args) => {
      await record(...args);
      throw new Error('Simulated interruption after durable cleanup intent');
    });
    expect(await f.service.deleteProject('test', true)).toHaveProperty('cleanupError');
    await writeFile(path.join(f.dataDir, 'state.json'), 'Replacement data: do not delete');
    const [removed] = await f.service.removedProjects();
    expect(removed.cleanupFiles?.length).toBeGreaterThan(0);
    await expect(f.service.cleanupProject(removed.removalId)).rejects.toThrow(
      'changed after cleanup',
    );
    expect(await readFile(path.join(f.dataDir, 'state.json'), 'utf8')).toContain(
      'Replacement data',
    );
    expect(await exists(path.join(f.dataDir, 'imports/handoff.json'))).toBe(true);
  });
});

describe('audit: moves, recovery, and older batches', () => {
  it('keeps ambiguous clip recovery blocking when the clip also appears in another batch', async () => {
    const f = await fixture();
    const next = await f.service.importHandoff('test', {
      ...f.handoff,
      handoffId: 'second',
      batchId: 'second',
    });
    const state = await f.store.load('test');
    state.operations.push({
      id: 'uncertain',
      batchId: f.batch.id,
      status: 'interrupted',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      items: [
        {
          clipId: 1,
          from: 'Clip.mp4',
          to: 'Uncertain.mp4',
          baseline: f.batch.clips[0].baseline!,
          status: 'ambiguous',
          error: 'Check this file',
        },
      ],
    });
    await f.store.save(state);
    const review = await f.service.review('test', next.id);
    expect(review.issues.map((i) => i.message).join()).toContain('ambiguous result');
    await expect(f.service.startMove('test', next.id, review.id)).rejects.toThrow(
      'blocking issues',
    );
    expect(await exists(path.join(f.mediaRoot, 'Clip.mp4'))).toBe(true);
  });
  it('does not return an unrelated batch operation when a move request is repeated', async () => {
    const f = await fixture();
    const review = await f.service.review('test', f.batch.id);
    await f.service.startMove('test', f.batch.id, review.id);
    await f.service.waitForIdle();
    await expect(f.service.startMove('test', 'another-batch', review.id)).rejects.toThrow(
      'different batch',
    );
    expect((await f.store.load('test')).operations).toHaveLength(1);
  });
  it('opens the current catalog location from an older batch after another batch moves the clip', async () => {
    const f = await fixture();
    const oldReview = await f.service.review('test', f.batch.id);
    await f.service.startMove('test', f.batch.id, oldReview.id);
    await f.service.waitForIdle();
    const next = structuredClone(f.handoff);
    next.handoffId = next.batchId = 'second';
    next.clips[0].source.relativePath = 'Filed/First.mp4';
    next.clips[0].proposed.filename = 'Second.mp4';
    await f.service.importHandoff('test', next);
    const nextReview = await f.service.review('test', next.batchId);
    await f.service.startMove('test', next.batchId, nextReview.id);
    await f.service.waitForIdle();
    const open = vi.spyOn(media, 'openMedia').mockResolvedValue();
    await f.service.player('test', f.batch.id, 1);
    expect(open).toHaveBeenCalledWith(path.join(f.mediaRoot, 'Filed/Second.mp4'));
  });
  it('blocks new moves when a failed save leaves a running journal, then recovers without restart', async () => {
    const f = await fixture();
    const approved = await f.service.review('test', f.batch.id);
    const save = f.store.save.bind(f.store);
    let calls = 0;
    const failure = vi.spyOn(f.store, 'save').mockImplementation(async (state) => {
      if (++calls > 1) throw new Error('Simulated full disk');
      return save(state);
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await f.service.startMove('test', f.batch.id, approved.id);
    await f.service.waitForIdle();
    failure.mockRestore();
    expect((await f.store.load('test')).operations[0].status).toBe('running');
    expect(
      (await f.service.review('test', f.batch.id)).issues.map((i) => i.message).join(),
    ).toMatch(/recovery/i);
    const recovered = await f.service.projectState('test');
    expect(recovered.operations[0].status).toBe('interrupted');
    expect(recovered.batches[0].clips[0].applied).toBe(false);
    expect(await exists(path.join(f.mediaRoot, 'Clip.mp4'))).toBe(true);
    const retry = await f.service.review('test', f.batch.id);
    expect(retry.issues).toEqual([]);
    await f.service.startMove('test', f.batch.id, retry.id);
    await f.service.waitForIdle();
    expect((await f.store.load('test')).operations.at(-1)?.status).toBe('completed');
  });
  it('reconciles a moved file after result persistence fails without replaying the move', async () => {
    const f = await fixture();
    const approved = await f.service.review('test', f.batch.id);
    const save = f.store.save.bind(f.store);
    const failure = vi.spyOn(f.store, 'save').mockImplementation(async (state) => {
      if (state.batches[0].clips[0].applied) throw new Error('Simulated result-write failure');
      return save(state);
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await f.service.startMove('test', f.batch.id, approved.id);
    await f.service.waitForIdle();
    failure.mockRestore();
    expect(await exists(path.join(f.mediaRoot, 'Clip.mp4'))).toBe(false);
    expect((await f.store.load('test')).operations[0].items[0].status).toBe('moving');
    const recovered = await f.service.projectState('test');
    expect(recovered.operations[0].status).toBe('completed');
    expect(recovered.catalog['1'].path).toBe('Filed/First.mp4');
    expect((await f.service.review('test', f.batch.id)).items).toEqual([]);
    expect(await readFile(path.join(f.mediaRoot, 'Filed/First.mp4'), 'utf8')).toContain(
      'embedded markers',
    );
  });
  it('waits for an in-flight save before shutdown and refuses later mutations', async () => {
    const f = await fixture();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const saving = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const save = f.store.save.bind(f.store);
    vi.spyOn(f.store, 'save').mockImplementationOnce(async (state) => {
      entered();
      await gate;
      return save(state);
    });
    const edit = editOf(f.batch);
    edit.notes = 'Last note before stopping';
    const pending = f.service.saveBatch('test', f.batch.id, edit);
    await saving;
    const stopped = f.service.prepareShutdown();
    expect(f.service.stopping).toBe(false);
    release();
    await pending;
    await stopped;
    expect(f.service.stopping).toBe(true);
    expect((await f.store.load('test')).batches[0].notes).toBe(edit.notes);
    await expect(f.service.importHandoff('test', f.handoff)).rejects.toThrow('stopping');
    await expect(f.service.deleteProject('test')).rejects.toThrow('stopping');
  });
});
