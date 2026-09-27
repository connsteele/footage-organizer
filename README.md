# Footage Organizer

A local Windows application for turning reviewed footage suggestions into filed clips.

**Cut and mark → review with an agent → import handoff → edit → Move clips.**

React, TypeScript, Vite, CSS Modules, Node, and Express. Saved plans are readable JSON with matching Markdown. The app does not call an AI service or upload footage.

## For review agents and new conversations

Start at [AGENTS.md](AGENTS.md) or the [agent quick start](docs/AGENT_GUIDE.md). The [handoff protocol](docs/HANDOFF.md), [JSON schema](docs/handoff.schema.json), and [example](docs/examples/handoff.v1.json) define the complete import format.

In the app, open **Handoff guide**, choose a project, and **Download handoff kit**. Give that single Markdown file and your clips/review material to any review conversation. The kit includes instructions, a dated project snapshot with saved decisions and stable IDs, an example, and the schema. **Prepare handoff** on a project opens the guide with that project selected. No previous chat or particular AI provider is required.

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

Each project has a **footage folder** and a separate **plan folder**, for example `I:\...\My Review\Video` and `I:\...\My Review\Footage Organizer`. Neither may contain the other. Plans stay separate from application updates.

The plan folder contains authoritative `state.json`, original `imports/`, readable `batches/` JSON and Markdown, `operations/` journals, and the latest 20 `checkpoints/`. Imports and operation records are retained. Process locks prevent two servers from editing the same plan folder.

## Practice project

With the app stopped and FFmpeg available, run `npm run demo`, then `npm run launch`. Six small test-pattern videos demonstrate the complete workflow. They are safe to edit and move. Running the demo command again preserves existing work. `FO_DEMO_DIR` selects the practice directory; `FFMPEG_PATH` selects FFmpeg if it is not on PATH.

## Real footage workflow

1. Create a project with its name, stable ID, footage folder, and plan folder.
2. Choose **Prepare handoff → Download handoff kit** and give it, along with review material, to the chat reviewing the clips. **Export project context** remains available as a context-only JSON.
3. Have that chat produce JSON following [the handoff guide](docs/HANDOFF.md) and [schema](docs/handoff.schema.json).
4. Import the JSON using **Import handoff** or the drop area.
5. Edit names, drag rows between groups, choose destinations in Details, leave notes, or hold clips. Changes autosave.
6. Click **Move clips**, review the exact changes, and confirm **Move N clips**.
7. Review the results. Paths, Markdown, and a move log are saved automatically.

Project context includes current IDs and the next available ID. Existing IDs must be reused. Reimporting a handoff opens its saved batch without overwriting edits. A revised handoff needs new batch/handoff IDs and current source paths; it does not merge into an edited batch.

**Export plan** produces a review record, not an import handoff. It includes original suggestions and current edits so a review agent can inspect your choices. Use a fresh handoff for later imports.

## Moves and recovery

- Held clips stay in place. Clips with questions start held; explicitly unchecking Hold includes them.
- Preflight detects stale sources, duplicate/existing targets, invalid Windows names, path escapes, extension changes, case-only renames, and cross-volume moves.
- The backend invokes Windows' two-argument `.NET File.Move`, which refuses an existing destination. Paths are passed as environment data into a constant PowerShell helper. All application logic is TypeScript.
- Each move records intent before execution and result afterward. Contents and embedded markers are preserved; no transcoding occurs.
- A failure stops the batch. Completed files remain filed. A fresh review includes only remaining pending changes.
- Restart recovery reconciles file identities without replaying moves. Ambiguity blocks further execution. **Move history → Check recovery** retries the inspection.
- Failed saves and stale browser revisions prevent execution. Download unsaved edits before reloading after a conflict.
- Undo/redo applies to edits in this session. Reset suggestion works after reopening. Filed placements are locked; use a fresh handoff to reorganize them.

Do not edit active state files or change media during execution. A move batch is not one atomic filesystem transaction. Metadata checks detect ordinary stale files; they are not cryptographic authenticity checks.

## Release scope

Implemented: projects/batches; structured import; stable IDs; grouped clips; editable names; drag and drop; destination selectors; proposed folders; notes; holds; autosave; edit undo/redo; reset; JSON/Markdown exports; external-player launch; checked execution; progress; logs; recovery; local launcher.

Deferred: embedded playback/proxies, analysis/transcription, marker editing, Resolve integration, cross-volume transfers, case-only renames, rename cycles, automatic rollback, merging revised handoffs, cloud sync, and an installer. Project setup accepts pasted folder paths. Open in player uses the Windows default media association; codec support depends on that player.

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

Regenerate the handoff schema with `npm run schema`. Convert the earlier placement proposal and inventory with:

```powershell
npm run convert:legacy -- proposal.json inventory.json "I:\...\Video" project-id output.json notes.md
```

The converter preserves IDs, creates a new handoff, and refuses to overwrite its output. It does not modify footage or original audit records.

Check a handoff without importing or moving files:

```powershell
npm run validate:handoff -- path\to\handoff.json
```
