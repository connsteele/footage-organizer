import { afterEach, expect, it, vi } from 'vitest';
import path from 'node:path';
import { mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { atomicWrite } from '../src/server/store';
import { loadConfig } from '../src/server/config';
import { within } from '../src/server/paths';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});
const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
const scratch = path.resolve(
  process.env.FO_TEST_DIR || path.join((await loadConfig()).tempDir, 'footage-organizer-tests'),
);
await mkdir(scratch, { recursive: true });
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    if (!within(scratch, root) || root === scratch) throw new Error('Unsafe test cleanup');
    await rm(root, { recursive: true, force: true });
  }
});

it.each(['writeFile', 'sync'] as const)(
  'preserves the saved record and removes temporary output after a %s failure',
  async (stage) => {
    const root = await mkdtemp(path.join(scratch, 'atomic-write-'));
    roots.push(root);
    const file = path.join(root, 'state.json');
    await writeFile(file, '{"revision":1}\n');
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await actual.open(...args);
      vi.spyOn(handle, stage).mockRejectedValueOnce(new Error('Simulated full disk'));
      return handle;
    });
    await expect(atomicWrite(file, { revision: 2 })).rejects.toThrow('Simulated full disk');
    expect(await readFile(file, 'utf8')).toBe('{"revision":1}\n');
    expect(await readdir(root)).toEqual(['state.json']);
    await atomicWrite(file, { revision: 2 });
    expect(JSON.parse(await readFile(file, 'utf8')).revision).toBe(2);
  },
);
