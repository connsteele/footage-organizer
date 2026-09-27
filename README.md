# Footage Organizer

A local Windows application for turning reviewed footage suggestions into filed clips.

**Cut and mark → review with an agent → import handoff → edit → Move clips.**

React, TypeScript, Vite, CSS Modules, Node, and Express. Saved plans are readable JSON with matching Markdown. The app does not call an AI service or upload footage.

## For review agents and new conversations

Start at [AGENTS.md](AGENTS.md) or the [agent quick start](docs/AGENT_GUIDE.md). The [handoff protocol](docs/HANDOFF.md), [JSON schema](docs/handoff.schema.json), and [example](docs/examples/handoff.v1.json) define the complete import format.

In the app, open **Handoff guide**, choose a project, and **Download handoff kit**. Give that single Markdown file and your clips/review material to any review conversation. The kit includes instructions, a dated project snapshot with saved decisions and stable IDs, an example, and the schema. **Start next batch** on a project or batch opens the preparation workflow with that project selected, including an import step for the returned handoff. No previous chat or particular AI provider is required.

Each person runs their own independent local copy with their own folders and configuration. This is a single-user local app; account setup and a shared server are not required. Sample paths and projects are examples, not required conventions.

## Run

Requirements: Windows, Node 22.12+ (Node 24 LTS recommended), and npm. File execution is verified for regular files on local NTFS volumes. FFmpeg is only needed to generate the optional practice videos.

```powershell
cd path\to\footage-organizer
npm ci
npm run build
npm run launch
```

The launcher starts the backend if necessary and opens **http://127.0.0.1:4317**. The interface defaults to dark mode. `npm start` runs the built server in the terminal. Closing a browser tab leaves the backend running so an active move can finish. Use the visible **Stop app** button at the bottom of the sidebar to save pending edits in this tab and stop the server. A failed save keeps the app open.

`npm run shortcut` installs **Footage Organizer** and **Stop Footage Organizer** desktop shortcuts. The stop shortcut shuts down the server and displays the result without opening a terminal; `npm run stop` does the same from a terminal. Wait for browser edits to show **Saved** before using the Windows shortcut. Both stop controls refuse to interrupt an active file move. Startup problems are recorded in `startup.log` and `server.log` in the application data directory.

The launch shortcut uses the installed Node executable found when installing shortcuts, with a PATH fallback if it moves. Its Windows PowerShell target is the hidden launcher host; the app itself stays in this repository. Launch failures appear in a message instead of disappearing silently. Re-run `npm run shortcut` after moving the repo or changing Node installations.

## Local configuration

An optional, untracked `organizer.local.json` configures your instance. For example, using a writable drive of your choice:

```json
{
  "dataDir": "D:/FootageOrganizer/AppData",
  "tempDir": "D:/FootageOrganizer/Temp",
  "port": 4317
}
```

`FO_DATA_DIR`, `FO_TEMP_DIR`, and `PORT` override these settings. Without configuration, app data defaults to a `Footage Organizer` folder under the user's home directory and temporary files use the system temp folder. Each installation keeps its own settings; example drive letters are not required.

Each project has **Root Footage** (the shared library), **Review Footage** (the default incoming folder inside that library), and a separate **Plan folder** for app records. Browse opens the Windows folder picker; pasted paths also work. For example, Root Footage can be `I:\...\My Review\Video`, Review Footage `Video/_incoming`, and Plan folder `I:\...\My Review\Footage Organizer`. Root Footage and Plan folder may not contain each other, another project's folders, or the app storage folder. Plans stay separate from application updates. Review Footage can be overridden for each batch without changing the library.

The plan folder contains authoritative `state.json`, original `imports/`, readable `batches/` JSON and Markdown, `operations/` journals, and the latest 20 `checkpoints/`. Imports and operation records are retained. Process locks prevent two servers from editing the same plan folder.

## Practice project

With the app stopped and FFmpeg available, run `npm run demo`, then `npm run launch`. Six small test-pattern videos demonstrate the complete workflow. They are safe to edit and move. Running the demo command again preserves existing work. `FO_DEMO_DIR` selects the practice directory; `FFMPEG_PATH` selects FFmpeg if it is not on PATH.

## Real footage workflow

