import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { AppError, canonicalRoot } from './paths.js';
const exec = promisify(execFile);
let choosing = false;

async function startingFolder(initialPath: string) {
  // An empty/default Desktop selection can stall the Windows shell folder tree.
  // Always give the dialog an existing, absolute directory to open instead.
  for (const candidate of [initialPath.trim(), homedir(), path.parse(process.cwd()).root]) {
    if (!path.isAbsolute(candidate)) continue;
    try {
      if ((await stat(candidate)).isDirectory()) return path.resolve(candidate);
    } catch {
      // A pasted path may not exist yet; browsing must still work.
    }
  }
  throw new AppError('No starting folder is available. Paste a folder path instead.');
}

export async function chooseFolder(initialPath = ''): Promise<string | null> {
  if (process.platform !== 'win32')
    throw new AppError('Folder browsing is available on Windows. Paste a folder path instead.');
  if (choosing)
    throw new AppError('A folder picker is already open. Complete or cancel it first.', 409);
  choosing = true;
  try {
    const initialFolder = await startingFolder(initialPath);
    const { stdout } = await exec(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-STA',
        '-Command',
        `
      $ErrorActionPreference = 'Stop'
      Add-Type -AssemblyName System.Windows.Forms
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      [System.Windows.Forms.Application]::EnableVisualStyles()
      $picker = New-Object System.Windows.Forms.FolderBrowserDialog
      $owner = New-Object System.Windows.Forms.Form
      try {
        $picker.Description = 'Choose a folder for Footage Organizer'
        $picker.ShowNewFolderButton = $false
        $picker.SelectedPath = $env:FO_PICKER_INITIAL
        $owner.Text = 'Footage Organizer'
        $owner.ShowInTaskbar = $false
        $owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
        $owner.Size = New-Object System.Drawing.Size(1, 1)
        $owner.Opacity = 0
        $owner.TopMost = $true
        $owner.Show()
        $owner.Activate()
        if ($picker.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($picker.SelectedPath) }
      } finally {
        $picker.Dispose()
        $owner.Dispose()
      }
    `,
      ],
      {
        windowsHide: true,
        timeout: 300000,
        maxBuffer: 16384,
        env: { ...process.env, FO_PICKER_INITIAL: initialFolder },
      },
    ).catch(() => {
      throw new AppError(
        'The Windows folder picker did not finish. Try again or paste a folder path.',
      );
    });
    const selected = stdout.replace(/^\uFEFF/, '').trim();
    return selected ? await canonicalRoot(selected) : null;
  } finally {
    choosing = false;
  }
}
