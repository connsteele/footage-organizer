import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  reviewUpdateSchema,
  safeId,
  type Batch,
  type HeldReviewRequest,
  type ProjectState,
  type ReviewUpdate,
  type ReviewUpdatePreview,
} from '../shared/model.js';
import {
  AppError,
  filenameProblem,
  fingerprint,
  messageOf,
  relativePath,
  safePath,
  sameFile,
} from './paths.js';
import type { Store } from './store.js';
import {
  initialMarkerDecisions,
  sourceMarkers,
  validateMarkerProposals,
} from '../shared/markers.js';

function getBatch(state: ProjectState, id: string) {
  const batch = state.batches.find((b) => b.id === id);
  if (!batch) throw new AppError('Batch not found.', 404);
  return batch;
}
function requestFor(batch: Batch, update: ReviewUpdate) {
  const request = batch.reviewRequests?.find((r) => r.id === update.requestId);
  if (!request)
    throw new AppError(
      'This review request was not exported from this batch. Export held clips for review first.',
    );
  return request;
}
export class ReviewUpdates {
  constructor(
    private store: Store,
    private idle: () => void,
  ) {}
  async exportHeld(projectId: string, batchId: string) {
    return this.store.serial(async () => {
      this.idle();
      const state = await this.store.load(projectId);
      const batch = getBatch(state, batchId);
      const clips = batch.clips.filter((c) => c.held && !c.applied);
      if (!clips.length) throw new AppError('There are no held clips to export.');
      const request: HeldReviewRequest = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        batchRevision: batch.revision,
        batchNotes: batch.notes,
        clips: structuredClone(clips),
      };
      (batch.reviewRequests ??= []).push(request);
      // A request records a snapshot; it does not edit the batch's decisions or invalidate its draft.
      await this.store.save(state);
      return { state, request };
    });
  }
  private async inspect(
    state: ProjectState,
    batch: Batch,
    input: unknown,
  ): Promise<ReviewUpdatePreview> {
    const update = reviewUpdateSchema.parse(input);
    for (const suggestion of update.clips)
      suggestion.proposed.folder = relativePath(suggestion.proposed.folder, true);
    if (update.projectId !== state.project.id || update.batchId !== batch.id)
      throw new AppError('This update belongs to a different project or batch.');
    if (new Set(update.clips.map((c) => c.id)).size !== update.clips.length)
      throw new AppError('Duplicate clip IDs in the batch update.');
    const request = requestFor(batch, update);
    const prior = (batch.reviewUpdates ?? []).filter((r) => r.update.updateId === update.updateId);
    if (prior.some((r) => JSON.stringify(r.update) !== JSON.stringify(update)))
      throw new AppError(
        'This update ID was already used for different suggestions. Ask for a new update ID.',
      );
    const result: ReviewUpdatePreview = { update, revision: batch.revision, clips: [] };
    for (const suggestion of update.clips) {
      const exported = request.clips.find((c) => c.id === suggestion.id);
      if (!exported)
        throw new AppError(
          `Clip ${suggestion.id} was not included in this held-clip review request.`,
        );
      const problem = filenameProblem(suggestion.proposed.filename);
      validateMarkerProposals(sourceMarkers(exported), suggestion.markerProposals);
      if (
        suggestion.markerProposals?.items.some((m) =>
          exported.markerDecisions?.some(
            (d) => d.markerId === m.markerId && d.status === 'deleted',
          ),
        )
      )
        throw new AppError(
          'An update cannot rename a deleted marker. Restore it in the app and export a fresh review.',
        );
      if (problem) throw new AppError(`Clip ${suggestion.id}: ${problem}`);
      if (
        path.extname(exported.currentPath).toLowerCase() !==
        path.extname(suggestion.proposed.filename).toLowerCase()
      )
        throw new AppError(`Clip ${suggestion.id}: keep the original file extension.`);
      const current = batch.clips.find((c) => c.id === suggestion.id) ?? null;
      const alreadyApplied = prior.some((r) => r.clipIds.includes(suggestion.id));
      const conflicts: string[] = [];
      if (!current) conflicts.push('This clip is no longer in the batch.');
      else {
        if (current.applied) conflicts.push('This clip has already been filed.');
        if (!current.held) conflicts.push('This clip is no longer held for review.');
        if (batch.notes !== request.batchNotes)
          conflicts.push('Batch decisions changed after this review was exported.');
        if (
          current.note !== exported.note ||
          JSON.stringify(current.proposed) !== JSON.stringify(exported.proposed) ||
          JSON.stringify(current.agentReview) !== JSON.stringify(exported.agentReview) ||
          JSON.stringify(current.markerDecisions ?? []) !==
            JSON.stringify(exported.markerDecisions ?? []) ||
          JSON.stringify(current.localMarkers ?? []) !== JSON.stringify(exported.localMarkers ?? [])
        )
          conflicts.push('Your notes or suggestions changed after this review was exported.');
        if (
          current.currentPath !== exported.currentPath ||
          state.catalog[String(current.id)]?.path !== exported.currentPath
        )
          conflicts.push('The current file location has changed.');
        if (current.importIssue) conflicts.push(current.importIssue);
        try {
          if (
            !exported.baseline ||
            !current.baseline ||
            !sameFile(exported.baseline, current.baseline) ||
            !sameFile(
              exported.baseline,
              await fingerprint(await safePath(state.project.mediaRoot, current.currentPath)),
            )
          )
            conflicts.push(
              'The source file changed or has no verified baseline. Prepare a fresh handoff.',
            );
        } catch (e) {
          conflicts.push(`Source unavailable: ${messageOf(e)}`);
        }
      }
      result.clips.push({ suggestion, current, conflicts, alreadyApplied });
    }
    return result;
  }
  async preview(projectId: string, batchId: string, input: unknown) {
    this.idle();
    const state = await this.store.load(projectId);
    return this.inspect(state, getBatch(state, batchId), input);
  }
  async apply(projectId: string, batchId: string, input: unknown) {
    const body = z
      .object({
        update: reviewUpdateSchema,
        revision: z.number().int(),
        clipIds: z.array(z.number().int().positive()).min(1).max(10000),
      })
      .strict()
      .parse(input);
    safeId.parse(projectId);
    safeId.parse(batchId);
    return this.store.serial(async () => {
      this.idle();
      const state = await this.store.load(projectId);
      const batch = getBatch(state, batchId);
      if (body.revision !== batch.revision)
        throw new AppError(
          'This batch changed after the preview. Refresh the preview before applying suggestions.',
          409,
        );
      if (new Set(body.clipIds).size !== body.clipIds.length)
        throw new AppError('Duplicate selected clip IDs.');
      const preview = await this.inspect(state, batch, body.update);
      const selected = body.clipIds.map((id) => {
        const item = preview.clips.find((c) => c.suggestion.id === id);
        if (!item || item.conflicts.length || item.alreadyApplied || !item.current)
          throw new AppError(
            `Clip ${id} cannot be updated. Refresh the preview and resolve its conflicts.`,
            409,
          );
        return item;
      });
      const before = selected.map((item) => structuredClone(item.current!));
      const acceptedAt = new Date().toISOString();
      for (const item of selected) {
        const clip = item.current!;
        clip.proposed = { ...item.suggestion.proposed };
        clip.held = true;
        if (item.suggestion.markerProposals) {
          const fresh = initialMarkerDecisions(item.suggestion.markerProposals);
          clip.markerDecisions = [
            ...(clip.markerDecisions ?? []).filter(
              (d) => !fresh.some((n) => n.markerId === d.markerId),
            ),
            ...fresh,
          ];
        }
        clip.agentReview = {
          updateId: body.update.updateId,
          reviewedAt: acceptedAt,
          rationale: item.suggestion.rationale,
          questions: item.suggestion.questions,
          markerProposals: item.suggestion.markerProposals
            ? {
                schemaVersion: 1,
                items: [
                  ...(
                    clip.agentReview?.markerProposals?.items ??
                    clip.original.markerProposals?.items ??
                    []
                  ).filter(
                    (p) =>
                      !item.suggestion.markerProposals!.items.some(
                        (n) => n.markerId === p.markerId,
                      ),
                  ),
                  ...item.suggestion.markerProposals.items,
                ],
              }
            : clip.agentReview?.markerProposals,
        };
      }
      batch.folders = [
        ...new Set([...batch.folders, ...selected.map((i) => i.suggestion.proposed.folder)]),
      ].sort();
      (batch.reviewUpdates ??= []).push({
        update: preview.update,
        acceptedAt,
        clipIds: body.clipIds,
        before,
      });
      batch.revision++;
      await this.store.save(state);
      return batch;
    });
  }
}
