import { expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer, get, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { mkdir, mkdtemp, open, rm } from 'node:fs/promises';
import { loadConfig } from '../src/server/config';
import { Organizer } from '../src/server/service';
import { Store } from '../src/server/store';
import { exists, within } from '../src/server/paths';

it('stops with a paused video response and releases the project locks', async () => {
  const scratch =
    process.env.FO_TEST_DIR || path.join((await loadConfig()).tempDir, 'footage-organizer-tests');
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, 'shutdown-'));
  if (
    !within(path.resolve(scratch), path.resolve(root)) ||
    path.resolve(root) === path.resolve(scratch)
  )
    throw new Error('Unsafe shutdown fixture cleanup path');
  const media = path.join(root, 'video');
  const data = path.join(root, 'registry');
  const plans = path.join(root, 'plans');
  const store = new Store(data);
  const service = new Organizer(store);
  await mkdir(media);
  const file = await open(path.join(media, 'large.mp4'), 'wx');
  await file.truncate(64 * 1024 * 1024);
  await file.close();
  try {
    await service.initialize();
    await service.createProject({
      id: 'test',
      name: 'Shutdown test',
      mediaRoot: media,
      dataDir: plans,
    });
    await service.importHandoff('test', {
      schemaVersion: 1,
      projectId: 'test',
      batchId: 'test',
      handoffId: 'test',
      title: 'Paused preview',
      createdAt: new Date().toISOString(),
      clips: [
        {
          id: 1,
          source: { relativePath: 'large.mp4' },
          proposed: { folder: '', filename: 'large.mp4' },
        },
      ],
    });
  } finally {
    await store.release();
  }
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as AddressInfo).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
    windowsHide: true,
    env: { ...process.env, FO_DATA_DIR: data, FO_TEMP_DIR: scratch, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    output += String(chunk);
  });
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  let response: IncomingMessage | undefined;
  try {
    await vi.waitFor(() => expect(output).toContain('Footage Organizer: http'), { timeout: 8000 });
    const base = `http://127.0.0.1:${port}`;
    const { token } = await (await fetch(`${base}/api/session`)).json();
    const headers = { 'content-type': 'application/json', 'x-organizer-token': token };
    const preview = await fetch(`${base}/api/projects/test/batches/test/preview`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ clipId: 1 }),
    });
    expect(preview.status).toBe(200);
    const { url } = await preview.json();
    response = await new Promise<IncomingMessage>((resolve, reject) => {
      get(`${base}${url}`, { agent: false }, (res) => {
        res.on('error', () => undefined);
        res.pause();
        resolve(res);
      }).on('error', reject);
    });
    expect(response.statusCode).toBe(200);
    expect(response.complete).toBe(false);
    expect((await fetch(`${base}/api/shutdown`, { method: 'POST', headers })).status).toBe(200);
    await vi.waitFor(() => expect(child.exitCode, output).toBe(0), { timeout: 3000 });
    expect(await exists(path.join(data, '.organizer.lock'))).toBe(false);
    expect(await exists(path.join(plans, '.organizer.lock'))).toBe(false);
  } finally {
    response?.destroy();
    if (child.exitCode === null) child.kill();
    await exited;
    await rm(root, { recursive: true, force: true });
  }
});
