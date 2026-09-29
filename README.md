# Footage Organizer

A local Windows application for turning reviewed footage suggestions into filed clips.

**Cut and mark → review with an agent → import handoff → edit → Move clips.**

React, TypeScript, Vite, CSS Modules, Node, and Express. Saved plans are readable JSON with matching Markdown. The app does not call an AI service or upload footage.

## For review agents and new conversations

Start at [AGENTS.md](AGENTS.md) or the [agent quick start](docs/AGENT_GUIDE.md). The [handoff protocol](docs/HANDOFF.md), [JSON schema](docs/handoff.schema.json), and [example](docs/examples/handoff.v1.json) define the complete import format.

In the app, open **Handoff guide**, choose a project, and **Download handoff kit**. Give that single Markdown file and your clips/review material to any review conversation. The kit includes instructions, a dated project snapshot with saved decisions and stable IDs, an example, and the schema. **Start next batch** on a project or batch opens the preparation workflow with that project selected, including an import step for the returned handoff. No previous chat or particular AI provider is required.

Each person runs their own independent local copy with their own folders and configuration. This is a single-user local app; account setup and a shared server are not required. Sample paths and projects are examples, not required conventions.

## Run

Requirements: Windows, Node 22.12+ (Node 24 LTS recommended), and npm. File execution is verified for regular files on local NTFS volumes. **FFmpeg** generates practice videos and writes reviewed embedded marker changes. **ffprobe** reads embedded chapters for kits and previews and verifies marker writing. Ordinary moves, playback and imported markers work without these optional tools.

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

Each project has **Root Footage** (the shared library), **Review Footage** (the default incoming folder inside that library), and a separate **Plan folder** for app records. Browse opens the Windows folder picker; pasted paths also work. With no valid starting path, Browse starts in your user folder, so you can choose Review Footage before Root Footage. When Root Footage is already set, an empty Review Footage picker starts there. For example, Root Footage can be `I:\...\My Review\Video`, Review Footage `Video/_incoming`, and Plan folder `I:\...\My Review\Footage Organizer`. Root Footage and Plan folder may not contain each other, another project's folders, or the app storage folder. Plans stay separate from application updates. Review Footage can be overridden for each batch without changing the library.

The plan folder contains authoritative `state.json`, original `imports/`, readable `batches/` JSON and Markdown, `operations/` journals, and the latest 20 `checkpoints/`. Imports and operation records are retained. Process locks prevent two servers from editing the same plan folder.

## Practice project

With the app stopped and FFmpeg available, run `npm run demo`, then `npm run launch`. Open **Practice project → App feature tour — names, moves, markers, and held review**. Thirteen generated 12-second videos use feature names instead of a particular kind of footage. Open each clip's **Details** for the steps.

| Example                      | What to try                                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Rename only                  | Edit New while keeping the same destination folder and locked extension.                                          |
| Move only                    | Keep the current name and change its location.                                                                    |
| Rename and move              | Review both changes in the move confirmation.                                                                     |
| Video and markers            | Scrub, seek imported markers at 2/6 seconds, and view embedded chapters at 0/4/9 seconds with ffprobe configured. |
| Held review                  | Add Your note and export it through Agent follow-up.                                                              |
| Restore and undo             | Restore Original with the icon, then try Undo/Redo and Reset suggestion.                                          |
| Unchanged clip               | See a clip skipped by Move clips because its name and location already match.                                     |
| New folder and dragging      | Drag to the empty suggested destination; a needed new folder is created during filing.                            |
| Markers first then clip name | Review marked events, accept/edit/keep names, and see how those events inform the clip name.                      |

The **Scroll through many markers** example combines 24 imported review markers and three embedded chapters in the same bounded list. Try scrolling to the last marker, clicking cards to seek, editing names, and collapsing the panel.

The **Add delete and review markers** example starts with three embedded markers and no rename suggestions. Delete the start marker and add a new event at the playhead. Try canceling deletion, restoring it, and Undo/Redo before filing. **Clip review progress** demonstrates marking an unchanged whole clip Reviewed, filtering by review state, and undoing the check without any file work.

