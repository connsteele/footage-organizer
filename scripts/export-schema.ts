import { mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { handoffSchema, reviewUpdateSchema } from '../src/shared/model.js';
await mkdir('docs', { recursive: true });
await writeFile(
  'docs/handoff.schema.json',
  JSON.stringify(z.toJSONSchema(handoffSchema, { io: 'input' }), null, 2) + '\n',
);
console.log('Updated docs/handoff.schema.json');
await writeFile(
  'docs/batch-update.schema.json',
  JSON.stringify(z.toJSONSchema(reviewUpdateSchema, { io: 'input' }), null, 2) + '\n',
);
console.log('Updated docs/batch-update.schema.json');
