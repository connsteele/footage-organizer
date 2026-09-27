import { afterAll, expect, it, vi } from 'vitest';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server/app';
import { Organizer } from '../src/server/service';
import { Store } from '../src/server/store';

const service = new Organizer(new Store('unused-api-fixture'));
const server = createServer();
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as AddressInfo).port;
const shutdown = vi.fn();
const folderPicker = vi.fn(async (_initialPath?: string): Promise<string | null> => null);
server.on('request', createApp(service, { port, shutdown, folderPicker }));
const base = `http://127.0.0.1:${port}`;
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
it('protects the native folder picker and supports selection and cancellation', async () => {
  expect((await fetch(`${base}/api/browse-folder`, { method: 'POST' })).status).toBe(403);
  expect(folderPicker).not.toHaveBeenCalled();
  const session = await (await fetch(`${base}/api/session`)).json();
  const browse = () =>
    fetch(`${base}/api/browse-folder`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-organizer-token': session.token },
      body: JSON.stringify({ initialPath: 'D:/Review folder' }),
    });
  expect(await (await browse()).json()).toEqual({ path: null });
  folderPicker.mockResolvedValueOnce('D:/Chosen folder');
  expect(await (await browse()).json()).toEqual({ path: 'D:/Chosen folder' });
  expect(folderPicker).toHaveBeenLastCalledWith('D:/Review folder');
});
it('rejects foreign origins, host rebinding, and tokenless mutations', async () => {
  const normal = {};
  expect((await fetch(`${base}/api/health`, { headers: normal })).status).toBe(200);
  const rebound = await new Promise<number>((resolve) => {
    const req = request(`${base}/api/health`, { headers: { host: 'foreign.example' } }, (res) => {
      res.resume();
      resolve(res.statusCode!);
    });
    req.end();
  });
  expect(rebound).toBe(403);
  expect(
    (
      await fetch(`${base}/api/session`, {
        headers: { ...normal, origin: 'https://foreign.example' },
      })
    ).status,
  ).toBe(403);
  expect((await fetch(`${base}/api/projects`, { method: 'POST', headers: normal })).status).toBe(
    403,
  );
  const session = await (await fetch(`${base}/api/session`, { headers: normal })).json();
  const invalid = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { ...normal, 'content-type': 'application/json', 'x-organizer-token': session.token },
    body: '{}',
  });
  expect(invalid.status).toBe(400);
});
it('refuses shutdown during a move and allows it when idle', async () => {
  const session = await (await fetch(`${base}/api/session`)).json();
  const stop = () =>
    fetch(`${base}/api/shutdown`, {
      method: 'POST',
      headers: { 'x-organizer-token': session.token },
    });
  service.busy = 'active-move';
  try {
    const blocked = await stop();
    expect(blocked.status).toBe(409);
    expect(shutdown).not.toHaveBeenCalled();
  } finally {
    service.busy = null;
  }
  expect((await stop()).status).toBe(200);
  await vi.waitFor(() => expect(shutdown).toHaveBeenCalledOnce());
});
