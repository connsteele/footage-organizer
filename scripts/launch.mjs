import { readFile, mkdir, open, appendFile, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let dataDir;
try {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12))
    throw new Error(
      'Footage Organizer needs Node 22.12 or newer. Update Node and run npm run shortcut again.',
    );
  let local = {};
  try {
    local = JSON.parse(await readFile(path.join(root, 'organizer.local.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT')
      throw new Error(`Cannot read organizer.local.json: ${error.message}`);
  }
  const port = Number(process.env.PORT || local.port || 4317);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('Invalid app port. Choose a port from 1024 to 65535 in organizer.local.json.');
  dataDir =
    process.env.FO_DATA_DIR || local.dataDir || path.join(os.homedir(), 'Footage Organizer');
  const tempDir = process.env.FO_TEMP_DIR || local.tempDir || os.tmpdir();
  const url = `http://127.0.0.1:${port}`;
  await mkdir(dataDir, { recursive: true });
  await mkdir(tempDir, { recursive: true });
  async function health() {
    let response;
    try {
      response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
    } catch (error) {
      if (error.cause?.code === 'ECONNREFUSED') return false;
      throw new Error(`Could not check the app at ${url}: ${error.message}`);
    }
    const value = await response.json().catch(() => null);
    if (!response.ok || value?.app !== 'footage-organizer')
      throw new Error(`Port ${port} is occupied by an unexpected or unresponsive program.`);
    return true;
  }
  if (!(await health())) {
    const entry = path.join(root, 'dist/server/server/index.js');
    try {
      await access(entry);
      await access(path.join(root, 'dist/client/index.html'));
    } catch {
      throw new Error(`The app has not been built. Run npm ci and npm run build in ${root}.`);
    }
    const logPath = path.join(dataDir, 'server.log');
    const log = await open(logPath, 'a');
    let child;
    try {
      child = spawn(process.execPath, [entry], {
        cwd: root,
        detached: true,
        windowsHide: true,
        stdio: ['ignore', log.fd, log.fd],
        env: { ...process.env, TEMP: tempDir, TMP: tempDir },
      });
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      child.unref();
    } finally {
      await log.close();
    }
    const deadline = Date.now() + 15000;
    let ready = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) break;
      if (await health()) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!ready) throw new Error(`The app did not start. Check ${logPath} for details.`);
  }
  if (!process.argv.includes('--no-open')) {
    try {
      await promisify(execFile)(
        path.join(
          process.env.SystemRoot || 'C:/Windows',
          'System32/WindowsPowerShell/v1.0/powershell.exe',
        ),
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.join(root, 'scripts/open-browser.ps1'),
        ],
        {
          windowsHide: true,
          timeout: 10000,
          env: { ...process.env, FO_APP_URL: url, TEMP: tempDir, TMP: tempDir },
        },
      );
    } catch (error) {
      throw new Error(
        `The app is running, but the browser could not open. Open ${url} manually.\n${error.stderr || error.message}`,
      );
    }
  }
  console.log(`Footage Organizer is ready at ${url}`);
} catch (error) {
  if (dataDir) {
    await appendFile(
      path.join(dataDir, 'startup.log'),
      `${new Date().toISOString()} ${error.stack}\n`,
    ).catch(() => undefined);
  }
  console.error(error.message);
  process.exitCode = 1;
}
