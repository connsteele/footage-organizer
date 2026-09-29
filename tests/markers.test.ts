import { afterAll, expect, it, vi } from 'vitest';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { Organizer } from '../src/server/service';
import { Store } from '../src/server/store';
import { exists, fingerprint, safePath, within } from '../src/server/paths';
import { loadConfig } from '../src/server/config';
import { moveWithoutReplacement } from '../src/server/move';
import { reviewInventory } from '../src/server/reviewFolders';
import { editOf, isPending, type Handoff } from '../src/shared/model';
import {
  markerExport,
  validateMarkerProposals,
  pendingMarkerChanges,
  effectiveMarkers,
} from '../src/shared/markers';
import { validateHandoff } from '../scripts/validate-handoff';
import { batchMarkdown } from '../src/shared/markdown';

const scratch = path.resolve(
  process.env.FO_TEST_DIR || path.join((await loadConfig()).tempDir, 'footage-organizer-tests'),
);
await mkdir(scratch, { recursive: true });
const roots: string[] = [],
  stores: Store[] = [];
const markers = [
  { id: 'embedded-1', chapterIndex: 0, seconds: 0, label: 'Old event' },
  { id: 'editor-1', seconds: 1, label: 'Editor note' },
];
const markerProposals = {
  schemaVersion: 1 as const,
  items: markers.map((m) => ({
    markerId: m.id,
    seconds: m.seconds,
    originalLabel: m.label,
    proposedLabel: `Clear ${m.label}`,
    rationale: 'Reviewed surrounding footage before naming the clip.',
  })),
};
async function fixture(move = moveWithoutReplacement) {
  const root = await mkdtemp(path.join(scratch, 'marker-'));
  roots.push(root);
  const media = path.join(root, 'media');
  await mkdir(media);
  await writeFile(path.join(media, 'Clip.mp4'), 'original media');
  const writer = {
    check: vi.fn(async () => ({ streams: [], chapters: [] })),
    prepare: vi.fn(async (_source: string, output: string) => {
      await writeFile(output, 'verified rewritten media', { flag: 'wx' });
    }),
  };
  const store = new Store(path.join(root, 'registry'));
  stores.push(store);
  const service = new Organizer(store, move, writer);
  await service.initialize();
  await service.createProject({
    id: 'markers',
    name: 'Markers',
    mediaRoot: media,
    dataDir: path.join(root, 'plans'),
  });
  const handoff: Handoff = {
    schemaVersion: 1,
    projectId: 'markers',
    batchId: 'batch',
    handoffId: 'handoff',
    title: 'Marker review',
    createdAt: new Date().toISOString(),
    reviewNotes: '',
    folders: [],
    clips: [
      {
        id: 1,
        source: { relativePath: 'Clip.mp4' },
        markers,
        markerProposals,
        proposed: { folder: '', filename: 'Clip.mp4' },
        duration: 2,
        rationale: '',
        questions: [],
        hold: false,
      },
    ],
  };
  const batch = await service.importHandoff('markers', validateHandoff(handoff));
  return { root, media, writer, store, service, batch };
}
afterAll(async () => {
  for (const store of stores) await store.release();
  for (const root of roots) {
    if (!within(scratch, root) || root === scratch) throw new Error('Unsafe test cleanup path');
    await rm(root, { recursive: true, force: true });
  }
});
async function accept(f: Awaited<ReturnType<typeof fixture>>, rename = false) {
  const edit = editOf((await f.store.load('markers')).batches[0]);
  edit.clips[0].markerDecisions![0].status = 'accepted';
  edit.clips[0].markerDecisions![1].status = 'rejected';
  if (rename) edit.clips[0].proposed = { folder: 'Filed', filename: 'New.mp4' };
  return f.service.saveBatch('markers', 'batch', edit);
}

