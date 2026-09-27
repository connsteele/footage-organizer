# Architecture

React sends HTTP requests to Express. The `Organizer` service handles imports, edits, preflight, execution, and recovery. `Store` handles serialized persistence. Shared Zod schemas validate runtime data and infer TypeScript types; TS annotations alone do not validate imported JSON.

## Code map

| File                     | Responsibility                                                       |
| ------------------------ | -------------------------------------------------------------------- |
| `src/shared/model.ts`    | Handoff/saved-state schemas, types, shared helpers                   |
| `src/shared/markdown.ts` | Snapshots with stable IDs                                            |
| `src/server/service.ts`  | Workflow and execution                                               |
| `src/server/store.ts`    | Single-writer queue, process locks, atomic state writes, checkpoints |
| `src/server/paths.ts`    | Names, root containment, junction checks, file identity              |
| `src/server/move.ts`     | Windows no-replace move and player adapter                           |
| `src/server/app.ts`      | API and local request checks                                         |
| `src/client/useDraft.ts` | Editing history, serialized autosave, revision checks                |
| `src/client/Review.tsx`  | Folder groups, edits, final review, progress, results                |

## Saving

`state.json` is authoritative. Batch exports, Markdown, and operation files are readable materializations. Writes use a temporary file, flush, and rename. The latest 20 state checkpoints are retained. Original handoffs and operations are not pruned. A materialization error is reported even if authoritative state was saved; reload reads the authoritative revision.

All mutations are serialized. A running move blocks plan mutations. Each batch edit supplies its expected revision, so a stale browser cannot overwrite newer data. Autosave queues edits made during an earlier save and uses the returned revision.

## Moves

Preflight creates an expiring server review tied to project, batch, and revision. The move endpoint accepts that review ID, rechecks files, and records an operation using the same ID. Repeated requests reconnect to that operation.

Each item is saved as `moving` before the filesystem call. Windows `.NET File.Move(source, target)` without overwrite refuses existing targets, including targets created after preflight. The PowerShell helper contains constant code; source/target paths are supplied as environment values. Only same-volume regular files are supported.

File identity is volume, file ID, size, and modification time. Sources and destination parents are checked for linked paths. No content decoding, marker rewriting, or transcoding occurs. This is a trusted local-user workflow; adversarial changes to directories during execution are outside its threat model.

## Recovery

On restart, interrupted operations are reconciled without issuing new moves:

- Expected file at destination and source absent: record success and update catalog.
- Expected source still present and destination absent or occupied by a different identity: retain pending; collision checks still block execution.
- Uncertain identity/location: mark ambiguous and block new moves for that batch.

Check recovery repeats inspection after the user resolves paths. Completed items are not rolled back. A new execution review includes only pending work. The filesystem batch is not a single transaction.

## Local operation

Express binds to loopback and serves both React and the API. Host/origin checks and a session token protect mutations from unrelated web pages. Clients identify projects, batches, revisions, and clips; they do not submit shell commands.

The launcher checks application identity on the port before reopening it. The process continues after tabs close. The sidebar Stop app button saves pending edits before requesting shutdown; a separate Windows stop shortcut can also stop an idle instance. Both shortcuts use hidden PowerShell hosts. The launch wrapper waits for the JS launcher and shows startup/browser errors. It uses the user's installed Node rather than depending on an agent tool runtime. The JS launcher waits for the browser-opening helper, and records failures in the configured data folder. Application logic remains JS/TS.

## Portable handoff documentation

`AGENTS.md` links to `docs/AGENT_GUIDE.md`, the handoff protocol, example, and generated schema. The client imports these documents into the built app, so guide downloads work without a public documentation site. `src/client/handoffKit.ts` combines them with a read-only project snapshot and saved batch decisions. The kit is Markdown reference material, not an import payload. It is generated on demand and is never written into project state. Clips and other review evidence must be supplied separately. The CLI validator uses the runtime Zod schema and the same path/name helpers as the backend; import and preflight remain responsible for live filesystem and catalog checks.

Future media previews belong behind a media service, storage changes behind Store, and other platforms behind the move adapter. Use explicit schema versions and preserve IDs. Keep large disposable previews on the configured scratch drive.