The **Review stack and move queue** example demonstrates the marker count, clearing a reviewed clip from Remaining, returning it with Undo or its review toggle, and moving the queue. Initially ten clips have proposed file changes, one is held, and two are unchanged. Mark clips Reviewed before moving them. Unchanged reviewed clips also leave Remaining and appear in the queue as already in place; Move clips skips them. The marker lessons demonstrate reviewing events before naming the clip and writing accepted changes through Move clips.

These files are safe to edit and move. Re-running the command preserves the feature tour's edits and filed clips and adds missing lessons to the same batch. An older practice project receives this as an additional batch with fresh clip IDs; its earlier batches remain intact. `FO_DEMO_DIR` selects the practice directory (use the existing directory when upgrading); `FFMPEG_PATH` selects FFmpeg if it is not on PATH. Generation refuses to replace an existing file with different contents.

## Real footage workflow

Create one project for a body of footage that shares a folder library and naming conventions. Add a new batch for each capture/processing session by importing a new handoff into that same project. Earlier batches and decisions remain available, while the catalog and destination folders are shared.

For example, source clips can live under `Video/_incoming/Session 01/` and `Video/_incoming/Session 02/`, with both batches filing into `Video/Story/` and `Video/Gameplay/`. Choose `Video` as the project's footage root; all source and destination paths are relative to it. A batch does not need its own final destination folder, and importing a batch does not move its footage.

1. Create a project with its name, stable ID, Root Footage, Review Footage, and Plan folder.
2. Choose **Start next batch**, confirm this batch's Review Footage folder, and **Download handoff kit**. The kit includes an inventory of supported media, with tracked clips identified. Give it and review material to the review chat. **Save as default review folder** sets or changes this preference for an existing project. **Export project context** remains available as a context-only JSON.
3. Have that chat produce JSON following [the handoff guide](docs/HANDOFF.md) and [schema](docs/handoff.schema.json).
4. Import the JSON using **Import handoff** or the drop area. On Start next batch, choose **Import reviewed handoff** or drop one handoff JSON beside that button.
5. Edit names, drag rows between groups, choose destinations in Details, leave notes, or hold clips. **Preview** expands a player for playback and scrubbing; the adjacent play icon opens the external player. Mark each whole clip **Reviewed** when satisfied. Changes autosave.
6. Open **Move queue**, then click **Move clips**, review the exact changes, and confirm **Move N clips**. You can also move the queue from the other views.
7. Review the results. Paths, Markdown, and a move log are saved automatically.

Batches open in **Remaining**, the unfiled clips still needing whole-clip review (including unreviewed holds). Marking a clip Reviewed clears it from this stack. **Move queue** contains reviewed, unfiled clips that are not held; unchanged reviewed clips are included as already in place. **Held** retains held clips regardless of review progress; **Filed** retains completed file operations; **All** shows everything. Search works in every view. **Review status** adds a filter in Held, Filed, and All; Remaining and Move queue already specify review state. Switching views resets that extra filter and keeps search. Exports retain the whole batch. **Move clips** includes every queued clip with file changes regardless of view/search, and excludes unreviewed and held clips. Empty groups containing only hidden clips disappear until a drag makes destinations available.

After filing a batch, use **Start next batch** from the batch header, the bottom action bar when no moves remain, or the project page. Pending edits are saved before leaving the batch; a failed save keeps it open. Download a fresh kit, review the next footage, and choose **Import reviewed handoff** on that page. The next handoff creates another batch in the same project. Earlier batches, filed records, and held clips with notes remain available; held clips do not need to be resolved first.

Project context includes current IDs and the next available ID. Existing IDs must be reused. Reimporting a handoff opens its saved batch without overwriting edits. A revised handoff needs new batch/handoff IDs and current source paths; it does not merge into an edited batch.

The app's batch is the review plan created at import. Capture, marking, and cutting happen before that, outside the app. There is currently no watch-folder ingestion or empty pre-review batch to create. For every new processing chunk, download a fresh project handoff kit, review that chunk, import its new handoff, and work through its placements. IDs continue across batches rather than restarting at 1.

**Export plan** produces a review record, not an import handoff. It includes original suggestions, current edits, and accepted follow-up history.

