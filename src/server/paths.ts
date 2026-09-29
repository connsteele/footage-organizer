import path from 'node:path';
import { lstat, realpath, stat, readdir, mkdir } from 'node:fs/promises';
import type { Baseline } from '../shared/model.js';
import { filenameProblem } from '../shared/filenames.js';
export { filenameProblem } from '../shared/filenames.js';

export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export function errorCode(error: unknown) {
  return (error as NodeJS.ErrnoException)?.code;
}
export function relativePath(value: string, allowEmpty = false) {
  const normalized = value.replaceAll('\\', '/');
  if (allowEmpty && normalized === '') return '';
  const parts = normalized.split('/');
  if (parts.some((p) => filenameProblem(p))) throw new AppError(`Invalid relative path: ${value}`);
  return normalized;
}
export function within(root: string, candidate: string) {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}
export async function exists(value: string) {
  try {
    await lstat(value);
    return true;
  } catch (e) {
    if (errorCode(e) === 'ENOENT') return false;
    throw e;
  }
}
export async function canonicalRoot(value: string) {
  if (!path.isAbsolute(value)) throw new AppError('Choose an absolute folder path.');
  const resolved = path.resolve(value);
  const info = await lstat(resolved);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new AppError('Choose a regular folder, not a linked folder.');
  const actual = await realpath(resolved);
  if (actual.toLowerCase() !== resolved.toLowerCase())
    throw new AppError(
      'The folder path passes through a linked directory. Choose its real location.',
    );
  return actual;
}
// Walk every existing component. A project path must not pass through a junction/symlink.
export async function safePath(root: string, relative: string, createParents = false) {
  const rel = relativePath(relative);
  await canonicalRoot(root);
  const parts = rel.split('/');
  let current = root;
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    const isParent = index < parts.length - 1;
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new AppError(`Linked paths are not supported: ${rel}`);
      if (isParent && !info.isDirectory()) throw new AppError(`A parent is not a folder: ${rel}`);
      const actual = await realpath(current);
      if (!within(root, actual)) throw new AppError('The path leaves the media root.');
    } catch (e) {
      if (errorCode(e) !== 'ENOENT') throw e;
      if (isParent && createParents) {
        await mkdir(current).catch((e) => {
          if (errorCode(e) !== 'EEXIST') throw e;
        });
        const info = await lstat(current);
        if (!info.isDirectory() || info.isSymbolicLink() || !within(root, await realpath(current)))
          throw new AppError('Destination folder changed. Check it before retrying.');
      }
    }
  }
  return current;
}
export async function fingerprint(file: string): Promise<Baseline> {
  const info = await lstat(file, { bigint: true });
  if (!info.isFile() || info.isSymbolicLink())
    throw new AppError('Only regular files can be moved.');
  if (info.ino === 0n)
    throw new AppError('This filesystem does not provide a stable file identity.');
  return {
    size: Number(info.size),
    mtimeMs: Number(info.mtimeNs) / 1e6,
    mtimeNs: String(info.mtimeNs),
    dev: String(info.dev),
    ino: String(info.ino),
  };
}
export function sameFile(a: Baseline, b: Baseline) {
  return a.size === b.size && a.mtimeNs === b.mtimeNs && a.dev === b.dev && a.ino === b.ino;
}
export async function parentDevice(file: string): Promise<string> {
  let candidate = path.dirname(file);
  while (!(await exists(candidate))) candidate = path.dirname(candidate);
  return String((await stat(candidate, { bigint: true })).dev);
}
export async function scanFolders(root: string, max = 1000) {
  const output: string[] = [];
  async function walk(directory: string, depth: number) {
    if (depth > 10 || output.length >= max) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      const full = path.join(directory, entry.name);
      output.push(path.relative(root, full).replaceAll('\\', '/'));
      if (output.length >= max) break;
      await walk(full, depth + 1);
    }
  }
  await canonicalRoot(root);
  await walk(root, 0);
  return output.sort();
}
