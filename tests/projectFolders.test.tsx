// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Dashboard } from '../src/client/Dashboard';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('../src/client/api', () => ({ api: apiMock, errorText: (e: Error) => e.message }));
vi.mock('../src/client/Modal', () => ({
  Modal: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

async function startProject() {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <Dashboard projects={[]} refresh={async () => {}} />
    </MemoryRouter>,
  );
  await user.click(screen.getByRole('button', { name: 'New project' }));
  return user;
}

it('allows Review Footage to be browsed first without changing Root Footage', async () => {
  const user = await startProject();
  apiMock.mockResolvedValueOnce({ path: 'D:/Library/Review' });
  await user.click(screen.getByRole('button', { name: 'Browse Review Footage' }));
  expect(apiMock).toHaveBeenLastCalledWith('/browse-folder', {
    method: 'POST',
    body: { initialPath: '' },
  });
  expect((screen.getByLabelText('Review Footage') as HTMLInputElement).value).toBe(
    'D:/Library/Review',
  );
  expect((screen.getByLabelText('Root Footage') as HTMLInputElement).value).toBe('');
});

it('starts Review Footage in Root Footage when set and leaves paths unchanged on cancel', async () => {
  const user = await startProject();
  await user.type(screen.getByLabelText('Root Footage'), 'D:/Library');
  apiMock.mockResolvedValueOnce({ path: null });
  await user.click(screen.getByRole('button', { name: 'Browse Review Footage' }));
  expect(apiMock).toHaveBeenLastCalledWith('/browse-folder', {
    method: 'POST',
    body: { initialPath: 'D:/Library' },
  });
  expect((screen.getByLabelText('Review Footage') as HTMLInputElement).value).toBe('');
  apiMock.mockResolvedValueOnce({ path: 'D:/Library/Review' });
  await user.click(screen.getByRole('button', { name: 'Browse Review Footage' }));
  expect((screen.getByLabelText('Review Footage') as HTMLInputElement).value).toBe(
    'D:/Library/Review',
  );
});

it('shows a picker error and makes Browse available for another attempt', async () => {
  const user = await startProject();
  apiMock.mockRejectedValueOnce(new Error('The Windows folder picker did not finish.'));
  await user.click(screen.getByRole('button', { name: 'Browse Review Footage' }));
  expect(screen.getByRole('alert').textContent).toContain('folder picker did not finish');
  apiMock.mockResolvedValueOnce({ path: 'D:/Library/Review' });
  await user.click(screen.getByRole('button', { name: 'Browse Review Footage' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect((screen.getByLabelText('Review Footage') as HTMLInputElement).value).toBe(
    'D:/Library/Review',
  );
});
