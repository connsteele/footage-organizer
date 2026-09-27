import { readFile, mkdir, open, appendFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let local = {};
try {
  local = JSON.parse(await readFile(path.join(root, 'organizer.local.json'), 'utf8'));
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const port = Number(process.env.PORT || local.port || 4317);
const dataDir =
  process.env.FO_DATA_DIR || local.dataDir || path.join(os.homedir(), 'Footage Organizer');
const url = `http://127.0.0.1:${port}`;
await mkdir(dataDir, { recursive: true });
async function health() {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
    const value = await response.json().catch(() => null);
    if (value?.app !== 'footage-organizer')
      throw new Error(`Port ${port} belongs to another program.`);
    return true;
  } catch (e) {
    if (e.message.includes('belongs to')) throw e;
    return false;
  }
}
try {
  if (!(await health())) {
    const log = await open(path.join(dataDir, 'server.log'), 'a');
    const child = spawn(process.execPath, [path.join(root, 'dist/server/server/index.js')], {
      cwd: root,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', log.fd, log.fd],
      env: {
        ...process.env,
        TEMP: local.tempDir || process.env.TEMP,
        TMP: local.tempDir || process.env.TMP,
      },
    });
    child.unref();
    await log.close();
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (await health()) {
        ready = true;
        break;
      }
    }
    if (!ready)
      throw new Error(
        `The app did not start. Check ${path.join(dataDir, 'server.log')}. Build it with npm run build first.`,
      );
  }
  if (!process.argv.includes('--no-open')) {
    const script =
      '$p = New-Object System.Diagnostics.ProcessStartInfo; $p.FileName=$env:FO_APP_URL; $p.UseShellExecute=$true; [System.Diagnostics.Process]::Start($p) | Out-Null';
    const browser = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      { windowsHide: true, stdio: 'ignore', env: { ...process.env, FO_APP_URL: url } },
    );
    browser.unref();
  }
  console.log(`Footage Organizer is ready at ${url}`);
} catch (e) {
  await appendFile(path.join(dataDir, 'startup.log'), `${new Date().toISOString()} ${e.stack}\n`);
  console.error(e.message);
  process.exitCode = 1;
}
