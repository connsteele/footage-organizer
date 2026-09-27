# Initial release verification

Verified locally on Windows with generated or disposable files. Real project footage was not moved, renamed, or transcoded.

- TypeScript checks and production build pass.
- ESLint passes.
- 15 automated tests pass using the installed Node 22.15 and the available Node 24.19 runtime.
- Actual Windows no-replace moves preserve file bytes. Tests cover a destination created after preflight, stale sources, duplicate targets, junction escapes, partial completion, duplicate execution requests, crash reconciliation, and ambiguous recovery.
- Handoff tests preserve all 44 fixture IDs, reject conflicting identities, and retain edits on reimport.
- Autosave tests cover edits made during an in-flight save and preservation of edits after a stale-revision conflict.
- Local API tests reject foreign origins, unexpected hosts, and mutation requests without an app session token.

An isolated Edge browser walkthrough against a separate scratch project passed:

1. Create a project through the UI and import its JSON handoff.
2. Drag a clip to a different folder and undo the change.
3. Add and edit an empty proposed folder without creating a media directory.
4. Edit a filename and a note; reload and verify both persist.
5. Navigate back while a note is unsaved; verify the navigation waits for saving.
6. Choose a destination using the selector and undo it.
7. Download Markdown and verify the edited note appears.
8. Filter to one clip, then verify final review still includes all five pending clips.
9. Execute those five moves and verify paths, held-file preservation, and locked completed rows.

The browser run reported no page exceptions. Screenshots were visually checked. The built-in browser plugin could not connect because of its trusted-path configuration, so the walkthrough used a fresh, isolated headless Edge profile rather than an existing signed-in browser session.

The everyday launcher starts the built app and recognizes an existing instance. A desktop shortcut was installed. The practice project contains six generated MP4 test patterns and remains available for Connor's demo. A converter also produced a separate handoff from the historical 44-clip inventory while preserving its IDs.

External-player launch is implemented using the Windows file association. Actual playback in Connor's chosen player and codec support have not been visually verified. Browser playback, cross-volume transfers, and automatic rollback were not included in the initial release; browser playback was added and verified below.

## Dark mode and shutdown controls

The updated build, type checks, ESLint, and all 18 automated tests pass. New tests cover saving pending edits before shutdown, keeping the app running after a failed save, unregistering closed drafts, and refusing shutdown during an active move.

A separate Edge walkthrough verified dark mode with a light system preference, removal of the header strip, the raised project layout, dark review controls and dialogs, and the stop button on a narrow screen. Against a disposable app instance, a failed save blocked shutdown; retrying saved the latest filename to disk before the server exited. The Windows stop script stopped the test instance and correctly reported an already-stopped instance. No page exceptions occurred. Both desktop shortcuts are installed; the main demo server remains running for review.

## Portable handoff guide

The build, type checks, ESLint, and all 21 tests pass. The published JSON schema is checked against the live Zod model, and the standalone example passes the read-only validator. Tests cover invalid IDs/paths/names/extensions and kit exports that preserve saved decisions without mixing independent projects.

A disposable two-project browser walkthrough verified navigation saves pending edits before opening the guide, project selection, saved notes and holds in the kit, exclusion of the unrelated project, all four downloads, the readable in-app protocol, a narrow layout, and the project's Prepare handoff link. No page exceptions occurred. No main-project state or footage was changed.

## Repeated batches and Windows launcher repair

The build, TypeScript checks, ESLint, and all 22 tests pass. A new multi-batch test confirms that importing a second processing session retains the first batch's notes and holds, shares the project catalog and destination folders, and reviews only the selected batch's clips.

The Windows shortcuts were reinstalled against the repository launcher and the user's installed Node. The launch wrapper waits for startup and browser opening and reports failures. Launching the main app opened Footage Organizer in Firefox. On separate scratch data, checks verified a cold start, reopening without a duplicate server, stopping, an already-stopped result, fallback from a missing Node path, and readable errors for an invalid port and missing build. The main instance and real footage were preserved.

## Batch continuation and status views (2026-09-27)

Build, lint, and all 24 tests passed. An isolated browser walkthrough with disposable files performed real moves, confirmed that Remaining immediately hides filed clips and retains held notes, exercised all four status filters and search, and verified that a reload defaults to Remaining. Unchanged, unfiled clips remain accessible. Dragging temporarily exposes otherwise hidden destination groups. Completed batches show an empty state with access to filed records.

The same walkthrough verified that Start next batch saves pending edits before navigation and stays in the batch when a simulated save conflict occurs. The downloaded kit contained the latest note, current catalog paths, and next clip ID. An invalid import could be retried; importing a second batch preserved the first batch, its held clips, and decisions. Layouts were checked from 800 to 3840 pixels without horizontal overflow or page exceptions. No real-project state or footage was changed.

## Review folders and held-clip follow-up (2026-09-27)

Build, type checks, lint, and all 35 automated tests pass. New checks cover optional-field compatibility, root containment, junction rejection, per-batch folders, inventory metadata and catalog membership, held-request evidence, selective updates, user-note/original preservation, persisted history, replay protection, later acceptance, revision conflicts, changed files, filed/released clips, invalid update scopes/fields/paths/extensions, busy operations, and the published update schema. Folder-picker API tests cover session protection, selection, cancellation, and initial-folder forwarding with an injected adapter.

An isolated Edge walkthrough verified project creation, folder selection/cancellation response handling, inventory kits, scoped import, export of pending held notes, invalid update retry, conflict comparison, selecting unaffected suggestions, retained notes/originals/holds, resolved questions and new rationale, history, replay blocking, stale-preview rejection and refresh, per-batch overrides, and saved project defaults. Screenshots were checked at 800, 1920, and 3840 pixels with no horizontal overflow or page exceptions. Only disposable test files were used.

The Windows native folder-dialog helper reached its dialog call, but the desktop tools did not expose a selectable window in this execution environment, so native selection/cancellation has not been visually verified. Pasted paths and the browser/API selection flow are verified. The existing user app and media were not modified during QA. Backend changes require stopping and relaunching a running built instance.

## Project deletion, cleanup, and video previews (2026-09-27)

Build, type checks, lint, and all 45 automated tests pass. New checks cover reversible project removal and reopening, permanent plan cleanup, confirmation requirements, active-project and media-folder protection, junction rejection, foreign checkpoints, unrelated-file preservation, busy operations, and retry after a cleanup failure. Media API checks cover session-protected preview creation, scoped and expiring preview URLs, unknown clips and unsupported extensions, foreign origins, byte ranges and HEAD requests, invalid ranges, changed sources, filed clips, and preview invalidation after removal or a move.

An isolated Edge walkthrough used generated H.264 footage to verify playback, seeking to a decoded frame, no autoplay, one preview at a time, resource release on collapse and before moving files, and playback from the new path after a real Windows move. An unsupported-format fixture displayed the external-player fallback; the fallback action was verified with a stub rather than launching a desktop player. Browser codec support still determines which original files can play inside the app.

The same walkthrough verified both deletion choices, the default Keep saved plans option, cancellation, resetting the default when reopening the confirmation, the removed-project list, cleanup confirmation and cancellation, permanent removal, and preservation of unrelated files and footage bytes. Screenshots were checked at 800, 1920, and 3840 pixels without horizontal overflow or page exceptions. Only disposable projects were deleted. The existing app instance and real project data were left untouched; stop and relaunch the app to load the new backend.
