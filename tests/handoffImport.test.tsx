// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HandoffGuide } from '../src/client/HandoffGuide';
import type { ProjectSummary } from '../src/shared/model';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('../src/client/api', () => ({ api: apiMock, errorText: (e: Error) => e.message }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function setup(project = true) {
  const refresh = vi.fn().mockResolvedValue(undefined);
  const projects = project
    ? [
        {
          id: 'test',
          name: 'Test',
          mediaRoot: 'D:/Media',
          reviewFolder: 'Review',
          batches: [],
        } as unknown as ProjectSummary,
      ]
    : [];
  render(
    <MemoryRouter initialEntries={[project ? '/projects/test/next-batch' : '/handoff-guide']}>
      <Routes>
        <Route
          path="/projects/:projectId/next-batch"
          element={<HandoffGuide projects={projects} refresh={refresh} nextBatch />}
        />
        <Route
          path="/handoff-guide"
          element={<HandoffGuide projects={projects} refresh={refresh} />}
        />
        <Route path="/projects/test/batches/new" element={<p>Imported batch</p>} />
      </Routes>
    </MemoryRouter>,
  );
  return { refresh, drop: screen.getByRole('region', { name: 'Drop reviewed handoff' }) };
}
function file(text = '{"batchId":"new"}') {
  return Object.assign(new File([text], 'handoff.json', { type: 'application/json' }), {
    text: vi.fn().mockResolvedValue(text),
  });
}
function drop(target: HTMLElement, files: File[]) {
  fireEvent.drop(target, { dataTransfer: { files, types: ['Files'] } });
}
it('imports a dropped handoff into the selected project with its review folder', async () => {
  apiMock.mockResolvedValue({ id: 'new' });
  const { drop: area, refresh } = setup();
  drop(area, [file()]);
  await screen.findByText('Imported batch');
  expect(apiMock).toHaveBeenCalledWith('/projects/test/import', {
    method: 'POST',
    body: { batchId: 'new', reviewFolder: 'D:/Media/Review' },
  });
  expect(refresh).toHaveBeenCalledOnce();
});
it('keeps file selection working with the same import path', async () => {
  apiMock.mockResolvedValue({ id: 'new' });
  setup();
  await userEvent.upload(screen.getByLabelText('Reviewed handoff JSON'), file());
  await screen.findByText('Imported batch');
  expect(apiMock).toHaveBeenCalledOnce();
});
it('refuses multiple files and disabled drops, and allows correcting a malformed handoff', async () => {
  const { drop: area } = setup();
  drop(area, [file(), file()]);
  expect(screen.getByRole('alert').textContent).toContain('one reviewed handoff');
  expect(apiMock).not.toHaveBeenCalled();
  drop(area, [file('not json')]);
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).not.toContain('one reviewed handoff'),
  );
  expect(apiMock).not.toHaveBeenCalled();
  apiMock.mockResolvedValue({ id: 'new' });
  drop(area, [file()]);
  await screen.findByText('Imported batch');
  cleanup();
  const empty = setup(false);
  drop(empty.drop, [file()]);
  expect(apiMock).toHaveBeenCalledOnce();
});
it('prevents overlapping imports even before the importing state renders', async () => {
  const { drop: area } = setup();
  let resolve!: (text: string) => void;
  const pending = file();
  pending.text.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  act(() => {
    drop(area, [pending]);
    drop(area, [file()]);
  });
  expect(apiMock).not.toHaveBeenCalled();
  apiMock.mockResolvedValue({ id: 'new' });
  await act(async () => resolve('{"batchId":"new"}'));
  await screen.findByText('Imported batch');
  expect(apiMock).toHaveBeenCalledOnce();
});
