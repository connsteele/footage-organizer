import { z } from 'zod';

export const safeId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
export const proposalSchema = z.object({
  filename: z.string().min(1).max(255),
  folder: z.string().max(1500),
});
export const handoffClipSchema = z.object({
  id: z.number().int().positive(),
  source: z.object({
    relativePath: z.string().min(1).max(1800),
    size: z.number().int().nonnegative().optional(),
    mtimeMs: z.number().nonnegative().optional(),
  }),
  duration: z.number().nonnegative().nullable().default(null),
  markers: z
    .array(z.object({ seconds: z.number().nonnegative(), label: z.string().max(4000) }))
    .default([]),
  proposed: proposalSchema,
  rationale: z.string().max(16000).default(''),
  questions: z.array(z.string().max(4000)).default([]),
  hold: z.boolean().default(false),
});
export const handoffSchema = z.object({
  schemaVersion: z.literal(1),
  handoffId: safeId,
  projectId: safeId,
  batchId: safeId,
  title: z.string().min(1).max(240),
  createdAt: z.string().datetime(),
  reviewNotes: z.string().max(64000).default(''),
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
});
export type BatchClip = z.infer<typeof batchClipSchema>;
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
      }),
    )
    .max(10000),
});
export type BatchEdit = z.infer<typeof editSchema>;
export const operationItemSchema = z.object({
  clipId: z.number(),
  from: z.string(),
  to: z.string(),
  baseline: baselineSchema,
  status: z.enum(['pending', 'moving', 'succeeded', 'failed', 'ambiguous']),
  error: z.string().nullable(),
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
  items: { clipId: number; from: string; to: string }[];
  issues: Issue[];
  held: number;
  unchanged: number;
  newFolders: string[];
  expiresAt: number;
}
export function targetPath(clip: Pick<BatchClip, 'proposed'>) {
  return [clip.proposed.folder, clip.proposed.filename].filter(Boolean).join('/');
}
export function isPending(clip: BatchClip) {
  return !clip.held && !clip.applied && clip.currentPath !== targetPath(clip);
}
export function editOf(batch: Batch): BatchEdit {
  return {
    revision: batch.revision,
    notes: batch.notes,
    folders: batch.folders,
    clips: batch.clips.map(({ id, proposed, note, held }) => ({ id, proposed, note, held })),
  };
}
export function clipLabel(id: number) {
  return String(id).padStart(3, '0');
}
export function durationLabel(seconds: number | null) {
  if (seconds === null) return '—';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