**Marker-name review:** leave embedded marker extraction enabled when downloading the kit. The agent reviews markers and surrounding footage first, then uses those events to suggest the clip filename. In Preview → Markers or Details → Marker names, compare New above Original, then edit, accept, or keep originals. The check icon accepts New; the return arrow keeps Original. Hover for action names, or use the information icon to read the agent’s reasoning. Click a marker card in Preview, or focus it and press Enter or Space, to seek to the marked event. Text fields and review buttons keep their own actions. Acceptance saves the decision; Move clips writes accepted embedded names alongside file changes. Export markers and plan exports retain originals and decisions. See [Reviewing marker names](docs/AGENT_GUIDE.md#reviewing-marker-names).

**Whole-clip review:** each clip starts **Needs review**. After checking its footage, filename, destination, markers and notes, click that status in the clip header to mark it **Reviewed**. It leaves Remaining for Move queue (or stays in Held if held). Click Reviewed again or use Undo to return it to Remaining. The batch displays a reviewed count. This flag autosaves, survives reloads, and supports Undo/Redo; it works for unchanged, held and filed clips too. Marking it does not immediately move files, release holds, or accept marker names. Your edits retain your chosen flag; accepting a returned agent update resets the affected clip to Needs review so its new suggestions get another pass. Existing saved review flags are honored; clips without a flag start Needs review.

The clip header's **N markers to review** badge counts pending marker-name suggestions, not unchanged marker names or whole-clip progress. Accepting a name, keeping Original, or deleting the marker reduces the count. Marking the whole clip Reviewed does not silently accept pending names; the move confirmation warns that pending names keep their originals.

**Delete and add markers:** the trash icon opens a confirmation dialog. Deleted markers disappear from the active list, timeline, and active marker export. Use **Show deleted markers → Restore marker** or Undo before filing. Deleting an embedded marker removes its chapter when you confirm Move clips; the original evidence remains in the saved plan/history. **Add marker** starts at the Preview playhead (or zero in Details); enter a name and time as seconds or HH:MM:SS.mmm. New marker names are accepted when created. Leave **Write an embedded chapter with Move clips** checked to embed it, or uncheck for app/export only. Duplicate times and times at or beyond the clip end are rejected. These decisions autosave, survive reloads, and support Undo/Redo. Marker cards show Original, Name pending, Accepted or Keeping original to describe the name decision, separate from the whole clip's review status.

## Revisiting held clips

1. Leave your questions in **Your note**, keep the clips held, and open **Agent follow-up → Export held clips for review** in that batch.
2. Give the downloaded kit and relevant footage to any review conversation. It includes your notes, exact clip IDs, original evidence, and the [batch-update protocol](docs/BATCH_UPDATES.md).
3. Choose **Import batch update** in the same batch. Compare current and suggested placements, read the reasoning, and select the suggestions to accept.
4. Accepted suggestions preserve your notes and original proposals, add history, and stay held. Review the updated clips, release their holds, and mark them Reviewed to put them in Move queue, then confirm Move clips.

Edits made since export, changed sources, and filed clips block affected suggestions. Other suggestions may still be accepted. Export a fresh held review for conflicts involving changed decisions. No files move during this process. Existing projects and batches work without migration; select a review folder on Start next batch when needed.

## In-app video preview

Use **Preview** beside the external-player icon and Details to expand a clip's player. It includes playback, scrubbing, volume, and fullscreen controls provided by the browser. On wide windows, Markers and Playback info sit beside the video; on smaller windows they stack below it. Markers opens by default and combines name review and playback-only markers in time order. Its list scrolls within a capped height on every window size, so additional markers do not keep enlarging the preview. Collapse it when you want to focus on playback. Nothing starts playing automatically. Opening another clip closes the first preview; closing the preview, navigating away, or starting the move review releases the player. Filed clips can be previewed in the Filed view too.

Opening **Preview** or **Details** scrolls the requested panel and clip heading toward the center of the available viewport, leaving room above the bottom Move clips bar. Tall details panels align to their beginning when the whole panel cannot fit. Reduced-motion preferences are respected. The player reserves its space while loading, preventing another jump when metadata arrives.

**Playback shortcuts:** while Preview is open, **J** rewinds, **K** pauses, and **L** plays forward. Tap J or L again to increase speed through 1×, 2×, 4×, 8×, and 16×. The opposite key steps down toward pause, then changes direction; after K, the next J or L starts at 1×. Holding a key does not repeat speed changes. Direction and speed appear beneath the video. Keys are ignored while typing, in selection menus/dialogs, and when combined with modifiers. Closing Preview releases the controls. **Keyboard shortcuts** near App settings documents the controls; the practice tour's Video and markers clip can be used to try them.

Forward shuttle uses native video playback. Reverse is silent backward scrubbing with one seek at a time because [negative playback rates are not widely supported by browsers](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/playbackRate). Reverse smoothness depends on the footage and browser; it pauses when the tab is hidden. This implements the J/K/L shuttle workflow, not Resolve's additional key combinations for frame stepping or slow motion.

The marked seek bar below the video combines imported handoff markers with embedded chapter markers. Click a marker to seek without changing the paused/playing state; hover for its time and label, or use the expanded **Markers** panel for closely spaced markers. Additional chapters discovered during playback have the same editing controls; the first decision saves their original chapter evidence in the plan. Identical labels at the same time appear once. Times beyond the actual video duration remain listed but disabled. Native fullscreen displays the browser's video controls; the app's marked seek bar remains in the page. LosslessCut project-only markers must be supplied in the handoff with times relative to the exported clip, not the original recording. Previewing never rewrites markers or footage.

For embedded markers and codec details, put `ffprobe` on PATH, set `FFPROBE_PATH`, or add `"ffprobePath": "D:/Tools/ffmpeg/bin/ffprobe.exe"` to your untracked `organizer.local.json`. The environment variable takes precedence. This optional helper reads only the registered preview file, has a timeout, and runs without a console window. Failed metadata reads leave playback and imported markers available.

**Playback info** shows the codec, dimensions, frame rate, and a browser decoding-efficiency estimate when available (currently for MP4 AV1/H.264 with readable codec configuration). The app uses native HTML video so the browser can use its hardware decoder; a webpage cannot force GPU decoding or override browser/driver settings. The estimate is not proof of the decoder actually in use. In Firefox, check **Settings → General → Performance → Use hardware acceleration when available** (uncheck Use recommended performance settings to reveal it), then restart Firefox after changes. See [Firefox performance settings](https://support.mozilla.org/en-US/kb/performance-settings) and [MediaCapabilities decoding estimates](https://developer.mozilla.org/en-US/docs/Web/API/MediaCapabilities/decodingInfo). Codec support, GPU support for the particular format, and browser settings still determine playback.

The app streams original media from disk with byte-range support for seeking; it does not load whole videos into JavaScript memory, upload media, create proxies, or transcode files. Browser/OS codec support determines which files play. If a format is unsupported, use **Open in external player**. Preview URLs are temporary and only grant access to one registered clip; reopen the preview after moving the clip or restarting the app. A changed or missing source is reported instead of serving an unverified replacement.

## Writing reviewed marker changes

Move clips lists embedded renames, additions, and deletions before confirmation. A marker-only change is included even when the filename and folder stay the same. Held clips are skipped; unreviewed existing names stay original and unreviewed additions are not written. Supported containers are MP4, M4V, MOV and MKV, with FFmpeg and ffprobe required. Set FFMPEG_PATH / FFPROBE_PATH or ffmpegPath / ffprobePath in local configuration. When ffprobePath is an absolute path, its sibling ffmpeg.exe is the default writer.

The app prepares a new container with [FFmpeg stream copy](https://ffmpeg.org/ffmpeg.html#Streamcopy), verifies chapter labels and timing, stream properties, and copied packet hashes, then retains the original under Root Footage/.footage-organizer-originals/<operation>/<clip> before publishing. The original uses disk space until you deliberately remove it. Allow room for one additional copy during processing; rewriting and verification read the footage several times and are slower than a normal move. Transient container files are staged on the footage volume under .footage-organizer-work so publication can use a same-volume move. These internal folders are excluded from review inventories.

The operation journal records original and prepared identities before publication. Restart recovery inspects them without repeating a rewrite. An interrupted publication can offer **Restore original for retry** in Move history; it refuses occupied paths or changed backups. Failed preparation leaves the source untouched. A failed/interrupted run may retain a staging file for inspection. Project deletion and plan cleanup never delete these footage-volume backups or staging files. The move log records their paths.

Retained chapter start times stay fixed; chapter end times adjust to the next surviving or added marker. If deleting the start marker leaves the first MP4 chapter after zero, the writer uses the container's Nero chapter table to preserve its time. That fallback supports up to 255 chapters and 255 UTF-8 bytes per title; some players that only read QuickTime chapters may not display these markers. A container without that table fails safely and keeps the original. Use an export-only marker or retain a start chapter if your player requires it.

Imported markers without an extracted chapterIndex remain app/export-only; newly added markers embed only when explicitly selected. Export markers downloads version 2 review JSON with active `markers` and separate `deletedMarkers` audit records, not an editor-specific import or automatic sidecar update. Preview shows accepted plan labels before execution; the external player shows actual file labels. Filed marker decisions are locked; use a fresh handoff to change them later.

## Deleting projects and cleaning up plans

Inside a project's page, choose **Delete project**. The confirmation offers:

- **Keep saved plans** (default): remove the project and all its batches from the app, retaining its plan folder, notes, and move history. This makes accidental removal recoverable. Create a project with the same project ID, Root Footage, and Plan folder to reopen it.
- **Delete saved plans too**: remove the project and permanently delete its app-owned saved records. Footage stays in place, and completed moves are not reversed.

From **All projects → Clean up removed projects**, inspect retained plan folders and confirm deletion for a removed project. Cleanup only deletes known app records after checking their project identity and paths. Unrelated files are preserved, including files placed in the plan folder. Active projects, linked folders, and folders overlapping footage or app storage cannot be cleaned up. Deletion and cleanup are blocked during file moves. If cleanup fails, the removed project remains in the cleanup list for retry; records already deleted are not restored. Keep external backups if you may need permanently deleted plans later.

## Moves and recovery

- Held clips stay in place. Clips with questions start held; explicitly unchecking Hold includes them.
- Preflight detects stale sources, duplicate/existing targets, invalid Windows names, path escapes, extension changes, case-only renames, and cross-volume moves.
- The backend invokes Windows' two-argument `.NET File.Move`, which refuses an existing destination. Paths are passed as environment data into a constant PowerShell helper. All application logic is TypeScript.
- Each move records intent before execution and result afterward. Ordinary moves preserve file bytes. Accepted embedded marker changes rebuild the container with stream copy, verify chapter names/times and audio/video packet hashes, then publish the file with an original backup; no re-encoding occurs.
- A failure stops the batch. Completed files remain filed. A fresh review includes only remaining pending changes.
- Restart recovery reconciles file identities without replaying moves. Ambiguity blocks further execution. **Move history → Check recovery** retries the inspection.
- Failed saves and stale browser revisions prevent execution. Download unsaved edits before reloading after a conflict.
- Undo/redo applies to edits in this session. Reset suggestion restores the imported name and folder while preserving your note and hold status. It works after reopening. Filed placements are locked; use a fresh handoff to reorganize them.

Do not edit active state files or change media during execution. A move batch is not one atomic filesystem transaction. Metadata checks detect ordinary stale files; they are not cryptographic authenticity checks.

## Release scope

Implemented: projects/batches; project deletion with retained-plan or permanent-plan options and later cleanup; folder pickers and per-batch review inventory; structured import; stable IDs; grouped clips; editable names; drag and drop; destination selectors; proposed folders; notes; holds; held-clip follow-up exports and selective updates with conflict checks/history; autosave; edit undo/redo; reset; JSON/Markdown exports; in-app original-media playback and scrubbing; external-player launch; checked execution; progress; logs; recovery; local launcher.

Deferred: playback proxies/transcoding, analysis/transcription, marker time editing, editor-sidecar writing, Resolve integration, cross-volume transfers, case-only renames, rename cycles, automatic rollback, full-batch handoff replacement, cloud sync, and an installer. Open in player uses the Windows default media association; codec support depends on that player.

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

The [September 28 audit and refactor review](docs/AUDIT_2026-09-28.md) covers the marker workflow, large batches, shared validation, draft memory use, storage failure cleanup, performance measurements, and remaining improvement opportunities.

Regenerate the handoff schema with `npm run schema`. Convert the earlier placement proposal and inventory with:

```powershell
npm run convert:legacy -- proposal.json inventory.json "I:\...\Video" project-id output.json notes.md
```

The converter preserves IDs, creates a new handoff, and refuses to overwrite its output. It does not modify footage or original audit records.

Check a handoff without importing or moving files:

```powershell
npm run validate:handoff -- path\to\handoff.json
```
