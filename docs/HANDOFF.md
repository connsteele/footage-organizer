# Handoff guide for footage review chats

Prepare a versioned JSON handoff after reviewing clips and suggesting names and destinations. Do not move clips while preparing it.

Start with the [agent quick start](AGENT_GUIDE.md) if this is a new conversation. This contract is independent of the user's name, AI provider, and local drive layout. The app's **Handoff guide → Download handoff kit** bundles the instructions, schema, example, and selected project's saved context in one Markdown file.

## Project context

Use a freshly downloaded handoff kit or **Export project context** file. A local agent can also read the registered project's current `state.json` without modifying it. These identify the project, footage root, naming preferences, clip catalog, and next available ID. Kits include saved batch decisions too; context-only exports need a separate plan export when continuing an existing review.

The catalog includes previously imported clips, not every file on disk. Obtain the actual new clip paths and review material separately. `nextClipId` is the current maximum plus one (1 for an empty catalog), not a reserved allocation. A saved proposal is not evidence that the source was moved. Read current paths from the catalog and export new context after moves.

Paths and proposed folders are relative to the footage root, with `/` separators. No drive letters or `..` segments. The app's registered root controls where operations are allowed.

**Root Footage** is the project's permanent library. **Review Footage** is this batch's incoming folder inside that root. When the kit has `reviewInventory`, use its root-relative file paths and real size/timestamp values; copy `reviewInventory.folder` to `reviewFolder`. Files marked with `existingClipId` are already tracked; leave them out of a new batch unless explicitly asked to reorganize them. Use the held-clip update workflow for an existing batch. The inventory is a scoped disk listing, not video analysis. When importing through the kit page, the selected Review Footage folder takes precedence; every source must be inside it.

Reuse existing project clip IDs. New clips take IDs above the existing maximum. Never renumber due to sorting or changed placement. Current paths must match the catalog. Each new handoff needs new `handoffId` and `batchId` values (letters, digits, hyphens, underscores; at most 80 characters).

Handoff and batch IDs become saved filenames. Do not use Windows device names such as `CON`, `NUL`, `COM1`, or `LPT1`, or reuse an existing ID with different capitalization. The importer rejects extension changes: keep the source file's extension in every proposed filename.

## Example

```json
{
  "schemaVersion": 1,
  "handoffId": "review-2026-09-27-01",
  "projectId": "my-review",
  "batchId": "cut-clips-2026-09-27",
  "title": "Opening chapter — cut clips",
  "createdAt": "2026-09-27T06:00:00.000Z",
  "reviewNotes": "Reviewed sampled frames and markers. Audio was not reviewed.",
  "folders": ["Narrative/Opening", "Gameplay/Exploration"],
  "clips": [
    {
      "id": 1,
      "source": {
        "relativePath": "_cut/Original clip.mp4",
        "size": 12345678,
        "mtimeMs": 1790488800000
      },
      "duration": 42.5,
      "markers": [{ "seconds": 12.25, "label": "Character entrance" }],
      "proposed": {
        "filename": "Chapter 01 Character entrance.mp4",
        "folder": "Narrative/Opening"
      },
      "rationale": "Establishes the character's role in the opening.",
      "questions": [],
      "hold": false
    }
  ]
}
```

Example metadata values are illustrative. Read actual metadata for real handoffs. `size` is bytes; `mtimeMs` is milliseconds since the Unix epoch; duration and marker times are seconds. Marker times must be relative to the supplied clip, not its original uncut recording. The preview combines these markers with readable embedded chapters. Reviewed embedded changes are written only when the user confirms Move clips. Users can also add or delete markers in the app; this handoff contract still carries original evidence and separate rename proposals. Include project-only editing markers in the handoff if they were not embedded in the exported clip.