Create one project for a body of footage that shares a folder library and naming conventions. Add a new batch for each capture/processing session by importing a new handoff into that same project. Earlier batches and decisions remain available, while the catalog and destination folders are shared.

For example, source clips can live under `Video/_incoming/Session 01/` and `Video/_incoming/Session 02/`, with both batches filing into `Video/Story/` and `Video/Gameplay/`. Choose `Video` as the project's footage root; all source and destination paths are relative to it. A batch does not need its own final destination folder, and importing a batch does not move its footage.

1. Create a project with its name, stable ID, Root Footage, Review Footage, and Plan folder.
2. Choose **Start next batch**, confirm this batch's Review Footage folder, and **Download handoff kit**. The kit includes an inventory of supported media, with tracked clips identified. Give it and review material to the review chat. **Save as default review folder** sets or changes this preference for an existing project. **Export project context** remains available as a context-only JSON.
3. Have that chat produce JSON following [the handoff guide](docs/HANDOFF.md) and [schema](docs/handoff.schema.json).
4. Import the JSON using **Import handoff** or the drop area.
5. Edit names, drag rows between groups, choose destinations in Details, leave notes, or hold clips. **Preview** expands a player for playback and scrubbing; the adjacent play icon opens the external player. Changes autosave.
6. Click **Move clips**, review the exact changes, and confirm **Move N clips**.
7. Review the results. Paths, Markdown, and a move log are saved automatically.

Batches open in **Remaining**, which hides filed clips and keeps unfiled clips (including held and unchanged placements) visible. Use **Held**, **Filed**, or **All** to inspect those views; search applies within the selected view. Filters only change what is displayed: exports retain the whole batch, and **Move clips** still reviews all pending placements in that batch. Empty groups containing only hidden clips disappear until a drag makes destinations available.

After filing a batch, use **Start next batch** from the batch header, the bottom action bar when no moves remain, or the project page. Pending edits are saved before leaving the batch; a failed save keeps it open. Download a fresh kit, review the next footage, and choose **Import reviewed handoff** on that page. The next handoff creates another batch in the same project. Earlier batches, filed records, and held clips with notes remain available; held clips do not need to be resolved first.

Project context includes current IDs and the next available ID. Existing IDs must be reused. Reimporting a handoff opens its saved batch without overwriting edits. A revised handoff needs new batch/handoff IDs and current source paths; it does not merge into an edited batch.

The app's batch is the review plan created at import. Capture, marking, and cutting happen before that, outside the app. There is currently no watch-folder ingestion or empty pre-review batch to create. For every new processing chunk, download a fresh project handoff kit, review that chunk, import its new handoff, and work through its placements. IDs continue across batches rather than restarting at 1.

**Export plan** produces a review record, not an import handoff. It includes original suggestions, current edits, and accepted follow-up history.

## Revisiting held clips

1. Leave your questions in **Your note**, keep the clips held, and open **Agent follow-up → Export held clips for review** in that batch.
2. Give the downloaded kit and relevant footage to any review conversation. It includes your notes, exact clip IDs, original evidence, and the [batch-update protocol](docs/BATCH_UPDATES.md).
3. Choose **Import batch update** in the same batch. Compare current and suggested placements, read the reasoning, and select the suggestions to accept.
4. Accepted suggestions preserve your notes and original proposals, add history, and stay held. Release them when satisfied, then use the usual Move clips confirmation.

Edits made since export, changed sources, and filed clips block affected suggestions. Other suggestions may still be accepted. Export a fresh held review for conflicts involving changed decisions. No files move during this process. Existing projects and batches work without migration; select a review folder on Start next batch when needed.

## In-app video preview

Use **Preview** beside the external-player icon and Details to expand a clip's player. It includes playback, scrubbing, volume, and fullscreen controls provided by the browser. Nothing starts playing automatically. Opening another clip closes the first preview; closing the preview, navigating away, or starting the move review releases the player. Filed clips can be previewed in the Filed view too.

The app streams original media from disk with byte-range support for seeking; it does not load whole videos into JavaScript memory, upload media, create proxies, or transcode files. Browser/OS codec support determines which files play. If a format is unsupported, use **Open in external player**. Preview URLs are temporary and only grant access to one registered clip; reopen the preview after moving the clip or restarting the app. A changed or missing source is reported instead of serving an unverified replacement.

