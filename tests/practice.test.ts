import { afterAll, expect, it } from 'vitest';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { practiceHandoff } from '../scripts/practice-fixture';
import { validateHandoff } from '../scripts/validate-handoff';
import { Organizer } from '../src/server/service';
import { Store } from '../src/server/store';
import { exists, safePath, within } from '../src/server/paths';
import { loadConfig } from '../src/server/config';
import { editOf } from '../src/shared/model';

const scratch = path.resolve(
  process.env.FO_TEST_DIR || path.join((await loadConfig()).tempDir, 'footage-organizer-tests'),
);
await mkdir(scratch, { recursive: true });
const roots: string[] = [];
const stores: Store[] = [];
afterAll(async () => {
  for (const store of stores) await store.release();
  for (const root of roots) {
    if (!within(scratch, root) || root === scratch) throw new Error('Unsafe test cleanup path');
    await rm(root, { recursive: true, force: true });
  }
});

it('teaches six moves, a hold and an unchanged clip without replacing an earlier practice batch', async () => {
  const root = await mkdtemp(path.join(scratch, 'practice-'));
  roots.push(root);
  const media = path.join(root, 'media');
  await mkdir(media);
  const store = new Store(path.join(root, 'registry'));
  stores.push(store);
  const service = new Organizer(store);
  await service.initialize();
  await service.createProject({
    id: 'practice',
    name: 'Practice project',
    mediaRoot: media,
    dataDir: path.join(root, 'plans'),
  });
  await writeFile(path.join(media, 'Earlier.mp4'), 'earlier footage');
  const old = practiceHandoff(40);
  old.handoffId = 'earlier-handoff';
  old.batchId = 'earlier-batch';
  old.reviewFolder = '';
  old.clips = [
    {
      ...old.clips[0],
      source: { relativePath: 'Earlier.mp4' },
      proposed: { folder: '', filename: 'Earlier.mp4' },
    },
  ];
  const oldBatch = await service.importHandoff('practice', old);
  const oldEdit = editOf(oldBatch);
  oldEdit.clips[0].note = 'Keep my earlier decision';
  oldEdit.clips[0].held = true;
  await service.saveBatch('practice', oldBatch.id, oldEdit);
  const before = await store.load('practice');

  const handoff = validateHandoff(practiceHandoff(41));
  for (const [index, clip] of handoff.clips.entries()) {
    await writeFile(
      await safePath(media, clip.source.relativePath, true),
      `generated fixture ${clip.id}`,
    );
    if (index !== 7) await safePath(media, `${clip.proposed.folder}/placeholder.mp4`, true);
  }
  const batch = await service.importHandoff('practice', handoff);
  const review = await service.review('practice', batch.id);
  expect(review.issues).toEqual([]);
  expect(review.items.map((item) => item.clipId)).toEqual([41, 42, 43, 44, 46, 48]);
  expect(review.held).toBe(1);
  expect(review.unchanged).toBe(1);
  expect(review.newFolders).toEqual([handoff.clips[7].proposed.folder]);
  expect(review.items[0].from.split('/').slice(0, -1)).toEqual(
    review.items[0].to.split('/').slice(0, -1),
  );
  expect(path.basename(review.items[1].from)).toBe(path.basename(review.items[1].to));
  expect(batch.clips[3].original.markers).toEqual(handoff.clips[3].markers);

  await service.startMove('practice', batch.id, review.id);
  await service.waitForIdle();
  const after = await store.load('practice');
  expect(after.operations[0].status).toBe('completed');
  expect(after.batches.find((b) => b.id === oldBatch.id)).toEqual(before.batches[0]);
  expect(await readFile(path.join(media, 'Earlier.mp4'), 'utf8')).toBe('earlier footage');
  const filed = after.batches.find((b) => b.id === batch.id)!;
  expect(filed.clips.filter((clip) => clip.applied)).toHaveLength(6);
  expect(filed.clips.filter((clip) => !clip.applied).map((clip) => clip.id)).toEqual([45, 47]);
  for (const item of review.items)
    expect(await readFile(path.join(media, item.to), 'utf8')).toBe(
      `generated fixture ${item.clipId}`,
    );
  for (const index of [4, 6])
    expect(await exists(path.join(media, handoff.clips[index].source.relativePath))).toBe(true);
  expect(await exists(path.join(media, handoff.folders[0]))).toBe(false);
  expect(await service.importHandoff('practice', handoff)).toEqual(filed);
  expect((await store.load('practice')).batches).toHaveLength(2);
});