`markers` records **original evidence**, including optional stable `id` and extracted `chapterIndex`. Review those markers and the surrounding footage **before** proposing the clip filename. The optional `markerProposals: {schemaVersion: 1, items: [...]}` extension carries markerId, originalLabel, seconds, proposedLabel and rationale for each suggested rename. Preserve original labels/times; copy chapterIndex only from extracted embedded chapters. See [Reviewing marker names](AGENT_GUIDE.md#reviewing-marker-names) for the complete workflow.

A separate [example file](examples/handoff.v1.json) shows both a ready clip and a held clip. It is fictional and must not be imported unchanged into a real project.

## Fields

| Field                                                     | Requirement                                                                                                                               |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`                                           | Exactly `1`                                                                                                                               |
| `handoffId`, `projectId`, `batchId`, `title`, `createdAt` | Required; creation time is an ISO UTC timestamp                                                                                           |
| `clips`                                                   | 1–10,000 records with unique IDs and source paths                                                                                         |
| `id`                                                      | Positive integer, stable within the project                                                                                               |
| `source.relativePath`                                     | Required current path relative to the footage root                                                                                        |
| `source.size`, `source.mtimeMs`                           | Recommended review-time metadata; omit only when unavailable and explain the limitation                                                   |
| `duration`                                                | Optional number or null                                                                                                                   |
| `markers`                                                 | Optional original markers: `{seconds, label, id?, chapterIndex?}`                                                                         |
| `markerProposals`                                         | Optional `{schemaVersion: 1, items: [{markerId, originalLabel, seconds, proposedLabel, rationale}]}`; preserve originals.                 |
| `proposed.filename`                                       | Required full filename with the original extension; use the actual name when unchanged                                                    |
| `proposed.folder`                                         | Required relative folder; `""` means the media root                                                                                       |
| `rationale`                                               | Optional explanation                                                                                                                      |
| `questions`                                               | Optional unresolved questions; any questions start the clip held                                                                          |
| `hold`                                                    | Optional explicit hold, default false                                                                                                     |
| `folders`                                                 | Optional folder groups, including empty groups                                                                                            |
| `reviewNotes`                                             | Optional audit, decisions, and review limitations                                                                                         |
| `reviewFolder`                                            | Optional folder relative to Root Footage; `""` selects the root. Include the kit's folder for new batches. All sources must be inside it. |

The [JSON schema](handoff.schema.json) is generated from the model used by the backend. Import checks supplied review metadata. Changed sources remain visible but cannot move from that batch; produce a fresh handoff after reviewing them.

When metadata is omitted, the app captures current identity at import. This establishes a new baseline; it does not verify that files match an older review. State that limitation in the notes.

One file gets one physical destination. Preserve secondary uses in rationale, questions, notes, and markers. Do not invent uncertain chapter numbers: flag and hold the clip.

## Validate before delivery

Save one UTF-8 JSON object without Markdown fences or comments. The file must be below 8 MB. If the repo is available, run:

```text
npm run validate:handoff -- path/to/handoff.json
```

The validator reads the handoff without importing or moving anything. The schema validates structure; additional rules validate paths, unique IDs/sources, filenames, and preservation of the original extension. Filesystem and catalog checks still happen in the app. Regenerate the published schema with `npm run schema` when changing the runtime model.

Use relative paths with `/` separators and no leading slash, drive letter, empty segment, `.` or `..`. `reviewFolder`, `proposed.folder`, and entries in `folders` may be `""` for the media root. Filenames and folder segments must be valid Windows names: no reserved device names, `< > : " / \\ | ? *`, control characters, or trailing dot/space. Each segment is at most 255 characters. Compare source paths without case sensitivity when checking duplicates.

Keep the original extension, including when leaving a name unchanged. Avoid case-only renames and overlapping destination names. The app currently supports regular files on the same volume, not copies, transcoding, cross-volume transfers, linked paths, or automatic rollback. A JSON schema alone cannot prove that a file exists or a target is available.

## Reimports and revisions

Reimporting a handoff ID reopens the existing saved batch without replacing edits, even if the incoming content changed. A different handoff cannot reuse a batch ID. Revised handoffs need new IDs and current source paths. Merging into an edited batch or automatically replacing an older pending batch is not supported. Preserve the user's decisions when revising a proposal and identify which earlier batch it revises in `reviewNotes`.

To revisit held clips within the same batch, use **Agent follow-up → Export held clips for review** instead. Return the separate [batch-update format](BATCH_UPDATES.md) with the saved request ID. **Import batch update** previews selected suggestions, checks conflicts, preserves notes/history, and keeps clips held. This does not create a new batch. Full-batch replacement through a normal handoff remains unsupported.

## Delivery

Give the user the JSON and a readable Markdown explanation with matching clip IDs. Name the registered project it belongs to. The user imports, edits, and executes in the app. A second agent review is optional.

For reviewing saved app edits, use **Export plan** and **Export Markdown**. The exported plan includes current and original values but intentionally has a different structure from the import handoff. Context exports, kits, saved plans, and Markdown summaries are not import handoffs.