## Deleting projects and cleaning up plans

Inside a project's page, choose **Delete project**. The confirmation offers:

- **Keep saved plans** (default): remove the project and all its batches from the app, retaining its plan folder, notes, and move history. This makes accidental removal recoverable. Create a project with the same project ID, Root Footage, and Plan folder to reopen it.
- **Delete saved plans too**: remove the project and permanently delete its app-owned saved records. Footage stays in place, and completed moves are not reversed.

From **All projects → Clean up removed projects**, inspect retained plan folders and confirm deletion for a removed project. Cleanup only deletes known app records after checking their project identity and paths. Unrelated files are preserved, including files placed in the plan folder. Active projects, linked folders, and folders overlapping footage or app storage cannot be cleaned up. Deletion and cleanup are blocked during file moves. If cleanup fails, the removed project remains in the cleanup list for retry; records already deleted are not restored. Keep external backups if you may need permanently deleted plans later.

## Moves and recovery

- Held clips stay in place. Clips with questions start held; explicitly unchecking Hold includes them.
- Preflight detects stale sources, duplicate/existing targets, invalid Windows names, path escapes, extension changes, case-only renames, and cross-volume moves.
- The backend invokes Windows' two-argument `.NET File.Move`, which refuses an existing destination. Paths are passed as environment data into a constant PowerShell helper. All application logic is TypeScript.
- Each move records intent before execution and result afterward. Contents and embedded markers are preserved; no transcoding occurs.
- A failure stops the batch. Completed files remain filed. A fresh review includes only remaining pending changes.
- Restart recovery reconciles file identities without replaying moves. Ambiguity blocks further execution. **Move history → Check recovery** retries the inspection.
- Failed saves and stale browser revisions prevent execution. Download unsaved edits before reloading after a conflict.
- Undo/redo applies to edits in this session. Reset suggestion restores the imported name and folder while preserving your note and hold status. It works after reopening. Filed placements are locked; use a fresh handoff to reorganize them.

Do not edit active state files or change media during execution. A move batch is not one atomic filesystem transaction. Metadata checks detect ordinary stale files; they are not cryptographic authenticity checks.

## Release scope

Implemented: projects/batches; project deletion with retained-plan or permanent-plan options and later cleanup; folder pickers and per-batch review inventory; structured import; stable IDs; grouped clips; editable names; drag and drop; destination selectors; proposed folders; notes; holds; held-clip follow-up exports and selective updates with conflict checks/history; autosave; edit undo/redo; reset; JSON/Markdown exports; in-app original-media playback and scrubbing; external-player launch; checked execution; progress; logs; recovery; local launcher.

Deferred: playback proxies/transcoding, analysis/transcription, marker editing, Resolve integration, cross-volume transfers, case-only renames, rename cycles, automatic rollback, full-batch handoff replacement, cloud sync, and an installer. Open in player uses the Windows default media association; codec support depends on that player.

## Development

```powershell
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
```

Vite runs on `127.0.0.1:5173` and proxies `/api` to Express on port 4317. Stop the built server before starting the development server. If changing the backend port, update Vite's proxy too.

`src/client` contains React/CSS Modules; `src/server` contains Express, storage, and file operations; `src/shared` contains schemas, types, and Markdown. See [architecture notes](docs/ARCHITECTURE.md).

Tests use disposable files under the configured temporary folder (`FO_TEST_DIR` overrides the test location). They cover import identity, stale writes, actual no-replace moves, collision races, partial failures, recovery, API boundaries, autosave sequencing, and the handoff documentation. Browser QA uses generated practice files.

See the [September 27 code audit](docs/AUDIT_2026-09-27.md) for reproduced bugs, regression coverage, testing limits, and recommended workflow improvements.

Regenerate the handoff schema with `npm run schema`. Convert the earlier placement proposal and inventory with:

```powershell
npm run convert:legacy -- proposal.json inventory.json "I:\...\Video" project-id output.json notes.md
```

The converter preserves IDs, creates a new handoff, and refuses to overwrite its output. It does not modify footage or original audit records.

Check a handoff without importing or moving files:

```powershell
npm run validate:handoff -- path\to\handoff.json
```