it('persists add/delete/review decisions, exports active markers separately, and restores via an earlier edit', async () => {
  const f = await fixture();
  const before = editOf(f.batch);
  const edit = structuredClone(before);
  edit.clips[0].markerDecisions![0].status = 'deleted';
  edit.clips[0].localMarkers = [
    { origin: 'added', id: 'added-new', seconds: 1.5, label: 'New event', writeToFile: true },
  ];
  edit.clips[0].markerDecisions!.push({
    markerId: 'added-new',
    label: 'New event',
    status: 'accepted',
  });
  const batch = await f.service.saveBatch('markers', 'batch', edit);
  expect(pendingMarkerChanges(batch.clips[0])).toBe(1);
  expect(effectiveMarkers(batch.clips[0]).map((m) => m.label)).toEqual([
    'Editor note',
    'New event',
  ]);
  const exported = markerExport(batch.clips[0]);
  expect(exported.deletedMarkers[0].label).toBe('Old event');
  expect(exported.markers.map((m) => m.label)).toEqual(['Editor note', 'New event']);
  const review = await f.service.review('markers', 'batch');
  expect(review.items[0].markerChanges!.map((c) => c.action)).toEqual(['delete', 'add']);
  expect(await readFile(path.join(f.media, 'Clip.mp4'), 'utf8')).toBe('original media');
  before.revision = batch.revision;
  // Undo includes empty local collections, so additions are actually removed.
  before.clips[0].localMarkers = [];
  const restored = await f.service.saveBatch('markers', 'batch', before);
  expect(restored.clips[0].original.markers).toEqual(markers);
  expect(effectiveMarkers(restored.clips[0]).map((m) => m.label)).toEqual([
    'Old event',
    'Editor note',
  ]);
});

it('saves clip review for unchanged and filed clips without accepting markers or changing file work', async () => {
  const f = await fixture();
  expect(f.batch.clips[0].reviewed).toBe(false);
  const edit = editOf(f.batch);
  edit.clips[0].reviewed = true;
  const saved = await f.service.saveBatch('markers', 'batch', edit);
  expect(saved.clips[0].reviewed).toBe(true);
  expect(saved.clips[0].markerDecisions).toEqual(f.batch.clips[0].markerDecisions);
  expect(isPending(saved.clips[0])).toBe(false);
  const state = await f.store.load('markers');
  expect(batchMarkdown(state.project, saved)).toContain('| Reviewed |');
  state.batches[0].clips[0].applied = true;
  await f.store.save(state);
  const filed = editOf(state.batches[0]);
  filed.clips[0].reviewed = false;
  const unchecked = await f.service.saveBatch('markers', 'batch', filed);
  expect(unchecked.clips[0]).toMatchObject({ reviewed: false, applied: true });
  expect(await readFile(path.join(f.media, 'Clip.mp4'), 'utf8')).toBe('original media');
});

it('undoes the first decision on a discovered chapter when legacy state has no marker fields', async () => {
  const f = await fixture();
  const state = await f.store.load('markers');
  const clip = state.batches[0].clips[0];
  clip.original.markers = [];
  delete clip.original.markerProposals;
  delete clip.markerDecisions;
  delete clip.localMarkers;
  await f.store.save(state);
  const before = editOf(state.batches[0]);
  const edit = structuredClone(before);
  edit.clips[0].localMarkers = [
    {
      id: 'preview-chapter-0',
      origin: 'discovered',
      chapterIndex: 0,
      seconds: 0,
      label: 'Old event',
    },
  ];
  edit.clips[0].markerDecisions = [
    { markerId: 'preview-chapter-0', label: 'Old event', status: 'deleted' },
  ];
  const changed = await f.service.saveBatch('markers', 'batch', edit);
  before.revision = changed.revision;
  const restored = await f.service.saveBatch('markers', 'batch', before);
  expect(restored.clips[0].markerDecisions).toEqual([]);
  expect(restored.clips[0].localMarkers).toEqual([]);
});

it('rejects duplicate/out-of-range local markers and locks additions after filing', async () => {
  const f = await fixture();
  for (const seconds of [1, 2]) {
    const edit = editOf(f.batch);
    edit.clips[0].localMarkers = [
      { origin: 'added', id: 'added-new', seconds, label: 'Event', writeToFile: true },
    ];
    await expect(f.service.saveBatch('markers', 'batch', edit)).rejects.toThrow(
      /already exists|before the end/,
    );
  }
  await accept(f);
  const review = await f.service.review('markers', 'batch');
  await f.service.startMove('markers', 'batch', review.id);
  await f.service.waitForIdle();
  const edit = editOf((await f.store.load('markers')).batches[0]);
  edit.clips[0].localMarkers = [
    { origin: 'added', id: 'added-new', seconds: 1.5, label: 'Event', writeToFile: false },
  ];
  await expect(f.service.saveBatch('markers', 'batch', edit)).rejects.toThrow('locked');
});

