import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AppError, canonicalRoot } from './paths.js';
const exec = promisify(execFile);
let choosing = false;
export async function chooseFolder(initialPath = ''): Promise<string | null> {
  if (process.platform !== 'win32')
    throw new AppError('Folder browsing is available on Windows. Paste a folder path instead.');
  if (choosing)
    throw new AppError('A folder picker is already open. Complete or cancel it first.', 409);
  choosing = true;
  try {
    const { stdout } = await exec(
      'powershell.exe',
      [
        '-NoProfile',
        '-STA',
        '-WindowStyle',
        'Hidden',
        '-Command',
        `
      Add-Type -AssemblyName System.Windows.Forms
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
      $picker = New-Object System.Windows.Forms.FolderBrowserDialog
        try {
        $picker.Description = 'Choose a folder for Footage Organizer'
        $picker.ShowNewFolderButton = $false
        if ($env:FO_PICKER_INITIAL -and (Test-Path -LiteralPath $env:FO_PICKER_INITIAL -PathType Container)) { $picker.SelectedPath = $env:FO_PICKER_INITIAL }
          if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($picker.SelectedPath) }
        } finally { $picker.Dispose() }
    `,
      ],
      {
        windowsHide: false,
        timeout: 300000,
        maxBuffer: 16384,
        env: { ...process.env, FO_PICKER_INITIAL: initialPath },
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
