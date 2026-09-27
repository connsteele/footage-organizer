import { clipLabel, targetPath, type Batch, type Operation, type Project } from './model.js';
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
    lines.push('');
  }
  return lines.join('\n');
}
