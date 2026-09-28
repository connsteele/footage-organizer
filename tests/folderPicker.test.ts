import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chooseFolder } from '../src/server/folderPicker';

const { execMock, home } = vi.hoisted(() => ({ execMock: vi.fn(), home: { path: '' } }));
vi.mock('node:child_process', () => ({
  execFile: Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: execMock,
  }),
}));
vi.mock('node:os', async (original) => ({
  ...(await original<typeof import('node:os')>()),
  homedir: () => home.path,
}));

describe.skipIf(process.platform !== 'win32')('Windows folder picker', () => {
  let root: string;
  let selected: string;
  beforeAll(async () => {
    const scratch = process.env.FO_TEST_DIR || tmpdir();
    await mkdir(scratch, { recursive: true });
    root = await mkdtemp(path.join(scratch, 'folder-picker-'));
    home.path = path.join(root, 'Home');
    selected = path.join(root, "Review [clips] ' & café");
    await mkdir(home.path);
    await mkdir(selected);
    await writeFile(path.join(root, 'file.txt'), 'not a folder');
  });
  afterEach(() => execMock.mockReset());
  afterAll(() => rm(root, { recursive: true, force: true }));

  it.each(['', '   ', 'missing', 'file'])(
    'opens a usable folder for %j initial input',
    async (input) => {
      execMock.mockResolvedValue({ stdout: '' });
      const initial =
        input === 'missing'
          ? path.join(root, 'missing')
          : input === 'file'
            ? path.join(root, 'file.txt')
            : input;
      expect(await chooseFolder(initial)).toBeNull();
      expect(execMock.mock.calls[0][2]).toMatchObject({
        windowsHide: true,
        env: { FO_PICKER_INITIAL: home.path },
      });
    },
  );

  it('keeps special characters as path data and returns the selected directory', async () => {
    execMock.mockResolvedValue({ stdout: `\uFEFF${selected}\r\n` });
    expect(await chooseFolder(`  ${selected}  `)).toBe(selected);
    const [program, args, options] = execMock.mock.calls[0];
    expect(program).toBe('powershell.exe');
    expect(args).toContain('-STA');
    expect(args).toContain('-NonInteractive');
    expect(args.join(' ')).not.toContain(selected);
    expect(options.env.FO_PICKER_INITIAL).toBe(selected);
  });

  it('falls back to a local drive if the user folder is unavailable', async () => {
    const originalHome = home.path;
    home.path = path.join(root, 'missing-home');
    execMock.mockResolvedValue({ stdout: '' });
    try {
      expect(await chooseFolder()).toBeNull();
      expect(execMock.mock.calls[0][2].env.FO_PICKER_INITIAL).toBe(path.parse(process.cwd()).root);
    } finally {
      home.path = originalHome;
    }
  });

  it('blocks duplicate dialogs and allows browsing again after cancellation', async () => {
    let finish!: (result: { stdout: string }) => void;
    execMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = chooseFolder();
    await vi.waitFor(() => expect(execMock).toHaveBeenCalledOnce());
    try {
      await expect(chooseFolder()).rejects.toMatchObject({ status: 409 });
    } finally {
      finish({ stdout: '' });
    }
    expect(await pending).toBeNull();
    execMock.mockResolvedValueOnce({ stdout: selected });
    expect(await chooseFolder()).toBe(selected);
  });

  it('allows retry after a failed or timed-out helper', async () => {
    execMock.mockRejectedValueOnce(new Error('helper timed out'));
    await expect(chooseFolder()).rejects.toThrow('folder picker did not finish');
    execMock.mockResolvedValueOnce({ stdout: selected });
    expect(await chooseFolder()).toBe(selected);
  });
});