it('validates identity, original label and time, including duplicate timestamps and legacy IDs', () => {
  expect(() => validateMarkerProposals(markers, markerProposals)).not.toThrow();
  for (const items of [
    [...markerProposals.items, markerProposals.items[0]],
    [{ ...markerProposals.items[0], markerId: 'missing' }],
    [{ ...markerProposals.items[0], seconds: 0.5 }],
    [{ ...markerProposals.items[0], originalLabel: 'Invented' }],
  ])
    expect(() => validateMarkerProposals(markers, { schemaVersion: 1, items })).toThrow();
  expect(() =>
    validateMarkerProposals([
      { seconds: 0, label: 'A' },
      { id: 'marker-1', seconds: 0, label: 'B' },
    ]),
  ).toThrow();
  expect(() =>
    validateMarkerProposals([
      { id: 'a', seconds: 0, label: 'A' },
      { id: 'b', seconds: 0, label: 'B' },
    ]),
  ).not.toThrow();
});

it('saves reversible decisions without touching media, and includes marker-only work in Move clips', async () => {
  const f = await fixture();
  expect(isPending(f.batch.clips[0])).toBe(false);
  const saved = await accept(f);
  expect(await readFile(path.join(f.media, 'Clip.mp4'), 'utf8')).toBe('original media');
  expect(saved.clips[0].original.markers).toEqual(markers);
  expect(isPending(saved.clips[0])).toBe(true);
  expect(markerExport(saved.clips[0]).markers.map((m) => m.label)).toEqual([
    'Clear Old event',
    'Editor note',
  ]);
  const review = await f.service.review('markers', 'batch');
  expect(review.items[0].markerChanges).toHaveLength(1);
  expect(review.items[0].from).toBe(review.items[0].to);
  const edit = editOf(saved);
  edit.clips[0].held = true;
  await f.service.saveBatch('markers', 'batch', edit);
  expect((await f.service.review('markers', 'batch')).items).toHaveLength(0);
});

it.each([false, true])(
  'publishes a verified rewrite and retains the original (rename=%s)',
  async (rename) => {
    const f = await fixture();
    await accept(f, rename);
    const review = await f.service.review('markers', 'batch');
    expect(review.issues).toEqual([]);
    await f.service.startMove('markers', 'batch', review.id);
    await f.service.waitForIdle();
    const state = await f.store.load('markers'),
      item = state.operations[0].items[0];
    expect(item.status).toBe('succeeded');
    expect(await readFile(path.join(f.media, item.markerRewrite!.backupPath), 'utf8')).toBe(
      'original media',
    );
    expect(await readFile(path.join(f.media, item.to), 'utf8')).toBe('verified rewritten media');
    expect(state.catalog['1'].baseline).toEqual(await fingerprint(path.join(f.media, item.to)));
    expect(await f.service.mediaFile('markers', 'batch', 1)).toBeTruthy();
    const filedEdit = editOf(state.batches[0]);
    filedEdit.clips[0].markerDecisions![0].label = 'Too late';
    await expect(f.service.saveBatch('markers', 'batch', filedEdit)).rejects.toThrow('locked');
  },
);

it('preserves source when preparation fails and never archives an unverified result', async () => {
  const f = await fixture();
  await accept(f);
  f.writer.prepare.mockRejectedValueOnce(new Error('Hash mismatch'));
  const review = await f.service.review('markers', 'batch');
  await f.service.startMove('markers', 'batch', review.id);
  await f.service.waitForIdle();
  const item = (await f.store.load('markers')).operations[0].items[0];
  expect(item.status).toBe('failed');
  expect(await readFile(path.join(f.media, 'Clip.mp4'), 'utf8')).toBe('original media');
  expect(await exists(path.join(f.media, item.markerRewrite!.backupPath))).toBe(false);
});

it('restores an interrupted publication without overwriting files, then permits a fresh review', async () => {
  let moves = 0;
  const f = await fixture(async (from, to) => {
    if (++moves === 2) throw new Error('Simulated publication failure');
    await moveWithoutReplacement(from, to);
  });
  await accept(f);
  const review = await f.service.review('markers', 'batch');
  await f.service.startMove('markers', 'batch', review.id);
  await f.service.waitForIdle();
  expect((await f.store.load('markers')).operations[0].items[0].status).toBe('ambiguous');
  await writeFile(path.join(f.media, 'Clip.mp4'), 'a different file');
  await expect(f.service.restoreMarkerOriginal('markers', review.id, 1)).rejects.toThrow(
    'occupied',
  );
  // This file is a disposable fixture created immediately above, not user footage.
  await rm(path.join(f.media, 'Clip.mp4'));
  await f.service.restoreMarkerOriginal('markers', review.id, 1);
  expect(await readFile(path.join(f.media, 'Clip.mp4'), 'utf8')).toBe('original media');
  const retry = await f.service.review('markers', 'batch');
  expect(retry.issues).toEqual([]);
  await f.service.startMove('markers', 'batch', retry.id);
  await f.service.waitForIdle();
  expect((await f.store.load('markers')).batches[0].clips[0].applied).toBe(true);
});

