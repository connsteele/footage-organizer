import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createApp } from '../src/server/app';
import { Store } from '../src/server/store';
import { Organizer } from '../src/server/service';
import { exists, within } from '../src/server/paths';
import { loadConfig } from '../src/server/config';

const scratch =
  process.env.FO_TEST_DIR || path.join((await loadConfig()).tempDir, 'footage-organizer-tests');
await mkdir(scratch, { recursive: true });
const root = await mkdtemp(path.join(scratch, 'media-'));
const media = path.join(root, 'video');
const store = new Store(path.join(root, 'registry'));
const service = new Organizer(store);
const server = createServer();
let base: string, token: string;
let lastPreviewUrl: string;
const bytes = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');
const mediaProbe = vi.fn(async () => ({
  video: null,
  audio: [],
  markers: [{ seconds: 1.25, label: 'Chapter' }],
}));
async function call(url: string, body?: unknown, method = 'POST') {
  return fetch(`${base}/api${url}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-organizer-token': token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function ticket(clipId = 1) {
  const response = await call('/projects/media/batches/first/preview', { clipId });
  expect(response.status).toBe(200);
  lastPreviewUrl = (await response.json()).url as string;
  return lastPreviewUrl;
}
beforeAll(async () => {
  await mkdir(media);
  await writeFile(path.join(media, 'clip.mp4'), bytes);
  await writeFile(path.join(media, 'config.json'), '{}');
  await service.initialize();
  await service.createProject({
    id: 'media',
    name: 'Media test',
    mediaRoot: media,
    dataDir: path.join(root, 'plans'),
  });
  await service.importHandoff('media', {
    schemaVersion: 1,
    projectId: 'media',
    batchId: 'first',
    handoffId: 'first',
    title: 'Media',
    createdAt: new Date().toISOString(),
    clips: [
      {
        id: 1,
        source: { relativePath: 'clip.mp4' },
        proposed: { folder: 'Filed', filename: 'Renamed.mp4' },
      },
      {
        id: 2,
        source: { relativePath: 'config.json' },
        proposed: { folder: '', filename: 'config.json' },
        hold: true,
      },
    ],
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  server.on('request', createApp(service, { port, mediaProbe }));
  base = `http://127.0.0.1:${port}`;
  token = (await (await fetch(`${base}/api/session`)).json()).token;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await store.release();
  if (
    !within(path.resolve(scratch), path.resolve(root)) ||
    path.resolve(root) === path.resolve(scratch)
  )
    throw new Error('Unsafe cleanup path');
  await rm(root, { recursive: true, force: true });
});
it('requires a local authenticated preview request and scopes URLs to supported registered clips', async () => {
  expect(
    (await fetch(`${base}/api/projects/media/batches/first/preview`, { method: 'POST' })).status,
  ).toBe(403);
  expect((await call('/projects/media/batches/first/preview', { clipId: 999 })).status).toBe(404);
  expect((await call('/projects/media/batches/first/preview', { clipId: 2 })).status).toBe(400);
  expect(
    (await call('/projects/media/batches/first/preview', { clipId: 1, file: 'C:/private.txt' }))
      .status,
  ).toBe(400);
  expect((await fetch(`${base}/api/media/${'0'.repeat(48)}`)).status).toBe(404);
  const url = await ticket();
  expect(url).not.toContain(token);
  expect(
    (await fetch(`${base}${url}`, { headers: { origin: 'https://foreign.example' } })).status,
  ).toBe(403);
});
it('only probes registered preview files, caches metadata, and protects the metadata route', async () => {
  expect((await fetch(`${base}/api/media/${'0'.repeat(48)}/info`)).status).toBe(404);
  const url = await ticket();
  const info = await fetch(`${base}${url}/info`);
  expect(await info.json()).toMatchObject({ markers: [{ seconds: 1.25, label: 'Chapter' }] });
  expect(mediaProbe).toHaveBeenCalledWith(path.join(media, 'clip.mp4'));
  expect(mediaProbe).toHaveBeenCalledOnce();
  expect((await fetch(`${base}${url}/info`)).status).toBe(200);
  expect(mediaProbe).toHaveBeenCalledOnce();
  expect(
    (await fetch(`${base}${url}/info`, { headers: { origin: 'https://foreign.example' } })).status,
  ).toBe(403);
});
it('streams whole files, byte ranges, suffixes and HEAD with correct seeking headers', async () => {
  const url = await ticket();
  const partial = await fetch(`${base}${url}`, { headers: { range: 'bytes=2-7' } });
  expect(partial.status).toBe(206);
  expect(partial.headers.get('content-range')).toBe(`bytes 2-7/${bytes.length}`);
  expect(partial.headers.get('accept-ranges')).toBe('bytes');
  expect(partial.headers.get('content-length')).toBe('6');
  expect(partial.headers.get('content-type')).toBe('video/mp4');
  expect(partial.headers.get('cache-control')).toBe('no-store');
  expect(partial.headers.get('cross-origin-resource-policy')).toBe('same-origin');
  expect(await partial.text()).toBe('234567');
  const suffix = await fetch(`${base}${url}`, { headers: { range: 'bytes=-4' } });
  expect(suffix.status).toBe(206);
  expect(await suffix.text()).toBe('wxyz');
  const head = await fetch(`${base}${url}`, { method: 'HEAD' });
  expect(head.status).toBe(200);
  expect(await head.text()).toBe('');
  const full = await fetch(`${base}${url}`);
  expect(Buffer.from(await full.arrayBuffer())).toEqual(bytes);
  const invalid = await fetch(`${base}${url}`, { headers: { range: 'bytes=1000-2000' } });
  expect(invalid.status).toBe(416);
  expect(invalid.headers.get('content-range')).toBe(`bytes */${bytes.length}`);
});
it('expires preview URLs and blocks playback during file moves', async () => {
  const url = await ticket();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5 * 60 * 60 * 1000);
  try {
    expect((await fetch(`${base}${url}`)).status).toBe(404);
    expect((await fetch(`${base}${url}/info`)).status).toBe(404);
  } finally {
    clock.mockRestore();
  }
  service.busy = 'test-move';
  try {
    expect((await call('/projects/media/batches/first/preview', { clipId: 1 })).status).toBe(409);
    expect((await fetch(`${base}${url}`)).status).toBe(409);
  } finally {
    service.busy = null;
  }
});
it('invalidates old URLs after a real move and previews the filed clip at its new location', async () => {
  const url = await ticket();
  const review = await service.review('media', 'first');
  expect(review.issues).toEqual([]);
  await service.startMove('media', 'first', review.id);
  await service.waitForIdle();
  expect((await fetch(`${base}${url}`)).status).toBe(409);
  expect((await fetch(`${base}${url}/info`)).status).toBe(409);
  expect(await exists(path.join(media, 'clip.mp4'))).toBe(false);
  const current = await ticket();
  expect(Buffer.from(await (await fetch(`${base}${current}`)).arrayBuffer())).toEqual(bytes);
  await writeFile(path.join(media, 'Filed/Renamed.mp4'), 'different media');
  expect((await fetch(`${base}${current}`)).status).toBe(409);
  expect((await fetch(`${base}${current}/info`)).status).toBe(409);
});
it('requires deletion confirmation, invalidates previews, and exposes confirmed cleanup separately', async () => {
  expect((await call('/projects/media', {}, 'DELETE')).status).toBe(400);
  expect((await call('/projects/media', { confirmProjectId: 'another' }, 'DELETE')).status).toBe(
    400,
  );
  const response = await call('/projects/media', { confirmProjectId: 'media' }, 'DELETE');
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ removed: true, plansDeleted: false });
  expect((await fetch(`${base}${lastPreviewUrl}`)).status).toBe(404);
  expect((await fetch(`${base}${lastPreviewUrl}/info`)).status).toBe(404);
  expect(await exists(path.join(root, 'plans/state.json'))).toBe(true);
  const records = await (await fetch(`${base}/api/removed-projects`)).json();
  expect(records).toHaveLength(1);
  const removalId = records[0].removalId;
  expect(
    (await fetch(`${base}/api/removed-projects/${removalId}`, { method: 'DELETE' })).status,
  ).toBe(403);
  expect(
    (await call(`/removed-projects/${removalId}`, { confirmRemovalId: 'wrong' }, 'DELETE')).status,
  ).toBe(400);
  expect(
    (await call(`/removed-projects/${removalId}`, { confirmRemovalId: removalId }, 'DELETE'))
      .status,
  ).toBe(200);
  expect(await exists(path.join(root, 'plans/state.json'))).toBe(false);
  expect(await readFile(path.join(media, 'Filed/Renamed.mp4'), 'utf8')).toBe('different media');
});
