import { expect, it } from 'vitest';
import { z } from 'zod';
import { handoffSchema, type ProjectState } from '../src/shared/model';
import { buildHandoffKit, handoffDocuments } from '../src/client/handoffKit';
import { validateHandoff } from '../scripts/validate-handoff';

it('ships an example accepted by the validator and a schema matching the live model', () => {
  expect(validateHandoff(JSON.parse(handoffDocuments.example)).clips).toHaveLength(2);
  expect(JSON.parse(handoffDocuments.schema)).toEqual(
    z.toJSONSchema(handoffSchema, { io: 'input' }),
  );
});

it('rejects invalid path, identity, filename, and extension proposals before import', () => {
  const invalid = [
    (handoff: ReturnType<typeof handoffSchema.parse>) => {
      handoff.clips[1].id = handoff.clips[0].id;
    },
    (handoff: ReturnType<typeof handoffSchema.parse>) => {
      handoff.clips[1].source.relativePath = handoff.clips[0].source.relativePath.toUpperCase();
    },
    (handoff: ReturnType<typeof handoffSchema.parse>) => {
      handoff.clips[0].proposed.folder = '../Outside';
    },
    (handoff: ReturnType<typeof handoffSchema.parse>) => {
      handoff.clips[0].proposed.filename = 'CON.mp4';
    },
    (handoff: ReturnType<typeof handoffSchema.parse>) => {
      handoff.clips[0].proposed.filename = 'Changed.mov';
    },
  ];
  for (const mutate of invalid) {
    const handoff = handoffSchema.parse(JSON.parse(handoffDocuments.example));
    mutate(handoff);
    expect(() => validateHandoff(handoff)).toThrow();
  }
});

it('exports saved decisions and current catalog paths without mixing independent projects', () => {
  const handoff = handoffSchema.parse(JSON.parse(handoffDocuments.example));
  const state: ProjectState = {
    schemaVersion: 1,
    revision: 9,
    project: {
      id: 'alice-review',
      name: 'Alice project',
      mediaRoot: 'D:/Alice/Media',
      dataDir: 'D:/Alice/Plans',
      namingNotes: 'Keep original prefixes',
    },
    catalog: { '7': { path: 'Filed/Current.mp4', baseline: null } },
    batches: [
      {
        id: 'saved-batch',
        handoffId: 'saved-handoff',
        title: 'Existing decisions',
        importedAt: handoff.createdAt,
        revision: 4,
        folders: ['Story'],
        reviewNotes: 'Sampled frames',
        notes: 'User asked for ```literal fences``` in notes',
        clips: [
          {
            id: 7,
            currentPath: '_cut/Original.mp4',
            baseline: null,
            importIssue: null,
            original: handoff.clips[0],
            proposed: { folder: 'Story', filename: 'User choice.mp4' },
            note: 'Keep this decision',
            held: true,
            applied: false,
          },
        ],
      },
    ],
    operations: [],
  };
  const original = structuredClone(state);
  const kit = buildHandoffKit(state, ['Filed'], '2026-09-27T06:00:00.000Z');
  const snapshot = JSON.parse(kit.match(/(`{3,})json\n([\s\S]*?)\n\1/)![2]);
  expect(snapshot).toMatchObject({
    exportedAt: '2026-09-27T06:00:00.000Z',
    projectRevision: 9,
    nextClipId: 8,
    folders: ['Filed'],
    catalog: { '7': { path: 'Filed/Current.mp4' } },
  });
  expect(snapshot.batches[0]).toMatchObject({
    handoffId: 'saved-handoff',
    notes: state.batches[0].notes,
    clips: [
      { id: 7, note: 'Keep this decision', held: true, proposed: { filename: 'User choice.mp4' } },
    ],
  });
  expect(kit).toContain(handoffDocuments.protocol.trim());
  expect(kit).toContain('Version 1 JSON schema');
  expect(state).toEqual(original);
  const other: ProjectState = {
    ...state,
    project: {
      ...state.project,
      id: 'bob-review',
      name: 'Bob project',
      mediaRoot: 'E:/Bob/Media',
      dataDir: 'E:/Bob/Plans',
      namingNotes: '',
    },
    catalog: {},
    batches: [],
  };
  const otherKit = buildHandoffKit(other, []);
  expect(otherKit).not.toContain('D:/Alice');
  expect(otherKit).not.toContain('Keep this decision');
  expect(otherKit).toContain('"nextClipId": 1');
});