it('recognizes publication that completed just before a helper error', async () => {
  let moves = 0;
  const f = await fixture(async (from, to) => {
    await moveWithoutReplacement(from, to);
    if (++moves === 2) throw new Error('Timeout after publish');
  });
  await accept(f, true);
  const review = await f.service.review('markers', 'batch');
  await f.service.startMove('markers', 'batch', review.id);
  await f.service.waitForIdle();
  expect((await f.store.load('markers')).operations[0].items[0].status).toBe('succeeded');
});

it('exports markers or explicit scan failures, detecting files changed during extraction', async () => {
  const f = await fixture();
  const state = await f.store.load('markers');
  const probe = vi.fn(async () => ({ video: null, audio: [], markers }));
  const read = await reviewInventory(state, '', { includeMarkers: true, probe });
  expect(read.files[0]).toMatchObject({ markerStatus: 'read', markers });
  const unavailable = await reviewInventory(state, '', {
    includeMarkers: true,
    probe: async () => ({ video: null, audio: [], markers: [], note: 'Probe missing' }),
  });
  expect(unavailable.files[0]).toMatchObject({
    markerStatus: 'unavailable',
    markerNote: 'Probe missing',
  });
  const limited = await reviewInventory(state, '', { includeMarkers: true, probe, budgetMs: -1 });
  expect(limited.files[0].markerStatus).toBe('not-scanned');
  const changed = await reviewInventory(state, '', {
    includeMarkers: true,
    probe: async () => {
      await writeFile(path.join(f.media, 'Clip.mp4'), 'changed during probe');
      return { video: null, audio: [], markers };
    },
  });
  expect(changed.files[0]).toMatchObject({
    markerStatus: 'unavailable',
    markerNote: expect.stringContaining('changed'),
  });
});

it('held follow-ups preserve originals and detect marker decisions changed after export', async () => {
  const f = await fixture();
  const edit = editOf(f.batch);
  edit.clips[0].held = true;
  await f.service.saveBatch('markers', 'batch', edit);
  const { request } = await f.service.updates.exportHeld('markers', 'batch');
  const update = {
    schemaVersion: 1,
    kind: 'batch-update',
    updateId: 'followup',
    requestId: request.id,
    projectId: 'markers',
    batchId: 'batch',
    createdAt: new Date().toISOString(),
    clips: [
      {
        id: 1,
        proposed: edit.clips[0].proposed,
        rationale: 'Markers informed the clip name',
        markerProposals,
      },
    ],
  };
  const preview = await f.service.updates.preview('markers', 'batch', update);
  expect(preview.clips[0].conflicts).toEqual([]);
  await accept(f);
  expect(
    (await f.service.updates.preview('markers', 'batch', update)).clips[0].conflicts,
  ).toContain('Your notes or suggestions changed after this review was exported.');
});

it('held follow-ups include added markers, reject deleted ones and detect changed local evidence', async () => {
  const f = await fixture();
  const edit = editOf(f.batch);
  edit.clips[0].held = true;
  edit.clips[0].markerDecisions![0].status = 'deleted';
  edit.clips[0].localMarkers = [
    { id: 'added-note', origin: 'added', seconds: 1.5, label: 'New note', writeToFile: false },
  ];
  edit.clips[0].markerDecisions!.push({
    markerId: 'added-note',
    label: 'New note',
    status: 'accepted',
  });
  await f.service.saveBatch('markers', 'batch', edit);
  const { request } = await f.service.updates.exportHeld('markers', 'batch');
  expect(request.clips[0].localMarkers).toEqual(edit.clips[0].localMarkers);
  const update = {
    schemaVersion: 1,
    kind: 'batch-update',
    updateId: 'local-followup',
    requestId: request.id,
    projectId: 'markers',
    batchId: 'batch',
    createdAt: new Date().toISOString(),
    clips: [
      {
        id: 1,
        proposed: edit.clips[0].proposed,
        rationale: 'Reviewed new event',
        markerProposals: {
          schemaVersion: 1,
          items: [
            {
              markerId: 'added-note',
              seconds: 1.5,
              originalLabel: 'New note',
              proposedLabel: 'Clearer new note',
              rationale: '',
            },
          ],
        },
      },
    ],
  };
  const preview = await f.service.updates.preview('markers', 'batch', update);
  expect(preview.clips[0].conflicts).toEqual([]);
  const deleted = structuredClone(update);
  deleted.clips[0].markerProposals.items = [markerProposals.items[0]];
  await expect(f.service.updates.preview('markers', 'batch', deleted)).rejects.toThrow(
    'deleted marker',
  );
  const changed = editOf((await f.store.load('markers')).batches[0]);
  if (changed.clips[0].localMarkers![0].origin === 'added')
    changed.clips[0].localMarkers![0].writeToFile = true;
  await f.service.saveBatch('markers', 'batch', changed);
  expect(
    (await f.service.updates.preview('markers', 'batch', update)).clips[0].conflicts,
  ).not.toEqual([]);
});

