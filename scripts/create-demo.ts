import path from 'node:path';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig } from '../src/server/config.js';
import { Organizer } from '../src/server/service.js';
import { Store } from '../src/server/store.js';
import { exists, fingerprint } from '../src/server/paths.js';
import type { Handoff } from '../src/shared/model.js';

const run = promisify(execFile);
const config = await loadConfig();
const root = process.env.FO_DEMO_DIR || path.join(config.dataDir, '..', 'practice');
const media = path.resolve(root, 'Video');
const plans = path.resolve(root, 'Plans');
const store = new Store(config.dataDir);
const service = new Organizer(store);
try {
  await service.initialize();
  if ((await store.registry()).some((p) => p.id === 'practice')) {
    console.log('Practice project already exists; its edits and files were preserved.');
  } else {
    await mkdir(path.join(media, '_cut'), { recursive: true });
    const sample = path.join(root, 'sample.mp4');
    if (!(await exists(sample))) {
      const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
      await run(
        ffmpeg,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'testsrc2=size=640x360:rate=24',
          '-t',
          '2',
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-movflags',
          '+faststart',
          '-n',
          sample,
        ],
        { windowsHide: true, env: { ...process.env, TEMP: config.tempDir, TMP: config.tempDir } },
      );
    }
    const definitions = [
      [
        'Establishing shot',
        'Story/Opening',
        'Sets up the opening scene. Keep the wide shot with the introduction.',
      ],
      [
        'Character entrance',
        'Story/Opening',
        'The character introduction belongs beside the opening sequence.',
      ],
      [
        'Exploration sequence',
        'Gameplay/Exploration',
        'A general example of traversal and exploration.',
      ],
      ['Combat demonstration', 'Gameplay/Combat', 'Shows the battle system in action.'],
      [
        'Menu walkthrough',
        'Presentation/Interface',
        'A useful reference for the interface discussion.',
      ],
      [
        'Unidentified scene',
        'Story/Opening',
        'A practice example of a clip that needs another look.',
      ],
    ];
    const clips: Handoff['clips'] = [];
    for (let index = 0; index < definitions.length; index++) {
      const id = index + 1;
      const [name, folder, rationale] = definitions[index];
      const relativePath = `_cut/Sample ${String(id).padStart(2, '0')} ${name}.mp4`;
      const file = path.join(media, relativePath);
      if (!(await exists(file))) await copyFile(sample, file);
      const info = await fingerprint(file);
      clips.push({
        id,
        source: { relativePath, size: info.size, mtimeMs: info.mtimeMs },
        duration: 2,
        markers: [],
        proposed: { filename: `Demo ${String(id).padStart(3, '0')} ${name}.mp4`, folder },
        rationale,
        questions: id === 6 ? ['Check the chapter before filing this clip.'] : [],
        hold: id === 6,
      });
    }
    const handoff: Handoff = {
      schemaVersion: 1,
      projectId: 'practice',
      batchId: 'first-assembly',
      handoffId: 'practice-handoff-1',
      title: 'First assembly — practice batch',
      createdAt: new Date().toISOString(),
      reviewNotes:
        'This is a practice workspace with generated video test patterns, not your real footage.\n\nTry changing a filename, moving a clip to another folder, and adding a decision note. The Move button can safely file these practice clips.\n\nClip 006 is held to demonstrate an unresolved review question. Uncheck “Hold for later” in its details when you decide it is ready.',
      folders: [],
      clips,
    };
    await service.createProject({
      id: 'practice',
      name: 'Practice project',
      mediaRoot: media,
      dataDir: plans,
      namingNotes: 'Generated test clips for trying the application. These are safe to move.',
    });
    await service.importHandoff('practice', handoff);
    await writeFile(path.join(root, 'practice-handoff.json'), JSON.stringify(handoff, null, 2));
    console.log(`Practice project created at ${root}`);
  }
} finally {
  await store.release();
}
