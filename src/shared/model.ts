import { z } from 'zod';

export const safeId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
// These IDs become filenames; Windows device names are invalid even with .json appended.
const recordId = safeId.regex(
  /^(?!(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$)/i,
  'Choose an ID that is not a reserved Windows device name.',
);
export const proposalSchema = z.object({
  filename: z.string().min(1).max(255),
  folder: z.string().max(1500),
});
export const markerSchema = z.object({
  id: safeId.optional(),
  seconds: z.number().nonnegative(),
  label: z.string().max(4000),
  // Only extracted embedded chapters may be rewritten in the media file.
  chapterIndex: z.number().int().nonnegative().optional(),
});
export const markerProposalsSchema = z
  .object({
    schemaVersion: z.literal(1),
    items: z
      .array(
        z
          .object({
            markerId: safeId,
            originalLabel: z.string().max(4000),
            seconds: z.number().nonnegative(),
            proposedLabel: z.string().trim().min(1).max(4000),
            rationale: z.string().max(4000).default(''),
          })
          .strict(),
      )
      .max(10000),
  })
  .strict();
export const markerDecisionSchema = z
  .object({
    markerId: safeId,
    label: z.string().max(4000),
    status: z.enum(['pending', 'accepted', 'rejected']),
  })
  .strict();
export type SourceMarker = z.infer<typeof markerSchema>;
export type MarkerProposals = z.infer<typeof markerProposalsSchema>;
export type MarkerDecision = z.infer<typeof markerDecisionSchema>;
export const handoffClipSchema = z.object({
  id: z.number().int().positive(),
  source: z.object({
    relativePath: z.string().min(1).max(1800),
    size: z.number().int().nonnegative().optional(),
    mtimeMs: z.number().nonnegative().optional(),
  }),
  duration: z.number().nonnegative().nullable().default(null),
  markers: z.array(markerSchema).max(10000).default([]),
  markerProposals: markerProposalsSchema.optional(),
  proposed: proposalSchema,
  rationale: z.string().max(16000).default(''),
  questions: z.array(z.string().max(4000)).default([]),
  hold: z.boolean().default(false),
});
export const handoffSchema = z.object({
  schemaVersion: z.literal(1),
  handoffId: recordId,
  projectId: safeId,
  batchId: recordId,
  title: z.string().min(1).max(240),
  createdAt: z.string().datetime(),
  reviewNotes: z.string().max(64000).default(''),
  reviewFolder: z.string().max(1800).optional(),
  folders: z.array(z.string().max(1500)).default([]),
  clips: z.array(handoffClipSchema).min(1).max(10000),
});
export type Handoff = z.infer<typeof handoffSchema>;
export type Proposal = z.infer<typeof proposalSchema>;

export const projectInputSchema = z.object({
  id: safeId,
  name: z.string().trim().min(1).max(200),
  mediaRoot: z.string().min(1).max(1800),
  dataDir: z.string().min(1).max(1800),
  namingNotes: z.string().max(16000).default(''),
  reviewFolder: z.string().max(1800).optional(),
});
export type Project = z.infer<typeof projectInputSchema>;
export const baselineSchema = z.object({
  size: z.number(),
  mtimeMs: z.number(),
  mtimeNs: z.string(),
  dev: z.string(),
  ino: z.string(),
});
export type Baseline = z.infer<typeof baselineSchema>;
export const removedProjectSchema = z.object({
  removalId: safeId,
  project: projectInputSchema,
  removedAt: z.string().datetime(),
  cleanupFiles: z
    .array(
      z.object({
        relativePath: z
          .string()
          .regex(
            /^(?:state\.json|(?:imports|operations)\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}\.json|batches\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}\.(?:json|md)|checkpoints\/\d+\.json)$/,
          ),
        baseline: baselineSchema,
      }),
    )
    .optional(),
});
export type RemovedProject = z.infer<typeof removedProjectSchema>;
export const agentReviewSchema = z.object({
  updateId: safeId,
  reviewedAt: z.string(),
  rationale: z.string().max(16000),
  questions: z.array(z.string().max(4000)),
  markerProposals: markerProposalsSchema.optional(),
});
export const batchClipSchema = z.object({
  id: z.number().int().positive(),
  currentPath: z.string(),
  baseline: baselineSchema.nullable(),
  importIssue: z.string().nullable(),
  original: handoffClipSchema,
  proposed: proposalSchema,
  note: z.string(),
  held: z.boolean(),
  applied: z.boolean(),
  agentReview: agentReviewSchema.optional(),
  markerDecisions: z.array(markerDecisionSchema).max(10000).optional(),
});
export type BatchClip = z.infer<typeof batchClipSchema>;
export const reviewUpdateSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('batch-update'),
    updateId: safeId,
    requestId: safeId,
    projectId: safeId,
    batchId: safeId,
    createdAt: z.string().datetime(),
    reviewNotes: z.string().max(64000).default(''),
    clips: z
      .array(
        z
          .object({
            id: z.number().int().positive(),
            proposed: proposalSchema.strict(),
            rationale: z.string().max(16000),
            questions: z.array(z.string().max(4000)).default([]),
            markerProposals: markerProposalsSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(10000),
  })
  .strict();
export type ReviewUpdate = z.infer<typeof reviewUpdateSchema>;
export const heldReviewRequestSchema = z.object({
  id: safeId,
  createdAt: z.string(),
  batchRevision: z.number().int(),
  batchNotes: z.string(),
  clips: z.array(batchClipSchema),
});
export type HeldReviewRequest = z.infer<typeof heldReviewRequestSchema>;
export const acceptedReviewUpdateSchema = z.object({
  update: reviewUpdateSchema,
  acceptedAt: z.string(),
  clipIds: z.array(z.number().int().positive()),
  before: z.array(batchClipSchema),
});
export const batchSchema = z.object({
  id: safeId,
  handoffId: safeId,
  title: z.string(),
  importedAt: z.string(),
  revision: z.number().int(),
  folders: z.array(z.string()),
  reviewNotes: z.string(),
  notes: z.string(),
  clips: z.array(batchClipSchema),
  reviewFolder: z.string().optional(),
  reviewRequests: z.array(heldReviewRequestSchema).optional(),
  reviewUpdates: z.array(acceptedReviewUpdateSchema).optional(),
});
export type Batch = z.infer<typeof batchSchema>;
export const editSchema = z.object({
  revision: z.number().int().nonnegative(),
  notes: z.string().max(64000),
  folders: z.array(z.string().max(1500)).max(1000),
  clips: z
    .array(
      z.object({
        id: z.number().int().positive(),
        proposed: proposalSchema,
        note: z.string().max(16000),
        held: z.boolean(),
        markerDecisions: z.array(markerDecisionSchema).max(10000).optional(),
      }),
    )
    .max(10000),
});
export type BatchEdit = z.infer<typeof editSchema>;
export const markerChangeSchema = z.object({
  markerId: safeId,
  chapterIndex: z.number().int().nonnegative(),
  seconds: z.number().nonnegative(),
  originalLabel: z.string(),
  label: z.string(),
});
export type MarkerChange = z.infer<typeof markerChangeSchema>;
export const operationItemSchema = z.object({
  clipId: z.number(),
  from: z.string(),
  to: z.string(),
  baseline: baselineSchema,
  status: z.enum(['pending', 'moving', 'succeeded', 'failed', 'ambiguous']),
  error: z.string().nullable(),
  markerChanges: z.array(markerChangeSchema).optional(),
  markerRewrite: z
    .object({
      backupPath: z.string(),
      preparedPath: z.string(),
      preparedBaseline: baselineSchema.optional(),
    })
    .optional(),
});
export type OperationItem = z.infer<typeof operationItemSchema>;
export const operationSchema = z.object({
  id: safeId,
  batchId: safeId,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  status: z.enum(['running', 'completed', 'failed', 'interrupted']),
  items: z.array(operationItemSchema),
});
export type Operation = z.infer<typeof operationSchema>;
export const stateSchema = z.object({
  schemaVersion: z.literal(1),
  project: projectInputSchema,
  revision: z.number().int(),
  catalog: z.record(
    z.string(),
    z.object({ path: z.string(), baseline: baselineSchema.nullable() }),
  ),
  batches: z.array(batchSchema),
  operations: z.array(operationSchema),
});
export type ProjectState = z.infer<typeof stateSchema>;
export interface ProjectSummary extends Project {
  batches: {
    id: string;
    title: string;
    importedAt: string;
    clips: number;
    pending: number;
    held: number;
  }[];
  clipCount: number;
}
export interface Issue {
  clipId: number | null;
  message: string;
}
export interface MoveReview {
  id: string;
  projectId: string;
  batchId: string;
  revision: number;
  items: { clipId: number; from: string; to: string; markerChanges?: MarkerChange[] }[];
  issues: Issue[];
  held: number;
  unchanged: number;
  newFolders: string[];
  expiresAt: number;
}
export interface ReviewInventory {
  folder: string;
  absoluteFolder: string;
  scannedAt: string;
  files: {
    relativePath: string;
    size: number;
    mtimeMs: number;
    existingClipId: number | null;
    batchIds: string[];
    markers?: SourceMarker[];
    markerStatus?: 'read' | 'unavailable' | 'not-scanned';
    markerNote?: string;
  }[];
  skippedFiles: number;
}
export interface ReviewUpdatePreview {
  update: ReviewUpdate;
  revision: number;
  clips: {
    suggestion: ReviewUpdate['clips'][number];
    current: BatchClip | null;
    conflicts: string[];
    alreadyApplied: boolean;
  }[];
}
export function targetPath(clip: Pick<BatchClip, 'proposed'>) {
  return [clip.proposed.folder, clip.proposed.filename].filter(Boolean).join('/');
}
export function isPending(clip: BatchClip) {
  return (
    !clip.held &&
    !clip.applied &&
    (clip.currentPath !== targetPath(clip) ||
      clip.original.markers.some(
        (m, i) =>
          m.chapterIndex !== undefined &&
          clip.markerDecisions?.some(
            (d) =>
              d.markerId === (m.id ?? `marker-${i + 1}`) &&
              d.status === 'accepted' &&
              d.label !== m.label,
          ),
      ))
  );
}
export function editOf(batch: Batch): BatchEdit {
  return {
    revision: batch.revision,
    notes: batch.notes,
    folders: batch.folders,
    clips: batch.clips.map(({ id, proposed, note, held, markerDecisions }) => ({
      id,
      proposed,
      note,
      held,
      ...(markerDecisions ? { markerDecisions } : {}),
    })),
  };
}
export function clipLabel(id: number) {
  return String(id).padStart(3, '0');
}
export function durationLabel(seconds: number | null) {
  if (seconds === null) return '—';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
