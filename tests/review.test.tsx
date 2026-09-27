// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { Review } from '../src/client/Review';
import type { BatchEdit, ProjectState } from '../src/shared/model';

const mockApi = vi.hoisted(() => vi.fn());
vi.mock('../src/client/api', () => ({
  api: mockApi,
  download: vi.fn(),
  errorText: (e: Error) => e.message,
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('resets a suggestion without erasing the user note or releasing a user-held clip', async () => {
  const original = {
    id: 1,
    source: { relativePath: 'Incoming/Clip.mp4' },
    duration: 2,
    markers: [],
    proposed: { folder: 'Story', filename: 'Agent suggestion.mp4' },
    rationale: 'Original rationale',
    questions: [],
    hold: false,
  };
  const state: ProjectState = {
    schemaVersion: 1,
    revision: 1,
    project: {
      id: 'test',
      name: 'Test',
      mediaRoot: 'D:/Media',
      dataDir: 'D:/Plans',
      namingNotes: '',
    },
    catalog: { '1': { path: original.source.relativePath, baseline: null } },
    operations: [],
    batches: [
      {
        id: 'batch',
        handoffId: 'handoff',
        title: 'Test batch',
        importedAt: '2026-09-27T00:00:00Z',
        revision: 1,
        folders: ['Story', 'Gameplay'],
        reviewNotes: '',
        notes: '',
        clips: [
          {
            id: 1,
            currentPath: original.source.relativePath,
            baseline: null,
            importIssue: null,
            original,
            proposed: { folder: 'Gameplay', filename: 'User suggestion.mp4' },
            held: true,
            applied: false,
            note: 'Check this with the agent before filing.',
          },
        ],
      },
    ],
  };
  mockApi.mockImplementation(async (url: string, options?: { body: BatchEdit }) => {
    if (url === '/projects/test') return structuredClone(state);
    if (url === '/projects/test/folders') return ['Story', 'Gameplay'];
    if (url === '/projects/test/batches/batch' && options) {
      const edit = options.body;
      state.batches[0].clips[0] = { ...state.batches[0].clips[0], ...edit.clips[0] };
      state.batches[0].revision++;
      return structuredClone(state.batches[0]);
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  const refresh = vi.fn(async () => undefined);
  const router = createMemoryRouter(
    [
      {
        path: '/projects/:projectId/batches/:batchId',
        element: <Review refreshProjects={refresh} />,
      },
    ],
    { initialEntries: ['/projects/test/batches/batch'] },
  );
  render(<RouterProvider router={router} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Details for clip 001' }));
  await user.click(screen.getByRole('button', { name: 'Reset suggestion' }));
  if (
    screen.getByRole('button', { name: 'Details for clip 001' }).getAttribute('aria-expanded') ===
    'false'
  )
    await user.click(screen.getByRole('button', { name: 'Details for clip 001' }));
  expect((screen.getByRole('textbox', { name: 'Your note' }) as HTMLTextAreaElement).value).toBe(
    'Check this with the agent before filing.',
  );
  expect(
    (screen.getByRole('checkbox', { name: 'Hold for review' }) as HTMLInputElement).checked,
  ).toBe(true);
  await waitFor(() => expect(state.batches[0].revision).toBe(2), { timeout: 2500 });
  expect(state.batches[0].clips[0]).toMatchObject({
    proposed: original.proposed,
    held: true,
    note: 'Check this with the agent before filing.',
  });
});
