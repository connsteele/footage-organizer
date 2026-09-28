import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { Organizer } from './service.js';
import { Store } from './store.js';
import { createApp } from './app.js';
import { inspectMedia } from './mediaInfo.js';
import { MarkerWriter } from './markerWriter.js';

const config = await loadConfig();
const store = new Store(config.dataDir);
const service = new Organizer(
  store,
  undefined,
  new MarkerWriter(config.ffmpegPath, config.ffprobePath),
);
try {
  await service.initialize();
} catch (error) {
  await store.release();
  console.error(error);
  process.exit(1);
}
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await service.drain();
  server.close(async () => {
    await store.release();
    process.exit(0);
  });
  server.closeIdleConnections();
}
const server = createServer(
  createApp(service, {
    port: config.port,
    shutdown,
    mediaProbe: (file) => inspectMedia(file, config.ffprobePath),
  }),
);
server.on('error', async (error) => {
  console.error(error);
  await store.release();
  process.exit(1);
});
server.listen(config.port, '127.0.0.1', () =>
  console.log(`Footage Organizer: http://127.0.0.1:${config.port}`),
);
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
