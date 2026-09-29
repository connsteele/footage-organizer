import {
  clipLabel,
  targetPath,
  isPending,
  type Batch,
  type Operation,
  type Project,
} from './model.js';
import {
  sourceMarkers,
  writesMarker,
  markerDecisionsById,
  markerSuggestionsById,
} from './markers.js';
import { groupClipsByFolder } from './clipGroups.js';
const cell = (text: string) => text.replaceAll('|', '\\|').replaceAll('\n', '<br>');
export function batchMarkdown(project: Project, batch: Batch, operations: Operation[] = []) {
  const lines = [
    `# ${batch.title}`,
    '',
    `Project: ${project.name} (${project.id})`,
    `Batch: ${batch.id} · Revision: ${batch.revision}`,
    '',
    `Media root: ${project.mediaRoot}`,
    ...(batch.reviewFolder === undefined
      ? []
      : [`Review Footage: ${batch.reviewFolder || '(root)'}`]),
    '',
    '## Review notes',
    '',
    batch.reviewNotes || 'No imported notes.',
    '',
    '## Your decisions',
    '',
    batch.notes || 'No additional notes.',
    '',
  ];
  const groups = groupClipsByFolder(batch.clips);
  for (const folder of [...groups.keys()].sort()) {
    lines.push(
      `## ${folder || 'Media root'}`,
      '',
      '| ID | Current path | Proposed path | Status | Clip review | Rationale / notes |',
      '|---|---|---|---|---|---|',
    );
    for (const c of groups.get(folder)!) {
      const status = c.applied ? 'Moved' : c.held ? 'Held' : isPending(c) ? 'Pending' : 'Unchanged';
      lines.push(
        `| ${clipLabel(c.id)} | ${cell(c.currentPath)} | ${cell(targetPath(c))} | ${status} | ${c.reviewed ? 'Reviewed' : 'Needs review'} | ${cell([`Original review: ${c.original.rationale}`, ...(c.agentReview ? [`Latest follow-up: ${c.agentReview.rationale}`, ...c.agentReview.questions] : c.original.questions), c.note && `Your note: ${c.note}`, c.importIssue ?? ''].filter(Boolean).join('\n'))} |`,
      );
    }
    lines.push('');
  }
  for (const accepted of batch.reviewUpdates ?? []) {
    // Follow-up marker proposals are retained in the update's JSON and the current table below.
    lines.push(
      `## Accepted review update ${accepted.update.updateId}`,
      '',
      accepted.acceptedAt,
      '',
      accepted.update.reviewNotes,
      '',
      '| ID | Previous suggestion | Accepted suggestion | Reason |',
      '|---|---|---|---|',
    );
    for (const before of accepted.before) {
      const suggestion = accepted.update.clips.find((c) => c.id === before.id)!;
      lines.push(
        `| ${clipLabel(before.id)} | ${cell(targetPath(before))} | ${cell(targetPath(suggestion))} | ${cell(suggestion.rationale)} |`,
      );
    }
    lines.push('');
  }
  for (const clip of batch.clips.filter((c) => sourceMarkers(c).length)) {
    lines.push(
      `## Clip ${clipLabel(clip.id)} — marker review`,
      '',
      '| Time (seconds) | Original | Suggested / edited | Decision | Reason |',
      '|---|---|---|---|---|',
    );
    const decisions = markerDecisionsById(clip);
    const proposals = markerSuggestionsById(clip);
    for (const marker of sourceMarkers(clip)) {
      const decision = decisions.get(marker.id);
      const proposal = proposals.get(marker.id);
      lines.push(
        `| ${marker.seconds} | ${cell(marker.label)} | ${cell(decision?.label ?? proposal?.proposedLabel ?? marker.label)} | ${decision?.status ?? 'unchanged'}${marker.origin === 'added' ? ' (added)' : ''}${!writesMarker(marker) ? ' (export only)' : clip.applied && ['accepted', 'deleted'].includes(decision?.status ?? '') ? ' (written)' : ''} | ${cell(proposal?.rationale ?? '')} |`,
      );
    }
    lines.push('');
  }
  for (const op of operations.filter((o) => o.batchId === batch.id)) {
    lines.push(
      `## Operation ${op.id}`,
      '',
      `${op.status} · ${op.startedAt}`,
      '',
      '| ID | From | To | Result |',
      '|---|---|---|---|',
    );
    for (const item of op.items)
      lines.push(
        `| ${clipLabel(item.clipId)} | ${cell(item.from)} | ${cell(item.to)} | ${cell(item.error || item.status)} |`,
      );
    for (const item of op.items.filter((i) => i.markerRewrite))
      lines.push(
        '',
        `Clip ${clipLabel(item.clipId)} original backup: ${item.markerRewrite!.backupPath}`,
      );
    lines.push('');
  }
  return lines.join('\n');
}
