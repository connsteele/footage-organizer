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

## Review folders and follow-up updates

Projects have an optional root-relative `reviewFolder` default; batches record their own chosen folder. Optional fields preserve compatibility with existing state. `reviewFolders.ts` validates containment and rejects linked roots, then inventories supported media with catalog IDs and batch membership. Folder paths entered in the UI may be absolute or relative; stored paths are relative. `folderPicker.ts` is a Windows native dialog adapter with paths passed as environment data, protected by the same mutation token as other local actions.

`reviewUpdates.ts` saves held-clip request snapshots and accepts strict `batch-update` payloads. Exporting a snapshot increments the project state revision but not the batch decision revision, so existing drafts remain valid. Preview and apply compare notes, decisions, proposals, source identity/location, and held/filed status against the exported request. Apply rechecks everything within Store's serial queue and requires the preview's batch revision. Selected proposals and agent explanations change; user notes, original imports, and before/after history remain. Clips stay held, and no filesystem moves occur. Reused update IDs require identical normalized payloads; accepted clip IDs cannot be applied twice. Saving ordinary batch edits preserves this metadata. The client downloads a self-contained protocol/schema/example in `heldReviewKit.ts` and shows comparison and history in `HeldReviewTools.tsx`.

## Moves

Preflight creates an expiring server review tied to project, batch, and revision. The move endpoint accepts that review ID, rechecks files, and records an operation using the same ID. Repeated requests reconnect to that operation.

Each item is saved as `moving` before the filesystem call. Windows `.NET File.Move(source, target)` without overwrite refuses existing targets, including targets created after preflight. The PowerShell helper contains constant code; source/target paths are supplied as environment values. Only same-volume regular files are supported.

File identity is volume, file ID, size, and modification time. Sources and destination parents are checked for linked paths. No content decoding, marker rewriting, or transcoding occurs. This is a trusted local-user workflow; adversarial changes to directories during execution are outside its threat model.

## Recovery

On restart, interrupted operations are reconciled without issuing new moves:

- Expected file at destination and source absent: record success and update catalog.
- Expected source still present and destination absent or occupied by a different identity: retain pending; collision checks still block execution.
- Uncertain identity/location: mark ambiguous and block new moves for that batch.

Check recovery repeats inspection after the user resolves paths. Project-state polling also reconciles a running journal when its worker has already stopped, such as after a disk-write failure; it never replays filesystem moves. Unreconciled running/moving records block a new move, and ambiguous clips remain blocked across batches sharing those IDs. Repeated execution requests must refer to the original batch. Completed items are not rolled back. A new execution review includes only pending work. The filesystem batch is not a single transaction.

## Project removal and media preview

Project removal is serialized with other mutations and blocked during moves. `removed-projects.json` in the app registry records a removed-project snapshot before registration is removed. Retained plan folders can be reopened; active folders are excluded from the cleanup list and rejected by cleanup even if an old removal ID is submitted. `projectCleanup.ts` verifies canonical paths, saved project identity, active-project overlap, and managed records before deleting known app JSON/Markdown files. A durable manifest in the removal record lists validated relative paths and file identities before the first deletion. A retry verifies remaining identities and does not depend on `state.json` still existing. Replaced records block cleanup. It never recursively deletes a chosen directory. It keeps the authoritative state until the other records are removed, releases the plan lock, and only removes empty directories. Unrelated files remain. A partial cleanup failure keeps the removal entry available for retry; deletion is not a filesystem transaction.

`media.ts` issues temporary read-only capabilities for individual catalog clips through a session-protected POST. Native video requests use these URLs without exposing the app's mutation token. Each stream/range request revalidates the catalog path and file identity, uses same-origin resource policy, and refuses moved, changed, deleted, or expired targets. Express streams files and handles byte ranges and HEAD. No browser blob buffering or media conversion occurs. Only one `ClipPreview` mounts per review view; it releases the video source on collapse/unmount, and move review closes it before execution. The external-player action remains independent.

## Local operation

Express binds to loopback and serves both React and the API. Host/origin checks and a session token protect mutations from unrelated web pages. Clients identify projects, batches, revisions, and clips; they do not submit shell commands.

The launcher checks application identity on the port before reopening it. The process continues after tabs close. The sidebar Stop app button saves pending edits before requesting shutdown; a separate Windows stop shortcut can also stop an idle instance. Both shortcuts use hidden PowerShell hosts. The launch wrapper waits for the JS launcher and shows startup/browser errors. It uses the user's installed Node rather than depending on an agent tool runtime. The JS launcher waits for the browser-opening helper, and records failures in the configured data folder. Application logic remains JS/TS.

Shutdown admission uses the same serialized queue as mutations. It waits for queued saves, refuses an active move, then marks the service as stopping before acknowledging the request. Later mutations return 503. Process shutdown drains queued work and waits for an active move before releasing locks.

## Portable handoff documentation

`AGENTS.md` links to `docs/AGENT_GUIDE.md`, the handoff protocol, example, and generated schema. The client imports these documents into the built app, so guide downloads work without a public documentation site. `src/client/handoffKit.ts` combines them with a read-only project snapshot and saved batch decisions. The kit is Markdown reference material, not an import payload. It is generated on demand and is never written into project state. Clips and other review evidence must be supplied separately. The CLI validator uses the runtime Zod schema and the same path/name helpers as the backend; import and preflight remain responsible for live filesystem and catalog checks.

Further playback changes belong behind the media service, storage changes behind Store, and other platforms behind the move adapter. Use explicit schema versions and preserve IDs. Keep large disposable previews on the configured scratch drive.
