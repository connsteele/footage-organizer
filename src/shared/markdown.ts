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
        `| ${clipLabel(c.id)} | ${cell(c.currentPath)} | ${cell(targetPath(c))} | ${status} | ${cell([c.original.rationale, ...c.original.questions, c.note, c.importIssue ?? ''].filter(Boolean).join('\n'))} |`,
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
