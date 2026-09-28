import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { handoffSchema } from '../src/shared/model.js';
import { filenameProblem, relativePath } from '../src/server/paths.js';
import { validateMarkerProposals } from '../src/shared/markers.js';

export function validateHandoff(input: unknown) {
  const handoff = handoffSchema.parse(input);
  const ids = new Set<number>();
  const sources = new Set<string>();
  const reviewFolder =
    handoff.reviewFolder === undefined
      ? undefined
      : relativePath(handoff.reviewFolder, true).toLowerCase();
  for (const folder of handoff.folders) relativePath(folder, true);
  for (const clip of handoff.clips) {
    validateMarkerProposals(clip.markers, clip.markerProposals);
    if (ids.has(clip.id)) throw new Error(`Duplicate clip ID: ${clip.id}`);
    ids.add(clip.id);
    const source = relativePath(clip.source.relativePath);
    const key = source.toLowerCase();
    if (reviewFolder && !key.startsWith(`${reviewFolder}/`))
      throw new Error(`Clip ${clip.id}: source is outside Review Footage.`);
    if (sources.has(key)) throw new Error(`Duplicate source path: ${source}`);
    sources.add(key);
    relativePath(clip.proposed.folder, true);
    const problem = filenameProblem(clip.proposed.filename);
    if (problem) throw new Error(`Clip ${clip.id}: ${problem}`);
    if (path.extname(source).toLowerCase() !== path.extname(clip.proposed.filename).toLowerCase())
      throw new Error(`Clip ${clip.id}: preserve the original file extension.`);
  }
  return handoff;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const file = process.argv[2];
    if (!file) throw new Error('Usage: npm run validate:handoff -- path/to/handoff.json');
    const contents = await readFile(file);
    if (contents.byteLength >= 8 * 1024 * 1024) throw new Error('Keep the handoff below 8 MB.');
    const handoff = validateHandoff(JSON.parse(contents.toString('utf8')));
    console.log(
      `Valid handoff format: ${handoff.clips.length} clips for project ${handoff.projectId}.`,
    );
    console.log(
      'No files changed. Import and move review still check current files, catalog IDs, and destination conflicts.',
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
