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

External-player launch is implemented using the Windows file association. Actual playback in Connor's chosen player and codec support have not been visually verified. Browser playback, cross-volume transfers, and automatic rollback are not included in this release.

## Dark mode and shutdown controls

The updated build, type checks, ESLint, and all 18 automated tests pass. New tests cover saving pending edits before shutdown, keeping the app running after a failed save, unregistering closed drafts, and refusing shutdown during an active move.

A separate Edge walkthrough verified dark mode with a light system preference, removal of the header strip, the raised project layout, dark review controls and dialogs, and the stop button on a narrow screen. Against a disposable app instance, a failed save blocked shutdown; retrying saved the latest filename to disk before the server exited. The Windows stop script stopped the test instance and correctly reported an already-stopped instance. No page exceptions occurred. Both desktop shortcuts are installed; the main demo server remains running for review.

## Portable handoff guide

The build, type checks, ESLint, and all 21 tests pass. The published JSON schema is checked against the live Zod model, and the standalone example passes the read-only validator. Tests cover invalid IDs/paths/names/extensions and kit exports that preserve saved decisions without mixing independent projects.

A disposable two-project browser walkthrough verified navigation saves pending edits before opening the guide, project selection, saved notes and holds in the kit, exclusion of the unrelated project, all four downloads, the readable in-app protocol, a narrow layout, and the project's Prepare handoff link. No page exceptions occurred. No main-project state or footage was changed.

## Repeated batches and Windows launcher repair

The build, TypeScript checks, ESLint, and all 22 tests pass. A new multi-batch test confirms that importing a second processing session retains the first batch's notes and holds, shares the project catalog and destination folders, and reviews only the selected batch's clips.

The Windows shortcuts were reinstalled against the repository launcher and the user's installed Node. The launch wrapper waits for startup and browser opening and reports failures. Launching the main app opened Footage Organizer in Firefox. On separate scratch data, checks verified a cold start, reopening without a duplicate server, stopping, an already-stopped result, fallback from a missing Node path, and readable errors for an invalid port and missing build. The main instance and real footage were preserved.
