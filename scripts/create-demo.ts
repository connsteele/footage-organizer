import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { loadConfig } from '../src/server/config.js';
import { Organizer } from '../src/server/service.js';
import { Store } from '../src/server/store.js';
import { upgradePracticeTour } from './upgrade-practice.js';
import {
  createPracticeHandoff,
  practiceBatchId,
  practiceReviewFolder,
} from './practice-fixture.js';

const config = await loadConfig();
const root = path.resolve(process.env.FO_DEMO_DIR || path.join(config.dataDir, '..', 'practice'));
const media = path.join(root, 'Video'),
  plans = path.join(root, 'Plans');
const store = new Store(config.dataDir),
  service = new Organizer(store);
try {
  await service.initialize();
  const entry = (await store.registry()).find((p) => p.id === 'practice');
  const existing = entry ? await service.projectState('practice') : undefined;
  if (existing?.batches.some((b) => b.id === practiceBatchId)) {
    const upgraded = await upgradePracticeTour(store, config.tempDir, config.ffmpegPath);
    console.log(
      upgraded
        ? 'Added the marker-review lesson to the existing feature tour. All user decisions and filed clips were preserved.'
        : 'The practice feature tour already exists; all edits and filed clips were preserved.',
    );
  } else {
    if (existing && path.resolve(existing.project.mediaRoot).toLowerCase() !== media.toLowerCase())
      throw new Error(
        'The practice project uses a different footage folder. Set FO_DEMO_DIR to its existing practice directory; no files were changed.',
      );
    const nextId = Math.max(0, ...Object.keys(existing?.catalog || {}).map(Number)) + 1;
    const handoff = await createPracticeHandoff(media, config.tempDir, nextId, config.ffmpegPath);
    if (!existing)
      await service.createProject({
        id: 'practice',
        name: 'Practice project',
        mediaRoot: media,
        dataDir: plans,
        reviewFolder: practiceReviewFolder,
        namingNotes:
          'Generated app feature examples. Read each clip rationale for steps. These files are safe to edit and move.',
      });
    await service.importHandoff('practice', handoff);
    if (existing?.project.reviewFolder === undefined)
      await service.setReviewFolder('practice', practiceReviewFolder);
    await writeFile(
      path.join(root, 'practice-feature-tour-handoff.json'),
      JSON.stringify(handoff, null, 2),
      { flag: 'wx' },
    ).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
    console.log(
      `Practice feature tour ready at ${root}. Earlier practice batches and edits were preserved.`,
    );
  }
} finally {
  await store.release();
}
