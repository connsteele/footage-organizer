import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  handoffSchema,
  editSchema,
  projectInputSchema,
  stateSchema,
  isPending,
  targetPath,
  type Batch,
  type ProjectState,
  type MoveReview,
  type Operation,
  type ProjectSummary,
} from '../shared/model.js';
import {
  AppError,
  canonicalRoot,
  exists,
  filenameProblem,
  fingerprint,
  messageOf,
  parentDevice,
  relativePath,
  safePath,
  sameFile,
  scanFolders,
  within,
} from './paths.js';
import { Store, atomicWrite } from './store.js';
import { moveWithoutReplacement, openMedia } from './move.js';
import { resolveReviewFolder, reviewInventory } from './reviewFolders.js';
import { ReviewUpdates } from './reviewUpdates.js';
import { cleanupProjectPlans } from './projectCleanup.js';
import {
  initialMarkerDecisions,
  markerChanges,
  validateLocalMarkers,
  validateMarkerProposals,
} from '../shared/markers.js';
import { inspectMedia } from './mediaInfo.js';
import { MarkerWriter } from './markerWriter.js';

export class Organizer {
  busy: string | null = null;
  stopping = false;
  private reviews = new Map<string, MoveReview>();
  private activeJob: Promise<void> | null = null;
  readonly updates: ReviewUpdates;
  constructor(
    public store: Store,
    private moveFile = moveWithoutReplacement,
    private markerWriter: Pick<MarkerWriter, 'check' | 'prepare'> = new MarkerWriter(),
  ) {
    this.updates = new ReviewUpdates(store, () => this.idle());
  }
  private idle() {
    if (this.stopping)
      throw new AppError('The app is stopping. Relaunch it before continuing.', 503);
    if (this.busy) throw new AppError('A move is in progress. Wait for its results.', 409);
  }
  async prepareShutdown() {
    return this.store.serial(async () => {
      if (this.stopping) return;
      this.idle();
      this.stopping = true;
    });
  }
  async drain() {
    await this.store.serial(async () => {
      this.stopping = true;
    });
    await this.waitForIdle();
  }
  async projectState(projectId: string) {
    return this.store.serial(async () => {
      const state = await this.store.load(projectId);
      // A failed journal save can end a job while leaving a running record on disk.
      // Polling recovers it once storage works again, so the progress UI can finish.
      if (!this.busy && !this.stopping && state.operations.some((o) => o.status === 'running'))
        return this.reconcileUnlocked(state);
      return state;
    });
  }
  private batch(state: ProjectState, batchId: string) {
    const batch = state.batches.find((b) => b.id === batchId);
    if (!batch) throw new AppError('Batch not found.', 404);
    return batch;
  }
  async initialize() {
    await this.store.initialize();
    for (const entry of await this.store.registry()) await this.reconcile(entry.id);
  }
  async summaries(): Promise<ProjectSummary[]> {
    return Promise.all(
      (await this.store.registry()).map(async (entry) => {
        const state = await this.store.load(entry.id);
        return {
          ...state.project,
          clipCount: Object.keys(state.catalog).length,
          batches: state.batches.map((b) => ({
            id: b.id,
            title: b.title,
            importedAt: b.importedAt,
            clips: b.clips.length,
            pending: b.clips.filter(isPending).length,
            held: b.clips.filter((c) => c.held).length,
          })),
        };
      }),
    );
  }
  async createProject(input: unknown) {
    return this.store.serial(async () => {
      this.idle();
      const project = projectInputSchema.parse(input);
      project.mediaRoot = await canonicalRoot(project.mediaRoot);
      if (project.reviewFolder !== undefined)
        project.reviewFolder = await resolveReviewFolder(project.mediaRoot, project.reviewFolder);
      if (!path.isAbsolute(project.dataDir))
        throw new AppError('The plan folder must be an absolute path.');
      project.dataDir = path.resolve(project.dataDir);
      if (within(project.mediaRoot, project.dataDir) || within(project.dataDir, project.mediaRoot))
        throw new AppError('Keep the plan folder separate from the footage folder.');
      const overlaps = (a: string, b: string) => within(a, b) || within(b, a);
      if (
        [project.mediaRoot, project.dataDir].some((folder) =>
          overlaps(path.resolve(this.store.dataDir), folder),
        )
      )
        throw new AppError('Keep footage and plan folders separate from the app storage folder.');
      for (const summary of await this.summaries()) {
        if (
          within(summary.mediaRoot, project.mediaRoot) ||
          within(project.mediaRoot, summary.mediaRoot)
        )
          throw new AppError(
            'This footage folder overlaps an existing project. Open that project instead.',
          );
        if (
          overlaps(summary.mediaRoot, project.dataDir) ||
          overlaps(project.mediaRoot, summary.dataDir) ||
          overlaps(summary.dataDir, project.dataDir)
        )
          throw new AppError('Choose separate project and plan folders.');
      }
      await mkdir(project.dataDir, { recursive: true });
      project.dataDir = await canonicalRoot(project.dataDir);
      const stateFile = path.join(project.dataDir, 'state.json');
      let state: ProjectState = {
        schemaVersion: 1,
        project,
        revision: 0,
        catalog: {},
        batches: [],
        operations: [],
      };
      if (await exists(stateFile)) {
        state = stateSchema.parse(JSON.parse(await readFile(stateFile, 'utf8')));
        if (
          state.project.id !== project.id ||
          path.resolve(state.project.mediaRoot).toLowerCase() !== project.mediaRoot.toLowerCase()
        )
          throw new AppError('That folder already belongs to a different project.');
        state.project.dataDir = project.dataDir;
      }
      await this.store.register(state);
      await this.reconcileUnlocked(state);
      return state.project;
    });
  }
  async folders(projectId: string) {
    const state = await this.store.load(projectId);
    return scanFolders(state.project.mediaRoot);
  }
  async removedProjects() {
    const active = await this.store.registry();
    return (await this.store.removedProjects()).filter(
      (r) =>
        !active.some(
          (p) =>
            path.resolve(p.dataDir).toLowerCase() === path.resolve(r.project.dataDir).toLowerCase(),
        ),
    );
  }
  private async cleanupRemoved(removalId: string) {
    const removed = (await this.store.removedProjects()).find((r) => r.removalId === removalId);
    if (!removed) throw new AppError('Removed project not found.', 404);
    const result = await cleanupProjectPlans(this.store, removed);
    await this.store.forgetRemoved(removalId);
    return result;
  }
  async cleanupProject(removalId: string) {
    return this.store.serial(async () => {
      this.idle();
      return this.cleanupRemoved(removalId);
    });
  }
  async deleteProject(projectId: string, deletePlans = false) {
    return this.store.serial(async () => {
      this.idle();
      const state = await this.store.load(projectId);
      if (state.operations.some((operation) => operation.status === 'running'))
        throw new AppError('Wait for this project’s file moves to finish before deleting it.', 409);
      const removed = await this.store.rememberRemoved(state.project);
      await this.store.unregister(projectId);
      for (const [id, review] of this.reviews)
        if (review.projectId === projectId) this.reviews.delete(id);
      if (deletePlans) {
        try {
          return {
            removed: true,
            plansDeleted: true,
            ...(await this.cleanupRemoved(removed.removalId)),
          };
        } catch (e) {
          return { removed: true, plansDeleted: false, cleanupError: messageOf(e) };
        }
      }
      return { removed: true, plansDeleted: false };
    });
  }
  async mediaFile(projectId: string, batchId: string, clipId: number) {
    this.idle();
    const state = await this.store.load(projectId);
    const clip = this.batch(state, batchId).clips.find((c) => c.id === clipId);
    if (!clip) throw new AppError('Clip not found.', 404);
    // The shared catalog tracks the current location even if another batch filed this clip.
    const current = state.catalog[String(clipId)];
    if (!current) throw new AppError('Clip is no longer in this project.', 404);
    const file = await safePath(state.project.mediaRoot, current.path);
    const baseline = await fingerprint(file);
    if (!current.baseline || !sameFile(current.baseline, baseline))
      throw new AppError('This source file changed. Refresh its review before previewing it.', 409);
    return { file, baseline };
  }
  async setReviewFolder(projectId: string, folder: string) {
    return this.store.serial(async () => {
      this.idle();
      const state = await this.store.load(projectId);
      state.project.reviewFolder = await resolveReviewFolder(state.project.mediaRoot, folder);
      await this.store.save(state);
      return state.project;
    });
  }
  async inventory(
    projectId: string,
    folder: string,
    includeMarkers = false,
    probe?: typeof inspectMedia,
  ) {
    this.idle();
    return reviewInventory(await this.store.load(projectId), folder, { includeMarkers, probe });
  }
  async importHandoff(projectId: string, input: unknown) {
    return this.store.serial(async () => {
      this.idle();
      const handoff = handoffSchema.parse(input);
      const state = await this.store.load(projectId);
      if (handoff.projectId !== projectId)
        throw new AppError(
          `This handoff is for project “${handoff.projectId}”. Choose that project or correct the handoff.`,
        );
      const existing = state.batches.find((b) => b.handoffId === handoff.handoffId);
      if (existing) return existing;
      if (state.batches.some((b) => b.handoffId.toLowerCase() === handoff.handoffId.toLowerCase()))
        throw new AppError(
          'That handoff ID is already in use with different capitalization. Use a new ID.',
        );
      if (state.batches.some((b) => b.id.toLowerCase() === handoff.batchId.toLowerCase()))
        throw new AppError(
          'That batch ID is already in use. For held clips, use Agent follow-up in that batch. A new full handoff needs a new batch ID.',
        );
      if (new Set(handoff.clips.map((c) => c.id)).size !== handoff.clips.length)
        throw new AppError('The handoff contains duplicate clip IDs.');
      const sourceSet = new Set<string>();
      const catalogIdsByPath = new Map(
        Object.entries(state.catalog).map(([id, clip]) => [clip.path.toLowerCase(), id]),
      );
      const reviewFolder =
        handoff.reviewFolder === undefined
          ? undefined
          : await resolveReviewFolder(state.project.mediaRoot, handoff.reviewFolder);
      const batch: Batch = {
        id: handoff.batchId,
        handoffId: handoff.handoffId,
        title: handoff.title,
        importedAt: new Date().toISOString(),
        revision: 1,
        folders: [],
        reviewNotes: handoff.reviewNotes,
        notes: '',
        clips: [],
        reviewFolder,
      };
      for (const clip of handoff.clips) {
        validateMarkerProposals(clip.markers, clip.markerProposals);
        clip.source.relativePath = relativePath(clip.source.relativePath);
        if (
          reviewFolder !== undefined &&
          !within(
            path.join(state.project.mediaRoot, reviewFolder),
            path.join(state.project.mediaRoot, clip.source.relativePath),
          )
        )
          throw new AppError(`Clip ${clip.id} is outside the selected Review Footage folder.`);
        clip.proposed.folder = relativePath(clip.proposed.folder, true);
        if (filenameProblem(clip.proposed.filename))
          throw new AppError(`Clip ${clip.id}: ${filenameProblem(clip.proposed.filename)}`);
        if (
          path.extname(clip.proposed.filename).toLowerCase() !==
          path.extname(clip.source.relativePath).toLowerCase()
        )
          throw new AppError(`Clip ${clip.id}: keep the original file extension.`);
        const key = clip.source.relativePath.toLowerCase();
        if (sourceSet.has(key)) throw new AppError('The same source file appears more than once.');
        sourceSet.add(key);
        const catalog = state.catalog[String(clip.id)];
        if (catalog && catalog.path.toLowerCase() !== key)
          throw new AppError(
            `Clip ${clip.id} already refers to ${catalog.path}. IDs must be preserved.`,
          );
        const existingId = catalogIdsByPath.get(key);
        if (existingId !== undefined && existingId !== String(clip.id))
          throw new AppError(`This file already has ID ${existingId}. Use its existing ID.`);
        let baseline = null;
        let importIssue: string | null = null;
        try {
          baseline = await fingerprint(
            await safePath(state.project.mediaRoot, clip.source.relativePath),
          );
          if (
            (clip.source.size !== undefined && clip.source.size !== baseline.size) ||
            (clip.source.mtimeMs !== undefined &&
              Math.abs(clip.source.mtimeMs - baseline.mtimeMs) > 1)
          )
            importIssue =
              'Source differs from the review handoff. Request a fresh handoff before moving this clip.';
        } catch (e) {
          importIssue = `Source unavailable at import: ${messageOf(e)}`;
        }
        batch.clips.push({
          id: clip.id,
          currentPath: clip.source.relativePath,
          baseline,
          importIssue,
          original: clip,
          proposed: { ...clip.proposed },
          note: '',
          held: clip.hold || clip.questions.length > 0,
          applied: false,
          ...(clip.markerProposals
            ? { markerDecisions: initialMarkerDecisions(clip.markerProposals) }
            : {}),
        });
        state.catalog[String(clip.id)] = { path: clip.source.relativePath, baseline };
        catalogIdsByPath.set(key, String(clip.id));
      }
      batch.folders = [
        ...new Set([
          ...handoff.folders.map((f) => relativePath(f, true)),
          ...batch.clips.map((c) => c.proposed.folder),
        ]),
      ].sort();
      state.batches.unshift(batch);
      await atomicWrite(
        path.join(state.project.dataDir, 'imports', `${handoff.handoffId}.json`),
        handoff,
      );
      await this.store.save(state);
      return batch;
    });
  }
  async saveBatch(projectId: string, batchId: string, input: unknown) {
    return this.store.serial(async () => {
      this.idle();
      const edit = editSchema.parse(input);
      const state = await this.store.load(projectId);
      const batch = this.batch(state, batchId);
      if (edit.revision !== batch.revision)
        throw new AppError(
          'This batch changed in another tab. Reload the saved batch before continuing. Your current edits have not been overwritten.',
          409,
        );
      if (
        edit.clips.length !== batch.clips.length ||
        new Set(edit.clips.map((c) => c.id)).size !== batch.clips.length
      )
        throw new AppError('The batch must retain all original clip IDs.');
      const clipsById = new Map(batch.clips.map((clip) => [clip.id, clip]));
      for (const change of edit.clips) {
        const clip = clipsById.get(change.id);
        if (!clip) throw new AppError('Unknown clip ID.');
        if (
          clip.applied &&
          (JSON.stringify(clip.proposed) !== JSON.stringify(change.proposed) ||
            clip.held !== change.held)
        )
          throw new AppError(
            'Completed placements are locked. Use a new handoff to reorganize a filed clip.',
          );
        clip.proposed = { ...change.proposed };
        clip.note = change.note;
        clip.held = change.held;
        if (change.markerDecisions !== undefined || change.localMarkers !== undefined) {
          const localMarkers = change.localMarkers ?? clip.localMarkers;
          const markerDecisions = change.markerDecisions ?? clip.markerDecisions;
          validateLocalMarkers({ ...clip, localMarkers, markerDecisions });
          if (
            clip.applied &&
            (JSON.stringify(clip.markerDecisions ?? []) !== JSON.stringify(markerDecisions ?? []) ||
              JSON.stringify(clip.localMarkers ?? []) !== JSON.stringify(localMarkers ?? []))
          )
            throw new AppError(
              'Filed marker decisions are locked. Use a fresh handoff to review this file again.',
            );
          clip.markerDecisions = markerDecisions;
          clip.localMarkers = localMarkers;
        }
      }
      batch.folders = [...new Set(edit.folders.map((f) => relativePath(f, true)))];
      batch.notes = edit.notes;
      batch.revision++;
      await this.store.save(state);
      return batch;
    });
  }
  async review(projectId: string, batchId: string): Promise<MoveReview> {
    this.idle();
    const state = await this.store.load(projectId);
    const batch = this.batch(state, batchId);
    const review: MoveReview = {
      id: randomUUID(),
      projectId,
      batchId,
      revision: batch.revision,
      items: [],
      issues: [],
      held: 0,
      unchanged: 0,
      newFolders: [],
      expiresAt: Date.now() + 300000,
    };
    const destinations = new Set<string>();
    if (
      state.operations.some(
        (o) => o.status === 'running' || o.items.some((i) => i.status === 'moving'),
      )
    )
      review.issues.push({
        clipId: null,
        message: 'An earlier move needs recovery. Use Check recovery before starting another move.',
      });
    if (
      state.operations.some((o) =>
        o.items.some(
          (i) =>
            i.status === 'ambiguous' &&
            (o.batchId === batchId ||
              batch.clips.some((clip) => clip.id === i.clipId && !clip.applied)),
        ),
      )
    )
      review.issues.push({
        clipId: null,
        message:
          'An earlier move has an ambiguous result. Resolve its paths and use Check recovery before retrying.',
      });
    for (const clip of batch.clips) {
      if (clip.held) {
        review.held++;
        continue;
      }
      const to = targetPath(clip);
      const changes = markerChanges(clip);
      if (clip.applied || (clip.currentPath === to && !changes.length)) {
        review.unchanged++;
        continue;
      }
      review.items.push({
        clipId: clip.id,
        from: clip.currentPath,
        to,
        ...(changes.length ? { markerChanges: changes } : {}),
      });
      try {
        if (clip.importIssue) throw new AppError(clip.importIssue);
        if (!clip.baseline)
          throw new AppError('This clip has no verified source baseline. Import a fresh handoff.');
        if (/[\\/]/.test(clip.proposed.filename))
          throw new AppError(
            'The filename cannot contain directory separators. Choose its folder separately.',
          );
        relativePath(to);
        if (path.extname(to).toLowerCase() !== path.extname(clip.currentPath).toLowerCase())
          throw new AppError('Keep the original file extension.');
        if (to !== clip.currentPath && to.toLowerCase() === clip.currentPath.toLowerCase())
          throw new AppError('Case-only renames are not supported in this release.');
        if (destinations.has(to.toLowerCase()))
          throw new AppError('Two clips have the same destination.');
        destinations.add(to.toLowerCase());
        if (state.catalog[String(clip.id)]?.path !== clip.currentPath)
          throw new AppError('Another batch has changed this clip’s location.');
        const source = await safePath(state.project.mediaRoot, clip.currentPath);
        if (!sameFile(await fingerprint(source), clip.baseline))
          throw new AppError('Source changed since import. Request a fresh handoff.');
        const target = await safePath(state.project.mediaRoot, to);
        if (to !== clip.currentPath && (await exists(target)))
          throw new AppError('A file or folder already exists at the destination.');
        if (changes.length) await this.markerWriter.check(source, changes, clip.baseline.size);
        if ((await parentDevice(target)) !== clip.baseline.dev)
          throw new AppError('Cross-volume moves are not supported.');
        if (clip.proposed.folder && !(await exists(path.dirname(target))))
          review.newFolders.push(clip.proposed.folder);
      } catch (e) {
        review.issues.push({ clipId: clip.id, message: messageOf(e) });
      }
    }
    review.newFolders = [...new Set(review.newFolders)];
    for (const [key, old] of this.reviews) if (old.expiresAt < Date.now()) this.reviews.delete(key);
    this.reviews.set(review.id, review);
    return review;
  }
  async startMove(projectId: string, batchId: string, reviewId: string) {
    return this.store.serial(async () => {
      const state = await this.store.load(projectId);
      const repeated = state.operations.find((o) => o.id === reviewId);
      if (repeated) {
        if (repeated.batchId !== batchId)
          throw new AppError('This move belongs to a different batch.', 409);
        return repeated;
      }
      this.idle();
      const approved = this.reviews.get(reviewId);
      const batch = this.batch(state, batchId);
      if (
        !approved ||
        approved.projectId !== projectId ||
        approved.batchId !== batchId ||
        approved.revision !== batch.revision ||
        approved.expiresAt < Date.now()
      )
        throw new AppError('The plan changed or this review expired. Review the moves again.', 409);
      const fresh = await this.review(projectId, batchId);
      if (fresh.issues.length)
        throw new AppError(
          'The files changed or the plan has blocking issues. Review the moves again.',
          409,
        );
      if (!fresh.items.length) throw new AppError('There are no pending moves.');
      const operation: Operation = {
        id: reviewId,
        batchId,
        status: 'running',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        items: fresh.items.map((item) => ({
          ...item,
          baseline: batch.clips.find((c) => c.id === item.clipId)!.baseline!,
          status: 'pending',
          error: null,
        })),
      };
      state.operations.push(operation);
      await this.store.save(state);
      this.busy = operation.id;
      this.activeJob = this.perform(state, operation)
        .catch((e) => {
          console.error('Move stopped; journal will be reconciled:', e);
        })
        .finally(() => {
          this.busy = null;
          this.activeJob = null;
        });
      return operation;
    });
  }
  private markSuccess(state: ProjectState, op: Operation, index: number) {
    const item = op.items[index];
    const batch = this.batch(state, op.batchId);
    const clip = batch.clips.find((c) => c.id === item.clipId)!;
    item.status = 'succeeded';
    item.error = null;
    clip.currentPath = item.to;
    clip.applied = true;
    clip.held = false;
    clip.baseline = item.markerRewrite?.preparedBaseline ?? item.baseline;
    state.catalog[String(clip.id)] = { path: item.to, baseline: clip.baseline };
    batch.revision++;
  }
  private async perform(state: ProjectState, operation: Operation) {
    for (let index = 0; index < operation.items.length; index++) {
      const item = operation.items[index];
      try {
        const source = await safePath(state.project.mediaRoot, item.from);
        const target = await safePath(state.project.mediaRoot, item.to, true);
        if (!sameFile(await fingerprint(source), item.baseline))
          throw new AppError('Source changed before the move.');
        if ((await parentDevice(target)) !== item.baseline.dev)
          throw new AppError('Destination moved to a different volume.');
        if (item.from !== item.to && (await exists(target)))
          throw new AppError('Destination already exists. Nothing was replaced.');
        item.status = 'moving';
        await this.store.save(state); // Durable intent precedes filesystem changes.
        if (item.markerChanges?.length) {
          const name = `${item.clipId}${path.extname(item.from)}`;
          item.markerRewrite = {
            backupPath: `.footage-organizer-originals/${operation.id}/${name}`,
            preparedPath: `.footage-organizer-work/${operation.id}/${name}`,
          };
          const backup = await safePath(
            state.project.mediaRoot,
            item.markerRewrite.backupPath,
            true,
          );
          const prepared = await safePath(
            state.project.mediaRoot,
            item.markerRewrite.preparedPath,
            true,
          );
          await this.store.save(state);
          await this.markerWriter.prepare(source, prepared, item.markerChanges, item.baseline.size);
          if (!sameFile(await fingerprint(source), item.baseline))
            throw new AppError('Source changed during marker preparation.');
          item.markerRewrite.preparedBaseline = await fingerprint(prepared);
          await this.store.save(state); // Verified output identity is durable before archiving the original.
          await safePath(state.project.mediaRoot, item.from);
          await safePath(state.project.mediaRoot, item.markerRewrite.backupPath);
          await this.moveFile(source, backup);
          if (!sameFile(await fingerprint(backup), item.baseline))
            throw new AppError('Original backup needs recovery review.');
          await safePath(state.project.mediaRoot, item.to);
          await safePath(state.project.mediaRoot, item.markerRewrite.preparedPath);
          await this.moveFile(prepared, target);
          if (!sameFile(await fingerprint(target), item.markerRewrite.preparedBaseline))
            throw new AppError('Published marker update needs recovery review.');
        } else {
          await this.moveFile(source, target);
          if ((await exists(source)) || !sameFile(await fingerprint(target), item.baseline))
            throw new AppError('The move result needs recovery review.');
        }
        this.markSuccess(state, operation, index);
        await this.store.save(state);
      } catch (e) {
        item.error = messageOf(e);
        operation.status = 'failed';
        operation.finishedAt = new Date().toISOString();
        // A helper timeout can mean the move happened. Reconcile identity before
        // classifying the outcome; do not repeat or roll back the command.
        await this.reconcileItem(state, operation, index);
        if (item.status === 'pending') item.status = 'failed';
        if (operation.items.every((entry) => entry.status === 'succeeded'))
          operation.status = 'completed';
        await this.store.save(state);
        return;
      }
    }
    operation.status = 'completed';
    operation.finishedAt = new Date().toISOString();
    await this.store.save(state);
  }
  private async reconcileItem(state: ProjectState, operation: Operation, index: number) {
    const item = operation.items[index];
    try {
      const from = await safePath(state.project.mediaRoot, item.from);
      const to = await safePath(state.project.mediaRoot, item.to);
      const source = (await exists(from)) ? await fingerprint(from) : null;
      const target = (await exists(to)) ? await fingerprint(to) : null;
      if (item.markerRewrite) {
        const backupPath = await safePath(state.project.mediaRoot, item.markerRewrite.backupPath);
        const backup = (await exists(backupPath)) ? await fingerprint(backupPath) : null;
        if (
          backup &&
          sameFile(backup, item.baseline) &&
          target &&
          item.markerRewrite.preparedBaseline &&
          sameFile(target, item.markerRewrite.preparedBaseline) &&
          (item.from === item.to || !source)
        )
          this.markSuccess(state, operation, index);
        else if (source && sameFile(source, item.baseline) && !backup) item.status = 'pending';
        else {
          item.status = 'ambiguous';
          item.error = `Marker update needs recovery. Original backup: ${item.markerRewrite.backupPath}. Use Restore original for an interrupted update, then review again.`;
        }
        return;
      }
      if (!source && target && sameFile(target, item.baseline))
        this.markSuccess(state, operation, index);
      else if (
        source &&
        sameFile(source, item.baseline) &&
        (!target || !sameFile(target, item.baseline))
      )
        item.status = 'pending';
      else {
        item.status = 'ambiguous';
        item.error =
          'Cannot determine the result safely. Check the source and destination before retrying recovery.';
      }
    } catch (e) {
      item.status = 'ambiguous';
      item.error = messageOf(e);
    }
  }
  private async reconcileUnlocked(state: ProjectState) {
    let changed = false;
    for (const operation of state.operations) {
      if (
        operation.status !== 'running' &&
        !operation.items.some((i) => i.status === 'ambiguous' || i.status === 'moving')
      )
        continue;
      for (let i = 0; i < operation.items.length; i++) {
        if (operation.items[i].status === 'succeeded') continue;
        await this.reconcileItem(state, operation, i);
      }
      operation.status = operation.items.every((i) => i.status === 'succeeded')
        ? 'completed'
        : 'interrupted';
      operation.finishedAt = new Date().toISOString();
      changed = true;
    }
    if (changed) await this.store.save(state);
    return state;
  }
  async reconcile(projectId: string) {
    return this.store.serial(async () => {
      this.idle();
      return this.reconcileUnlocked(await this.store.load(projectId));
    });
  }
  async restoreMarkerOriginal(projectId: string, operationId: string, clipId: number) {
    return this.store.serial(async () => {
      this.idle();
      const state = await this.reconcileUnlocked(await this.store.load(projectId));
      const operation = state.operations.find((o) => o.id === operationId);
      const item = operation?.items.find((i) => i.clipId === clipId);
      if (!operation || !item?.markerRewrite || item.status !== 'ambiguous')
        throw new AppError(
          'Only an interrupted marker update can restore its original. Check recovery first.',
        );
      const backup = await safePath(state.project.mediaRoot, item.markerRewrite.backupPath);
      const source = await safePath(state.project.mediaRoot, item.from, true);
      if (await exists(source))
        throw new AppError('The original path is occupied. Nothing was replaced.');
      if (!sameFile(await fingerprint(backup), item.baseline))
        throw new AppError('The original backup changed. Nothing was moved.');
      await this.moveFile(backup, source);
      await this.reconcileItem(state, operation, operation.items.indexOf(item));
      operation.status = 'interrupted';
      await this.store.save(state);
      return state;
    });
  }
  async waitForIdle() {
    await this.activeJob;
  }
  async player(projectId: string, batchId: string, clipId: number) {
    const { file } = await this.mediaFile(projectId, batchId, clipId);
    if (!/\.(mp4|mkv|mov|webm|avi|m4v|mxf|mts|m2ts|mp3|wav|flac|m4a)$/i.test(file))
      throw new AppError('Only media files can be opened in the player.');
    await openMedia(file);
  }
}
