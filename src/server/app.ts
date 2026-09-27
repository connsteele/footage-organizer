import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ZodError, z } from 'zod';
import { batchMarkdown } from '../shared/markdown.js';
import { safeId } from '../shared/model.js';
import { AppError, messageOf } from './paths.js';
import type { Organizer } from './service.js';

export function createApp(
  service: Organizer,
  options: { port: number; shutdown?: () => void; clientDir?: string },
) {
  const app = express();
  const token = randomBytes(32).toString('hex');
  const allowedHosts = new Set([
    `127.0.0.1:${options.port}`,
    `localhost:${options.port}`,
    '127.0.0.1:5173',
    'localhost:5173',
  ]);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (!allowedHosts.has(req.headers.host || ''))
      return res.status(403).json({ error: 'Local requests only.' });
    const origin = req.headers.origin;
    if (origin && ![...allowedHosts].some((host) => origin === `http://${host}`))
      return res.status(403).json({ error: 'This origin cannot access the application.' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    );
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.headers['x-organizer-token'] !== token
    )
      return res.status(403).json({ error: 'App session expired. Reload this page.' });
    next();
  });
  app.use(express.json({ limit: '8mb' }));
  app.get('/api/health', (_req, res) =>
    res.json({ app: 'footage-organizer', version: '0.1.0', busy: service.busy }),
  );
  app.get('/api/session', (_req, res) =>
    res.json({ token, platform: process.platform, dataDir: service.store.dataDir }),
  );
  app.get('/api/projects', async (_req, res) => res.json(await service.summaries()));
  app.post('/api/projects', async (req, res) =>
    res.status(201).json(await service.createProject(req.body)),
  );
  const projectId = (req: Request) => safeId.parse(req.params.projectId);
  const batchId = (req: Request) => safeId.parse(req.params.batchId);
  app.get('/api/projects/:projectId', async (req, res) =>
    res.json(await service.store.load(projectId(req))),
  );
  app.get('/api/projects/:projectId/folders', async (req, res) =>
    res.json(await service.folders(projectId(req))),
  );
  app.get('/api/projects/:projectId/context', async (req, res) => {
    const state = await service.store.load(projectId(req));
    res.json({
      schemaVersion: 1,
      project: state.project,
      catalog: state.catalog,
      folders: await service.folders(projectId(req)),
      nextClipId: Math.max(0, ...Object.keys(state.catalog).map(Number)) + 1,
    });
  });
  app.post('/api/projects/:projectId/import', async (req, res) =>
    res.json(await service.importHandoff(projectId(req), req.body)),
  );
  app.put('/api/projects/:projectId/batches/:batchId', async (req, res) =>
    res.json(await service.saveBatch(projectId(req), batchId(req), req.body)),
  );
  app.get('/api/projects/:projectId/batches/:batchId/markdown', async (req, res) => {
    const state = await service.store.load(projectId(req));
    const batch = state.batches.find((b) => b.id === batchId(req));
    if (!batch) throw new AppError('Batch not found.', 404);
    res.type('text/markdown').send(batchMarkdown(state.project, batch, state.operations));
  });
  app.post('/api/projects/:projectId/batches/:batchId/review', async (req, res) =>
    res.json(await service.review(projectId(req), batchId(req))),
  );
  app.post('/api/projects/:projectId/batches/:batchId/move', async (req, res) => {
    const body = z.object({ reviewId: safeId }).parse(req.body);
    res.status(202).json(await service.startMove(projectId(req), batchId(req), body.reviewId));
  });
  app.post('/api/projects/:projectId/batches/:batchId/player', async (req, res) => {
    const { clipId } = z.object({ clipId: z.number().int().positive() }).parse(req.body);
    await service.player(projectId(req), batchId(req), clipId);
    res.json({ ok: true });
  });
  app.post('/api/projects/:projectId/recover', async (req, res) =>
    res.json(await service.reconcile(projectId(req))),
  );
  app.post('/api/shutdown', (_req, res) => {
    if (service.busy)
      throw new AppError('Wait for the current move to finish before stopping the app.', 409);
    res.json({ ok: true });
    setTimeout(() => options.shutdown?.(), 150);
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  const clientDir = options.clientDir || path.resolve('dist/client');
  app.use(express.static(clientDir));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status =
      err instanceof AppError
        ? err.status
        : err instanceof ZodError || err instanceof SyntaxError
          ? 400
          : 500;
    const error =
      err instanceof ZodError
        ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n')
        : messageOf(err);
    if (status === 500) console.error(err);
    res.status(status).json({ error });
  });
  return app;
}
