import type { ProjectState, ReviewInventory } from '../shared/model';
import agentGuide from '../../docs/AGENT_GUIDE.md?raw';
import protocol from '../../docs/HANDOFF.md?raw';
import schema from '../../docs/handoff.schema.json?raw';
import example from '../../docs/examples/handoff.v1.json?raw';

export const handoffDocuments = { agentGuide, protocol, schema, example };

function jsonBlock(value: unknown) {
  const json = JSON.stringify(value, null, 2);
  const longestRun = Math.max(2, ...(json.match(/`+/g) || []).map((run) => run.length));
  const fence = '`'.repeat(longestRun + 1);
  return `${fence}json\n${json}\n${fence}`;
}

export function buildHandoffKit(
  state: ProjectState,
  folders: string[],
  exportedAt = new Date().toISOString(),
  inventory?: ReviewInventory,
) {
  const context = {
    kind: 'footage-organizer-context',
    schemaVersion: 1,
    exportedAt,
    projectRevision: state.revision,
    project: state.project,
    catalog: state.catalog,
    folders,
    nextClipId: Math.max(0, ...Object.keys(state.catalog).map(Number)) + 1,
    reviewInventory: inventory,
    batches: state.batches.map((batch) => ({
      id: batch.id,
      handoffId: batch.handoffId,
      title: batch.title,
      revision: batch.revision,
      importedAt: batch.importedAt,
      reviewNotes: batch.reviewNotes,
      notes: batch.notes,
      reviewFolder: batch.reviewFolder,
      folders: batch.folders,
      clips: batch.clips.map((clip) => ({
        id: clip.id,
        currentPath: clip.currentPath,
        proposed: clip.proposed,
        note: clip.note,
        held: clip.held,
        applied: clip.applied,
        importIssue: clip.importIssue,
        questions: clip.original.questions,
        agentReview: clip.agentReview,
      })),
    })),
  };
  return [
    '# Footage Organizer handoff kit',
    'This file is reference material for a review agent. It is not an import handoff. Read the guides below, use this project snapshot, and return a separate version 1 handoff JSON. The user reviews and executes the result in the app.',
    'The snapshot includes saved project data, not video or a complete disk inventory. Refresh it after edits or moves. Batch currentPath values describe that batch; the catalog is the current registered source of truth after moves. For the complete history and original suggestions in a batch, request its Export plan.',
    inventory
      ? 'Review only the media listed in reviewInventory for this batch. Copy reviewInventory.folder into the handoff reviewFolder field. Sources and destinations remain relative to Root Footage. Files with existingClipId already belong to this project: do not silently include them in a new batch; resolve held clips through their existing batch’s Agent follow-up. Assign new IDs starting at nextClipId to new files. The inventory provides paths, sizes and timestamps, not evidence of video content; inspect the supplied clips or clearly state what evidence is missing.'
      : 'Choose Review Footage in the app to add a scoped file inventory to the next kit.',
    '## Project snapshot',
    jsonBlock(context),
    '---',
    agentGuide.trim(),
    '---',
    protocol.trim(),
    '---',
    '## Standalone fictional example — replace all project-specific values',
    jsonBlock(JSON.parse(example)),
    '## Version 1 JSON schema',
    jsonBlock(JSON.parse(schema)),
    '',
  ].join('\n\n');
}
