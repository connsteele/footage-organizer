import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { handoffSchema } from '../src/shared/model.js';
const [proposalFile, inventoryFile, mediaRoot, projectId, outputFile, notesFile] =
  process.argv.slice(2);
if (!proposalFile || !inventoryFile || !mediaRoot || !projectId || !outputFile) {
  console.error(
    'Usage: npm run convert:legacy -- proposal.json inventory.json "media root" project-id output.json [notes.md]',
  );
  process.exit(1);
}
interface LegacyProposal {
  id: number;
  current: string;
  proposed: string;
  folder: string;
  note: string;
  seconds: number;
}
interface LegacyInventory {
  Id: number;
  Name: string;
  Path: string;
  Seconds: number;
  Bytes: number;
  Chapters?: { start_time?: string; tags?: { title?: string } }[];
}
const proposals: LegacyProposal[] = JSON.parse(
  (await readFile(proposalFile, 'utf8')).replace(/^\uFEFF/, ''),
);
const inventory: LegacyInventory[] = JSON.parse(
  (await readFile(inventoryFile, 'utf8')).replace(/^\uFEFF/, ''),
);
const batchId = path.basename(outputFile, '.json').replace(/[^a-zA-Z0-9_-]/g, '-');
const handoff = handoffSchema.parse({
  schemaVersion: 1,
  handoffId: `${batchId}-handoff`,
  projectId,
  batchId,
  title: 'Cut clip placement review',
  createdAt: new Date().toISOString(),
  reviewNotes: `Converted from the original placement proposal. Modification times were not captured during that review; import records current file identity.\n\n${notesFile ? await readFile(notesFile, 'utf8') : ''}`,
  clips: proposals.map((clip) => {
    const source = inventory.find((i) => i.Id === clip.id);
    if (!source || source.Name !== clip.current)
      throw new Error(`No matching source inventory for clip ${clip.id}`);
    const relativePath = path.relative(mediaRoot, source.Path).replaceAll('\\', '/');
    if (relativePath.startsWith('../') || path.isAbsolute(relativePath))
      throw new Error(`Clip ${clip.id} is outside the media root`);
    return {
      id: clip.id,
      source: { relativePath, size: source.Bytes },
      duration: source.Seconds,
      proposed: {
        filename: clip.proposed === 'Keep unchanged' ? source.Name : clip.proposed,
        folder: clip.folder.replaceAll('\\', '/'),
      },
      rationale: clip.note,
      questions: /chapter unconfirmed|chapter.*unverified|chapter.*unspecified/i.test(clip.note)
        ? [clip.note]
        : [],
      markers: (source.Chapters || []).map((m) => ({
        seconds: Number(m.start_time || 0),
        label: m.tags?.title || 'Marker',
      })),
    };
  }),
});
await writeFile(outputFile, JSON.stringify(handoff, null, 2) + '\n', { flag: 'wx' });
console.log(`Converted ${handoff.clips.length} clips with their original IDs to ${outputFile}`);
