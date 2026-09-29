import type { BatchClip } from './model.js';

export function groupClipsByFolder(clips: BatchClip[]) {
  const groups = new Map<string, BatchClip[]>();
  for (const clip of clips) {
    const group = groups.get(clip.proposed.folder);
    if (group) group.push(clip);
    else groups.set(clip.proposed.folder, [clip]);
  }
  return groups;
}
