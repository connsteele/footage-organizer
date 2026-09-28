import { clipLabel, targetPath, type Batch, type Operation, type Project } from './model.js';
import { identifiedMarkers } from './markers.js';
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
  for (const folder of [...new Set(batch.clips.map((c) => c.proposed.folder))].sort()) {
    lines.push(
      `## ${folder || 'Media root'}`,
      '',
      '| ID | Current path | Proposed path | Status | Rationale / notes |',
      '|---|---|---|---|---|',
    );
    for (const c of batch.clips.filter((c) => c.proposed.folder === folder)) {
      const status = c.applied
        ? 'Moved'
        : c.held
          ? 'Held'
          : c.currentPath === targetPath(c)
            ? 'Unchanged'
            : 'Pending';
      lines.push(
        `| ${clipLabel(c.id)} | ${cell(c.currentPath)} | ${cell(targetPath(c))} | ${status} | ${cell([`Original review: ${c.original.rationale}`, ...(c.agentReview ? [`Latest follow-up: ${c.agentReview.rationale}`, ...c.agentReview.questions] : c.original.questions), c.note && `Your note: ${c.note}`, c.importIssue ?? ''].filter(Boolean).join('\n'))} |`,
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
  for (const clip of batch.clips.filter((c) => c.original.markers.length)) {
    lines.push(
      `## Clip ${clipLabel(clip.id)} — marker review`,
      '',
      '| Time (seconds) | Original | Suggested / edited | Decision | Reason |',
      '|---|---|---|---|---|',
    );
    for (const marker of identifiedMarkers(clip.original.markers)) {
      const decision = clip.markerDecisions?.find((d) => d.markerId === marker.id);
      const proposal =
        clip.agentReview?.markerProposals?.items.find((p) => p.markerId === marker.id) ??
        clip.original.markerProposals?.items.find((p) => p.markerId === marker.id);
      lines.push(
        `| ${marker.seconds} | ${cell(marker.label)} | ${cell(decision?.label ?? proposal?.proposedLabel ?? marker.label)} | ${decision?.status ?? 'unchanged'}${marker.chapterIndex === undefined ? ' (export only)' : clip.applied && decision?.status === 'accepted' ? ' (written)' : ''} | ${cell(proposal?.rationale ?? '')} |`,
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
