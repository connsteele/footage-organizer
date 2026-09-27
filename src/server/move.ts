import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AppError } from './paths.js';
const run = promisify(execFile);
// The two-argument .NET File.Move refuses an existing target. Paths are data in
// child-process environment variables, never interpolated into shell commands.
const script =
  "$ErrorActionPreference='Stop'; try { [System.IO.File]::Move($env:FO_MOVE_SOURCE, $env:FO_MOVE_TARGET) } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }";
export async function moveWithoutReplacement(source: string, target: string) {
  if (process.platform !== 'win32')
    throw new AppError('The verified move implementation currently requires Windows.');
  await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    {
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 64 * 1024,
      env: { ...process.env, FO_MOVE_SOURCE: source, FO_MOVE_TARGET: target },
    },
  );
}
export async function openMedia(file: string) {
  if (process.platform !== 'win32')
    throw new AppError('Open in player currently requires Windows.');
  const code =
    "$ErrorActionPreference='Stop'; $p = New-Object System.Diagnostics.ProcessStartInfo; $p.FileName = $env:FO_MEDIA_FILE; $p.UseShellExecute = $true; [System.Diagnostics.Process]::Start($p) | Out-Null";
  await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(code, 'utf16le').toString('base64'),
    ],
    {
      windowsHide: true,
      env: { ...process.env, FO_MEDIA_FILE: file },
      timeout: 15000,
    },
  );
}
