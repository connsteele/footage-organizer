# Marker editing verification — September 28, 2026

Markers now support confirmed deletion, restore, explicit Needs review / Reviewed states, and additions at a chosen time or the Preview playhead. Imported and newly discovered chapters start Needs review. Accepting a name or keeping the original marks it Reviewed; editing resets that state. User-created markers start Reviewed and offer an explicit embedded/export-only choice. Embedded changes execute with Move clips and retain the original backup.

## Verification

- 141 automated tests across 20 files pass, including new real-media writer tests. Production build, TypeScript and ESLint pass; existing dependency annotation and bundle-size warnings remain nonfatal.
- Browser checks in headless Edge covered canceling/confirming deletion, restoring, timeline removal, unchanged-name review, duplicate/end-time rejection, additions at the playhead, saved Undo/Redo, reload persistence, marker exports and chapters first discovered in Preview.
- A generated-media browser workflow executed a real move: deleted the first chapter, added one at six seconds, retained later chapter starts, excluded an export-only note, and verified the original backup byte-for-byte. The filed preview had no duplicate chapters and its edit controls were locked.
- Generated H.264/AAC MP4 and MKV fixtures exercise additions, deletions, renames, deleting all chapters, and adding the first chapter after time zero. The writer checks non-data stream packet hashes before publication. Missing FFmpeg/ffprobe causes these integration tests to skip on other installations; they ran here.
- Layout checks at 800, 1,920 and 3,840 pixel widths found no horizontal page overflow or browser exceptions. These do not establish behavior in every browser or with every codec.
- The feature tour adds lesson 12 without changing existing clips, decisions, notes, operations or other projects. A read-only check confirmed its three markers and editing controls in the running app.

## Issues caught during implementation

- FFmpeg's QuickTime chapter track can shift the first surviving chapter to zero after deleting the start chapter. The verifier caught this before publication. The writer now keeps the accurate Nero chapter table in that case; its limits and player compatibility are documented in the README. Unsupported cases fail with the original intact.
- Undoing a first decision could omit marker fields and leave stale saved decisions, or fail validation after removing discovered evidence. Draft saves now explicitly send empty arrays to clear them, with a regression test.
- A validation error could outlive a corrected Add marker dialog. Successful creation and dismissal now clear it.

The handoff import remains version 1 with rename proposals. Marker reference exports are version 2, separating active markers from deleted audit records. Agents can rename locally added/discovered markers in held follow-ups, but cannot resurrect deleted ones. Filed decisions remain locked; a fresh handoff is required for another edit pass.
