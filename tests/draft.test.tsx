// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useDraft } from '../src/client/useDraft';
import { saveBeforeStop } from '../src/client/lifecycle';
import type { Batch } from '../src/shared/model';
const apiMock = vi.hoisted(() => vi.fn());
vi.mock('../src/client/api', () => ({ api: apiMock, errorText: (e: Error) => e.message }));
const initial: Batch = {
  id: 'batch',
  handoffId: 'handoff',
  title: 'Test',
  revision: 1,
  importedAt: '',
  folders: [],
  notes: '',
  reviewNotes: '',
  clips: [],
};
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it('serializes edits made during a save and uses the returned revision', async () => {
  let complete!: (batch: Batch) => void;
  apiMock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  apiMock.mockResolvedValueOnce({ ...initial, revision: 3, notes: 'Second edit' });
  const { result } = renderHook(() => useDraft('project', initial));
  act(() =>
    result.current.change((b) => {
      b.notes = 'First edit';
    }),
  );
  let saving!: Promise<void>;
  act(() => {
    saving = result.current.flush();
  });
  act(() =>
    result.current.change((b) => {
      b.notes = 'Second edit';
    }),
  );
  await act(async () => {
    complete({ ...initial, revision: 2, notes: 'First edit' });
    await saving;
  });
  expect(apiMock.mock.calls[1][1].body).toMatchObject({ notes: 'Second edit', revision: 2 });
  expect(result.current.batch.notes).toBe('Second edit');
  expect(result.current.status).toBe('saved');
});
it('keeps unsaved edits when the server reports a conflict', async () => {
  apiMock.mockRejectedValue(new Error('Changed in another tab'));
  const { result } = renderHook(() => useDraft('project', initial));
  act(() =>
    result.current.change((b) => {
      b.notes = 'My local decision';
    }),
  );
  await act(async () => {
    await expect(result.current.flush()).rejects.toThrow('another tab');
  });
  await waitFor(() => expect(result.current.status).toBe('error'));
  expect(result.current.batch.notes).toBe('My local decision');
});
it('flushes the latest pending edit before allowing shutdown', async () => {
  let complete!: (batch: Batch) => void;
  apiMock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const { result } = renderHook(() => useDraft('project', initial));
  act(() =>
    result.current.change((b) => {
      b.notes = 'Last edit before stopping';
    }),
  );
  let stopping!: Promise<void>;
  let ready = false;
  act(() => {
    stopping = saveBeforeStop().then(() => {
      ready = true;
    });
  });
  expect(ready).toBe(false);
  expect(apiMock.mock.calls[0][1].body.notes).toBe('Last edit before stopping');
  await act(async () => {
    complete({ ...initial, revision: 2 });
    await stopping;
  });
  expect(ready).toBe(true);
  expect(result.current.status).toBe('saved');
});
it('blocks shutdown when pending edits cannot be saved and unregisters closed drafts', async () => {
  apiMock.mockRejectedValue(new Error('Save failed'));
  const { result, unmount } = renderHook(() => useDraft('project', initial));
  act(() =>
    result.current.change((b) => {
      b.notes = 'Keep this edit';
    }),
  );
  await act(async () => {
    await expect(saveBeforeStop()).rejects.toThrow('Save failed');
  });
  expect(result.current.batch.notes).toBe('Keep this edit');
  unmount();
  await expect(saveBeforeStop()).resolves.toBeUndefined();
  expect(apiMock).toHaveBeenCalledTimes(1);
});
