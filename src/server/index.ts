import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { Organizer } from './service.js';
import { Store } from './store.js';
import { createApp } from './app.js';

const config = await loadConfig();
const store = new Store(config.dataDir);
const service = new Organizer(store);
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
const server = createServer(createApp(service, { port: config.port, shutdown }));
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