it('retains unmentioned marker decisions and reasoning across successive held follow-ups', async () => {
  const f = await fixture();
  const edit = editOf(await accept(f));
  edit.clips[0].held = true;
  edit.clips[0].reviewed = true;
  await f.service.saveBatch('markers', 'batch', edit);
  for (let index = 0; index < 2; index++) {
    const { request } = await f.service.updates.exportHeld('markers', 'batch');
    const update = {
      schemaVersion: 1,
      kind: 'batch-update',
      updateId: `update-${index}`,
      requestId: request.id,
      projectId: 'markers',
      batchId: 'batch',
      createdAt: new Date().toISOString(),
      clips: [
        {
          id: 1,
          proposed: edit.clips[0].proposed,
          rationale: 'Marker-first follow-up',
          ...(index === 0
            ? {
                markerProposals: {
                  schemaVersion: 1,
                  items: [
                    {
                      ...markerProposals.items[1],
                      proposedLabel: 'Revised editor note',
                      rationale: 'New marker reasoning',
                    },
                  ],
                },
              }
            : {}),
        },
      ],
    };
    const preview = await f.service.updates.preview('markers', 'batch', update);
    const saved = await f.service.updates.apply('markers', 'batch', {
      update,
      revision: preview.revision,
      clipIds: [1],
    });
    expect(saved.clips[0].original.markers).toEqual(markers);
    expect(saved.clips[0].reviewed).toBe(false);
    expect(saved.clips[0].markerDecisions?.find((d) => d.markerId === 'embedded-1')?.status).toBe(
      'accepted',
    );
    expect(saved.clips[0].markerDecisions?.find((d) => d.markerId === 'editor-1')).toMatchObject({
      status: 'pending',
      label: 'Revised editor note',
    });
    expect(
      saved.clips[0].agentReview?.markerProposals?.items.find((p) => p.markerId === 'editor-1')
        ?.rationale,
    ).toBe('New marker reasoning');
  }
});

it('reconciles a persisted crash after publication using prepared and backup identities', async () => {
  const f = await fixture();
  await accept(f, true);
  const state = await f.store.load('markers'),
    clip = state.batches[0].clips[0];
  const preparedPath = '.footage-organizer-work/crash/1.mp4',
    backupPath = '.footage-organizer-originals/crash/1.mp4';
  const prepared = await safePath(f.media, preparedPath, true);
  await writeFile(prepared, 'verified prepared file');
  const preparedBaseline = await fingerprint(prepared);
  state.operations.push({
    id: 'crash',
    batchId: 'batch',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'running',
    items: [
      {
        clipId: 1,
        from: 'Clip.mp4',
        to: 'Filed/New.mp4',
        baseline: clip.baseline!,
        status: 'moving',
        error: null,
        markerRewrite: { preparedPath, backupPath, preparedBaseline },
      },
    ],
  });
  await f.store.save(state);
  await moveWithoutReplacement(
    path.join(f.media, 'Clip.mp4'),
    await safePath(f.media, backupPath, true),
  );
  await moveWithoutReplacement(prepared, await safePath(f.media, 'Filed/New.mp4', true));
  await f.store.release();
  const reopenedStore = new Store(path.join(f.root, 'registry'));
  stores.push(reopenedStore);
  const reopened = new Organizer(reopenedStore);
  await reopened.initialize();
  const recovered = await reopenedStore.load('markers');
  expect(recovered.operations[0].status).toBe('completed');
  expect(recovered.catalog['1'].baseline).toEqual(preparedBaseline);
  expect(recovered.batches[0].clips[0].applied).toBe(true);
  expect(await readFile(path.join(f.media, backupPath), 'utf8')).toBe('original media');
});
