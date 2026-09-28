import path from 'node:path';
import { readdir } from 'node:fs/promises';
import type { ProjectState, ReviewInventory } from '../shared/model.js';
import {
  AppError,
  canonicalRoot,
  fingerprint,
  relativePath,
  safePath,
  sameFile,
  within,
} from './paths.js';
import { inspectMedia } from './mediaInfo.js';

export async function resolveReviewFolder(root: string, folder: string) {
  const absolute = path.isAbsolute(folder)
    ? path.resolve(folder)
    : path.resolve(root, relativePath(folder, true));
  if (!within(root, absolute)) throw new AppError('Review Footage must be inside Root Footage.');
  const actual = await canonicalRoot(absolute);
  if (!within(root, actual)) throw new AppError('Review Footage must be inside Root Footage.');
  return path.relative(root, actual).replaceAll('\\', '/');
}

const mediaExtensions = new Set([
  '.mp4',
  '.mov',
  '.mkv',
  '.webm',
  '.avi',
  '.m4v',
  '.mxf',
  '.mts',
  '.m2ts',
  '.mp3',
  '.wav',
  '.flac',
  '.m4a',
]);
export async function reviewInventory(
  state: ProjectState,
  folder: string,
  options: { includeMarkers?: boolean; probe?: typeof inspectMedia; budgetMs?: number } = {},
): Promise<ReviewInventory> {
  const root = state.project.mediaRoot;
  const relative = await resolveReviewFolder(root, folder);
  const result: ReviewInventory = {
    folder: relative,
    absoluteFolder: path.join(root, relative),
    scannedAt: new Date().toISOString(),
    files: [],
    skippedFiles: 0,
  };
  const catalog = new Map(
    Object.entries(state.catalog).map(([id, clip]) => [clip.path.toLowerCase(), Number(id)]),
  );
  let directories = 0;
  async function scan(directory: string, depth: number) {
    if (++directories > 1000 || depth > 10)
      throw new AppError('This review folder is too broad. Choose a smaller session folder.');
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) {
        result.skippedFiles++;
        continue;
      }
      const rel = path.relative(root, path.join(directory, entry.name)).replaceAll('\\', '/');
      if (entry.isDirectory()) {
        await scan(await safePath(root, rel), depth + 1);
      } else if (entry.isFile() && mediaExtensions.has(path.extname(entry.name).toLowerCase())) {
        if (result.files.length >= 10000)
          throw new AppError(
            'More than 10,000 media files were found. Choose a smaller review folder.',
          );
        const info = await fingerprint(await safePath(root, rel));
        const id = catalog.get(rel.toLowerCase()) ?? null;
        result.files.push({
          relativePath: rel,
          size: info.size,
          mtimeMs: info.mtimeMs,
          existingClipId: id,
          batchIds:
            id === null
              ? []
              : state.batches.filter((b) => b.clips.some((c) => c.id === id)).map((b) => b.id),
        });
      } else result.skippedFiles++;
    }
  }
  await scan(result.absoluteFolder, 0);
  result.files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  if (options.includeMarkers) {
    const probe = options.probe ?? inspectMedia;
    const deadline = Date.now() + (options.budgetMs ?? 60000);
    let cursor = 0;
    let markerBytes = 0;
    // Bound concurrent disk/probe work and return an explicit status for every file.
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        while (cursor < result.files.length) {
          const index = cursor++,
            entry = result.files[index];
          if (index >= 500 || Date.now() >= deadline) {
            entry.markerStatus = 'not-scanned';
            entry.markerNote =
              'Marker scan limit reached. Choose a smaller review folder, or supply markers separately.';
            continue;
          }
          try {
            const file = await safePath(root, entry.relativePath),
              before = await fingerprint(file);
            const info = await probe(file);
            if (
              !sameFile(before, await fingerprint(file)) ||
              before.size !== entry.size ||
              Math.abs(before.mtimeMs - entry.mtimeMs) > 1
            )
              throw new Error('File changed during marker extraction. Download a fresh kit.');
            if (info.note) throw new Error(info.note);
            const bytes = Buffer.byteLength(JSON.stringify(info.markers));
            if (markerBytes + bytes > 4 * 1024 * 1024) {
              entry.markerStatus = 'not-scanned';
              entry.markerNote =
                'Marker export size limit reached. Choose a smaller review folder.';
              continue;
            }
            markerBytes += bytes;
            entry.markers = info.markers;
            entry.markerStatus = 'read';
          } catch (error) {
            entry.markerStatus = 'unavailable';
            entry.markerNote =
              error instanceof Error ? error.message : 'Markers could not be read.';
          }
        }
      }),
    );
  }
  return result;
}
