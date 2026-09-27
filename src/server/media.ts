import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Baseline } from '../shared/model.js';
import { AppError, sameFile } from './paths.js';
import type { Organizer } from './service.js';

const mediaTypes: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mxf': 'application/mxf',
  '.mts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
};
type Ticket = {
  projectId: string;
  batchId: string;
  clipId: number;
  file: string;
  baseline: Baseline;
  expires: number;
};

// The native video element cannot add the app's request header. Give it a temporary,
// read-only URL for exactly one verified clip, rather than exposing the app session token.
export class MediaPreviews {
  private tickets = new Map<string, Ticket>();
  constructor(private service: Organizer) {}
  async create(projectId: string, batchId: string, clipId: number) {
    const { file, baseline } = await this.service.mediaFile(projectId, batchId, clipId);
    if (!mediaTypes[path.extname(file).toLowerCase()])
      throw new AppError('This file type cannot be previewed.');
    for (const [id, ticket] of this.tickets)
      if (ticket.expires < Date.now()) this.tickets.delete(id);
    while (this.tickets.size >= 64) this.tickets.delete(this.tickets.keys().next().value!);
    const id = randomBytes(24).toString('hex');
    this.tickets.set(id, {
      projectId,
      batchId,
      clipId,
      file,
      baseline,
      expires: Date.now() + 4 * 60 * 60 * 1000,
    });
    return { url: `/api/media/${id}` };
  }
  async resolve(id: string) {
    const ticket = this.tickets.get(id);
    if (!ticket || ticket.expires < Date.now())
      throw new AppError('Preview expired. Close and reopen it.', 404);
    const current = await this.service.mediaFile(ticket.projectId, ticket.batchId, ticket.clipId);
    if (current.file !== ticket.file || !sameFile(current.baseline, ticket.baseline))
      throw new AppError('This clip moved or changed. Close and reopen its preview.', 409);
    return { file: current.file, type: mediaTypes[path.extname(current.file).toLowerCase()] };
  }
  forget(projectId: string) {
    for (const [id, ticket] of this.tickets)
      if (ticket.projectId === projectId) this.tickets.delete(id);
  }
}
