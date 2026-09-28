import path from 'node:path';
import os from 'node:os';
import { readFile, mkdir } from 'node:fs/promises';
import { errorCode } from './paths.js';
export interface Config {
  dataDir: string;
  tempDir: string;
  port: number;
  ffprobePath?: string;
  ffmpegPath?: string;
}
export async function loadConfig(): Promise<Config> {
  let local: Partial<Config> = {};
  try {
    local = JSON.parse(await readFile(path.resolve('organizer.local.json'), 'utf8'));
  } catch (e) {
    if (errorCode(e) !== 'ENOENT') throw e;
  }
  const config = {
    dataDir:
      process.env.FO_DATA_DIR || local.dataDir || path.join(os.homedir(), 'Footage Organizer'),
    tempDir: process.env.FO_TEMP_DIR || local.tempDir || os.tmpdir(),
    port: Number(process.env.PORT || local.port || 4317),
    ffprobePath: process.env.FFPROBE_PATH || local.ffprobePath || 'ffprobe',
    ffmpegPath:
      process.env.FFMPEG_PATH ||
      local.ffmpegPath ||
      (local.ffprobePath && path.isAbsolute(local.ffprobePath)
        ? path.join(path.dirname(local.ffprobePath), 'ffmpeg.exe')
        : 'ffmpeg'),
  };
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535)
    throw new Error('Invalid server port.');
  await mkdir(config.tempDir, { recursive: true });
  process.env.TEMP = config.tempDir;
  process.env.TMP = config.tempDir;
  return config;
}
