import express, { type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ZodError, z } from 'zod';
import { batchMarkdown } from '../shared/markdown.js';
import { safeId } from '../shared/model.js';
import { AppError, messageOf } from './paths.js';
import type { Organizer } from './service.js';
import { chooseFolder } from './folderPicker.js';
import { MediaPreviews } from './media.js';
import { inspectMedia } from './mediaInfo.js';

export function createApp(
  service: Organizer,
  options: {
    port: number;
    shutdown?: () => void;
    clientDir?: string;
    folderPicker?: typeof chooseFolder;
    mediaProbe?: typeof inspectMedia;
  },
) {
  const app = express();
  const token = randomBytes(32).toString('hex');
  const media = new MediaPreviews(service, options.mediaProbe);
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
    if (
      service.stopping &&
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.path !== '/api/shutdown'
    )
      return res.status(503).json({ error: 'The app is stopping. Relaunch it before continuing.' });
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
  app.post('/api/browse-folder', async (req, res) => {
    const { initialPath } = z
      .object({ initialPath: z.string().max(1800).default('') })
      .parse(req.body);
    res.json({ path: await (options.folderPicker ?? chooseFolder)(initialPath) });
  });
  const projectId = (req: Request) => safeId.parse(req.params.projectId);
  const batchId = (req: Request) => safeId.parse(req.params.batchId);
  app.get('/api/removed-projects', async (_req, res) => res.json(await service.removedProjects()));
  app.delete('/api/removed-projects/:removalId', async (req, res) => {
    const removalId = safeId.parse(req.params.removalId);
    const body = z.object({ confirmRemovalId: safeId }).strict().parse(req.body);
    if (body.confirmRemovalId !== removalId)
      throw new AppError('Confirm the saved plans you want to delete.');
    res.json(await service.cleanupProject(removalId));
  });
  app.delete('/api/projects/:projectId', async (req, res) => {
    const id = projectId(req);
    const body = z
      .object({ confirmProjectId: safeId, deletePlans: z.boolean().default(false) })
      .strict()
      .parse(req.body);
    if (body.confirmProjectId !== id) throw new AppError('Confirm the project you want to delete.');
    const result = await service.deleteProject(id, body.deletePlans);
    media.forget(id);
    res.json(result);
  });
  app.post('/api/projects/:projectId/batches/:batchId/preview', async (req, res) => {
    const { clipId } = z.object({ clipId: z.number().int().positive() }).strict().parse(req.body);
    res.json(await media.create(projectId(req), batchId(req), clipId));
  });
  app.get('/api/media/:ticket/info', async (req, res) => {
    const id = z
      .string()
      .regex(/^[a-f0-9]{48}$/)
      .parse(req.params.ticket);
    res.json(await media.info(id));
  });
  app.get('/api/media/:ticket', async (req, res, next) => {
    const { file, type } = await media.resolve(
      z
        .string()
        .regex(/^[a-f0-9]{48}$/)
        .parse(req.params.ticket),
    );
    res.setHeader('Content-Type', type);
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Disposition', 'inline');
    // sendFile streams from disk and handles byte ranges/HEAD for seeking large clips.
    res.sendFile(file, { acceptRanges: true, cacheControl: false, dotfiles: 'allow' }, (error) => {
      if (!error || req.aborted || res.destroyed) return;
      // Closing/switching previews normally aborts an in-flight byte-range response.
      if (['ECONNABORTED', 'ECONNRESET'].includes((error as NodeJS.ErrnoException).code || ''))
        return;
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 416) next(new AppError('Requested video range is unavailable.', 416));
      else if (status === 404) next(new AppError('Video is no longer available.', 404));
      else next(error);
    });
  });
  app.put('/api/projects/:projectId/review-folder', async (req, res) => {
    const { folder } = z.object({ folder: z.string().max(1800) }).parse(req.body);
    res.json(await service.setReviewFolder(projectId(req), folder));
  });
  app.post('/api/projects/:projectId/review-inventory', async (req, res) => {
    const { folder } = z.object({ folder: z.string().max(1800) }).parse(req.body);
    res.json(await service.inventory(projectId(req), folder));
  });
  app.post('/api/projects/:projectId/batches/:batchId/held-review', async (req, res) =>
    res.json(await service.updates.exportHeld(projectId(req), batchId(req))),
  );
  app.post('/api/projects/:projectId/batches/:batchId/update-preview', async (req, res) =>
    res.json(await service.updates.preview(projectId(req), batchId(req), req.body)),
  );
  app.post('/api/projects/:projectId/batches/:batchId/apply-update', async (req, res) =>
    res.json(await service.updates.apply(projectId(req), batchId(req), req.body)),
  );
  app.get('/api/projects/:projectId', async (req, res) =>
    res.json(await service.projectState(projectId(req))),
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
  app.post('/api/shutdown', async (_req, res) => {
    if (service.busy)
      throw new AppError('Wait for the current move to finish before stopping the app.', 409);
    await service.prepareShutdown();
    res.json({ ok: true });
    setTimeout(() => options.shutdown?.(), 150);
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  const clientDir = options.clientDir || path.resolve('dist/client');
  app.use(express.static(clientDir));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return _next(err);
    if ((err as { type?: string })?.type === 'entity.too.large')
      return res.status(413).json({
        error: 'This request exceeds the 8 MB limit. Choose a smaller handoff or batch update.',
      });
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
