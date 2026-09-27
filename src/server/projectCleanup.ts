import path from 'node:path';
import { readFile, readdir, rmdir, unlink } from 'node:fs/promises';
import { stateSchema, type RemovedProject } from '../shared/model.js';
import {
  AppError,
  canonicalRoot,
  errorCode,
  exists,
  fingerprint,
  sameFile,
  safePath,
  within,
} from './paths.js';
import type { Store } from './store.js';

// Delete only known app records. Never recursively remove a user-selected directory.
export async function cleanupProjectPlans(store: Store, removed: RemovedProject) {
  const directory = path.resolve(removed.project.dataDir);
  const mediaRoot = path.resolve(removed.project.mediaRoot);
  const registryRoot = path.resolve(store.dataDir);
  const overlaps = (a: string, b: string) => within(a, b) || within(b, a);
  if (overlaps(directory, mediaRoot) || overlaps(directory, registryRoot))
    throw new AppError(
      'This plan folder overlaps footage or app storage. It cannot be cleaned up.',
    );
  for (const entry of await store.registry()) {
    if (overlaps(directory, path.resolve(entry.dataDir)))
      throw new AppError('This plan folder is in use by an active project.');
    const active = await store.load(entry.id);
    if (overlaps(directory, path.resolve(active.project.mediaRoot)))
      throw new AppError('This plan folder overlaps an active footage folder.');
  }
  if (!(await exists(directory))) return { retainedFiles: false };
  await canonicalRoot(directory);
  await store.lock(directory);
  try {
    for (const folder of ['imports', 'batches', 'operations', 'checkpoints'])
      await safePath(directory, folder);
    let cleanupFiles = removed.cleanupFiles;
    if (!cleanupFiles) {
      const stateFile = await safePath(directory, 'state.json');
      if (!(await exists(stateFile)))
        throw new AppError(
          'Saved project state is missing, so the app cannot verify which records to delete. No additional files were deleted.',
        );
      const state = stateSchema.parse(JSON.parse(await readFile(stateFile, 'utf8')));
      if (
        state.project.id !== removed.project.id ||
        path.resolve(state.project.dataDir).toLowerCase() !== directory.toLowerCase() ||
        path.resolve(state.project.mediaRoot).toLowerCase() !== mediaRoot.toLowerCase()
      )
        throw new AppError(
          'The saved project no longer matches this removed project. Its files were left untouched.',
        );
      const records: string[] = [];
      for (const batch of state.batches)
        records.push(
          `imports/${batch.handoffId}.json`,
          `batches/${batch.id}.json`,
          `batches/${batch.id}.md`,
        );
      for (const operation of state.operations) records.push(`operations/${operation.id}.json`);
      const checkpoints = await safePath(directory, 'checkpoints');
      if (await exists(checkpoints)) {
        for (const name of await readdir(checkpoints))
          if (/^\d+\.json$/.test(name)) {
            const checkpoint = stateSchema.parse(
              JSON.parse(await readFile(await safePath(directory, `checkpoints/${name}`), 'utf8')),
            );
            if (
              checkpoint.project.id !== state.project.id ||
              path.resolve(checkpoint.project.dataDir).toLowerCase() !== directory.toLowerCase()
            )
              throw new AppError('A checkpoint belongs to another project. No files were deleted.');
            records.push(`checkpoints/${name}`);
          }
      }
      records.push('state.json'); // Retain the authoritative state until other records are removed, so cleanup can retry.
      cleanupFiles = [];
      // Validate every path before deleting any record, including linked ancestors and non-files.
      for (const record of new Set(records)) {
        const file = await safePath(directory, record);
        if (await exists(file)) {
          cleanupFiles.push({ relativePath: record, baseline: await fingerprint(file) });
        }
      }
      // Persist verified identities before deleting anything. A retry no longer depends
      // on state.json surviving the last unlink or registry-write failure.
      await store.recordCleanup(removed.removalId, cleanupFiles);
    }
    const files: string[] = [];
    for (const record of cleanupFiles) {
      const file = await safePath(directory, record.relativePath);
      if (!(await exists(file))) continue;
      if (!sameFile(record.baseline, await fingerprint(file)))
        throw new AppError(
          'A saved record changed after cleanup began. Its files were left untouched.',
        );
      files.push(file);
    }
    for (const file of files) await unlink(file);
    for (const folder of ['imports', 'batches', 'operations', 'checkpoints']) {
      const full = await safePath(directory, folder);
      // Empty-directory removal is optional; preserve anything else in these folders.
      await rmdir(full).catch(() => undefined);
    }
  } finally {
    await store.unlock(directory);
  }
  try {
    await rmdir(directory);
    return { retainedFiles: false };
  } catch (e) {
    if (['ENOTEMPTY', 'EEXIST'].includes(errorCode(e) ?? '')) return { retainedFiles: true };
    throw e;
  }
}
