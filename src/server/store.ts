import path from 'node:path';
import { mkdir, open, readFile, rename, readdir, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  safeId,
  stateSchema,
  removedProjectSchema,
  type ProjectState,
  type RemovedProject,
} from '../shared/model.js';
import { batchMarkdown } from '../shared/markdown.js';
import { AppError, errorCode } from './paths.js';

export async function atomicWrite(file: string, value: unknown, raw = false) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temp, 'wx');
  try {
    await handle.writeFile(raw ? String(value) : JSON.stringify(value, null, 2) + '\n', 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temp, file);
  } catch (e) {
    await unlink(temp).catch(() => undefined);
    throw e;
  }
}
const registrySchema = z.array(z.object({ id: safeId, dataDir: z.string() }));
export class Store {
  private queue: Promise<unknown> = Promise.resolve();
  private locks = new Set<string>();
  constructor(public dataDir: string) {}
  serial<T>(task: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(task, task);
    this.queue = pending.catch(() => undefined);
    return pending;
  }
  async registry() {
    try {
      return registrySchema.parse(
        JSON.parse(await readFile(path.join(this.dataDir, 'projects.json'), 'utf8')),
      );
    } catch (e) {
      if (errorCode(e) === 'ENOENT') return [];
      throw e;
    }
  }
  async lock(directory: string) {
    const file = path.join(directory, '.organizer.lock');
    if (this.locks.has(file)) return;
    await mkdir(directory, { recursive: true });
    const acquire = async () => {
      const handle = await open(file, 'wx');
      await handle.writeFile(JSON.stringify({ pid: process.pid }));
      await handle.close();
      this.locks.add(file);
    };
    try {
      await acquire();
    } catch (e) {
      if (errorCode(e) !== 'EEXIST') throw e;
      let owner: { pid: number };
      try {
        owner = JSON.parse(await readFile(file, 'utf8'));
      } catch {
        throw new AppError(
          `Unreadable application lock: ${file}. Check that the other app is stopped.`,
          409,
        );
      }
      if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0)
        throw new AppError(`Invalid application lock: ${file}`, 409);
      let alive = true;
      try {
        process.kill(owner.pid, 0);
      } catch (err) {
        if (errorCode(err) === 'ESRCH') alive = false;
      }
      if (alive)
        throw new AppError(
          `This plan folder is already open in another Footage Organizer process: ${directory}`,
          409,
        );
      await unlink(file);
      await acquire();
    }
  }
  async unlock(directory: string) {
    const file = path.join(directory, '.organizer.lock');
    if (!this.locks.has(file)) return;
    try {
      await unlink(file);
    } catch (e) {
      if (errorCode(e) !== 'ENOENT') throw e;
    }
    this.locks.delete(file);
  }
  async removedProjects() {
    try {
      return z
        .array(removedProjectSchema)
        .parse(
          JSON.parse(await readFile(path.join(this.dataDir, 'removed-projects.json'), 'utf8')),
        );
    } catch (e) {
      if (errorCode(e) === 'ENOENT') return [];
      throw e;
    }
  }
  async rememberRemoved(project: RemovedProject['project']) {
    const records = await this.removedProjects();
    const record: RemovedProject = {
      removalId: randomUUID(),
      project,
      removedAt: new Date().toISOString(),
    };
    await atomicWrite(path.join(this.dataDir, 'removed-projects.json'), [
      ...records.filter(
        (r) =>
          path.resolve(r.project.dataDir).toLowerCase() !==
          path.resolve(project.dataDir).toLowerCase(),
      ),
      record,
    ]);
    return record;
  }
  async forgetRemoved(removalId: string) {
    await atomicWrite(
      path.join(this.dataDir, 'removed-projects.json'),
      (await this.removedProjects()).filter((r) => r.removalId !== removalId),
    );
  }
  async recordCleanup(
    removalId: string,
    cleanupFiles: NonNullable<RemovedProject['cleanupFiles']>,
  ) {
    const records = await this.removedProjects();
    const record = records.find((r) => r.removalId === removalId);
    if (!record) throw new AppError('Removed project not found.', 404);
    record.cleanupFiles = cleanupFiles;
    removedProjectSchema.parse(record);
    await atomicWrite(path.join(this.dataDir, 'removed-projects.json'), records);
  }
  async release() {
    for (const file of this.locks) await unlink(file).catch(() => undefined);
    this.locks.clear();
  }
  async initialize() {
    await this.lock(this.dataDir);
    for (const entry of await this.registry()) await this.lock(entry.dataDir);
  }
  async load(id: string) {
    safeId.parse(id);
    const entry = (await this.registry()).find((p) => p.id === id);
    if (!entry) throw new AppError('Project not found.', 404);
    const state = stateSchema.parse(
      JSON.parse(await readFile(path.join(entry.dataDir, 'state.json'), 'utf8')),
    );
    if (
      state.project.id !== id ||
      path.resolve(state.project.dataDir) !== path.resolve(entry.dataDir)
    )
      throw new AppError('Project storage does not match its registry.');
    return state;
  }
  async register(state: ProjectState) {
    const registry = await this.registry();
    if (registry.some((p) => p.id === state.project.id))
      throw new AppError('A project with that ID already exists.', 409);
    await this.lock(state.project.dataDir);
    await this.save(state);
    await atomicWrite(path.join(this.dataDir, 'projects.json'), [
      ...registry,
      { id: state.project.id, dataDir: state.project.dataDir },
    ]);
  }
  async unregister(id: string) {
    safeId.parse(id);
    const registry = await this.registry();
    const entry = registry.find((p) => p.id === id);
    if (!entry) throw new AppError('Project not found.', 404);
    await atomicWrite(
      path.join(this.dataDir, 'projects.json'),
      registry.filter((p) => p.id !== id),
    );
    // Registration is already removed. Retry releasing an owned lock on shutdown if needed.
    await this.unlock(entry.dataDir).catch((error) =>
      console.warn('Removed project retains its lock until the app stops:', error),
    );
  }
  async save(state: ProjectState) {
    state.revision++;
    const directory = state.project.dataDir;
    const checkpointDir = path.join(directory, 'checkpoints');
    await mkdir(checkpointDir, { recursive: true });
    await atomicWrite(
      path.join(checkpointDir, `${String(state.revision).padStart(10, '0')}.json`),
      state,
    );
    await atomicWrite(path.join(directory, 'state.json'), state);
    for (const batch of state.batches) {
      await atomicWrite(path.join(directory, 'batches', `${batch.id}.json`), batch);
      await atomicWrite(
        path.join(directory, 'batches', `${batch.id}.md`),
        batchMarkdown(state.project, batch, state.operations),
        true,
      );
    }
    for (const operation of state.operations)
      await atomicWrite(path.join(directory, 'operations', `${operation.id}.json`), operation);
    const old = (await readdir(checkpointDir))
      .filter((n) => /^\d+\.json$/.test(n))
      .sort()
      .slice(0, -20);
    for (const name of old) await unlink(path.join(checkpointDir, name));
  }
}
