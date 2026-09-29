// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
beforeEach(() => {
  vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

function renderReview(configure?: (state: ProjectState) => void) {
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
  configure?.(state);
  mockApi.mockImplementation(async (url: string, options?: { body: BatchEdit }) => {
    if (url === '/projects/test') return structuredClone(state);
    if (url === '/projects/test/folders') return ['Story', 'Gameplay'];
    if (url === '/projects/test/batches/batch' && options) {
      const edit = options.body;
      state.batches[0].clips = state.batches[0].clips.map((clip) => ({
        ...clip,
        ...edit.clips.find((change) => change.id === clip.id),
      }));
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
  return { state, original };
}

it('resets a suggestion without erasing the user note or releasing a user-held clip', async () => {
  const { state, original } = renderReview();
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

it('tracks whole-clip review independently of holds and supports filters and saved undo/redo', async () => {
  const { state } = renderReview();
  const user = userEvent.setup();
  const button = await screen.findByRole('button', { name: 'Reviewed clip 001' });
  expect(button.getAttribute('aria-pressed')).toBe('false');
  expect(button.textContent).toBe('Needs review');
  await user.click(button);
  expect(screen.queryByRole('button', { name: 'Reviewed clip 001' })).toBeNull();
  expect(screen.getByText('1 of 1 clips reviewed')).toBeTruthy();
  await waitFor(() => expect(state.batches[0].clips[0].reviewed).toBe(true), { timeout: 2500 });
  expect(state.batches[0].clips[0].held).toBe(true);
  expect(state.batches[0].clips[0].applied).toBe(false);
  expect(screen.getByRole('button', { name: 'Move queue 0' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Held 1' }));
  expect(screen.getByRole('button', { name: 'Reviewed clip 001' }).textContent).toBe('Reviewed');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Review status' }), 'unreviewed');
  expect(screen.queryByRole('button', { name: 'Reviewed clip 001' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Undo edit' }));
  await waitFor(() => expect(state.batches[0].clips[0].reviewed).toBe(false), { timeout: 2500 });
  expect(screen.getByRole('button', { name: 'Reviewed clip 001' }).textContent).toBe(
    'Needs review',
  );
  await user.click(screen.getByRole('button', { name: 'Redo edit' }));
  await waitFor(() => expect(state.batches[0].clips[0].reviewed).toBe(true), { timeout: 2500 });
  await user.selectOptions(screen.getByRole('combobox', { name: 'Review status' }), 'reviewed');
  expect(
    screen.getByRole('button', { name: 'Reviewed clip 001' }).getAttribute('aria-pressed'),
  ).toBe('true');
});

it('keeps invalid folders out of the draft and lets the user correct the open form', async () => {
  const { state } = renderReview();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Folder' }));
  const field = screen.getByRole('textbox', { name: 'Folder path' });
  for (const name of ['CON', 'Parent/Bad.', 'Parent//Child', 'A'.repeat(256)]) {
    await user.clear(field);
    await user.paste(name);
    await user.click(screen.getByRole('button', { name: 'Add folder' }));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('All changes saved')).toBeTruthy();
    expect(state.batches[0].folders).toEqual(['Story', 'Gameplay']);
  }
  await user.clear(field);
  await user.paste('Reviewed/Nested');
  await user.click(screen.getByRole('button', { name: 'Add folder' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() => expect(state.batches[0].revision).toBe(2), { timeout: 2500 });
  const edit = mockApi.mock.calls.find(([, options]) => options?.method === 'PUT')![1].body;
  expect(edit.folders).toContain('Reviewed/Nested');
});

it('works down Remaining into the queue, preserves holds and unchanged clips, and counts pending names', async () => {
  const { state } = renderReview((data) => {
    const first = data.batches[0].clips[0];
    first.held = false;
    first.original.markers = [{ id: 'event', seconds: 1, label: 'Original event' }];
    first.markerDecisions = [{ markerId: 'event', label: 'Clear event', status: 'pending' }];
    data.batches[0].clips = [
      first,
      ...[2, 3, 4].map((id) => ({
        ...structuredClone(first),
        id,
        held: id === 2,
        applied: id === 4,
        reviewed: id === 4,
        markerDecisions: [],
        proposed: id === 3 ? { folder: 'Incoming', filename: 'Clip.mp4' } : first.proposed,
      })),
    ];
  });
  const user = userEvent.setup();
  await screen.findByRole('button', { name: 'Remaining 3' });
  expect(
    (screen.getByRole('button', { name: 'Move clips · 0' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByText('1 marker to review')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Details for clip 001' }));
  await user.click(screen.getByRole('button', { name: 'Accept name for marker event' }));
  expect(screen.queryByText('1 marker to review')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Reviewed clip 001' }));
  expect(screen.queryByRole('button', { name: 'Reviewed clip 001' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Remaining 2' })).toBeTruthy();
  await waitFor(() => expect(state.batches[0].clips[0].reviewed).toBe(true), { timeout: 2500 });
  await user.click(screen.getByRole('button', { name: 'Move queue 1' }));
  await user.click(screen.getByRole('button', { name: 'Reviewed clip 001' }));
  expect(screen.queryByRole('button', { name: 'Reviewed clip 001' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Undo edit' }));
  expect(screen.getByRole('button', { name: 'Reviewed clip 001' }).textContent).toBe('Reviewed');
  await user.click(screen.getByRole('button', { name: 'Remaining 2' }));
  await user.click(screen.getByRole('button', { name: 'Reviewed clip 003' }));
  await user.click(screen.getByRole('button', { name: 'Reviewed clip 002' }));
  expect(screen.getByText('No clips left to review')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Held 1' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Move queue 2' }));
  expect(screen.getByText(/1 already in place; no file changes needed/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Reviewed clip 002' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Reviewed clip 004' })).toBeNull();
  await user.type(screen.getByRole('textbox', { name: 'Search clips' }), 'no match');
  expect(screen.getByText('No matching clips in this view')).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: 'Move clips · 1' }) as HTMLButtonElement).disabled,
  ).toBe(false);
  await user.clear(screen.getByRole('textbox', { name: 'Search clips' }));
  await user.click(screen.getByRole('button', { name: 'All 4' }));
  await user.selectOptions(screen.getByRole('combobox', { name: 'Review status' }), 'reviewed');
  expect(screen.getAllByRole('button', { name: /^Reviewed clip/ })).toHaveLength(4);
  await user.selectOptions(screen.getByRole('combobox', { name: 'Review status' }), 'unreviewed');
  expect(screen.queryByRole('button', { name: /^Reviewed clip/ })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Move queue 2' }));
  expect(screen.queryByRole('combobox', { name: 'Review status' })).toBeNull();
  expect(screen.getAllByRole('button', { name: /^Reviewed clip/ })).toHaveLength(2);
  await waitFor(() => expect(state.batches[0].clips.every((c) => c.reviewed)).toBe(true), {
    timeout: 2500,
  });
  expect(state.batches[0].clips[1].held).toBe(true);
  expect(state.operations).toEqual([]);
});
