# Footage Organizer: agent entry point

This is a local Windows app for reviewing proposed footage placements and executing user-reviewed file moves. Review agents can use any provider; no specific chat history, account, or AI integration is required.

## Preparing a handoff

1. Read [docs/AGENT_GUIDE.md](docs/AGENT_GUIDE.md) for the workflow and required inputs.
2. Read [docs/HANDOFF.md](docs/HANDOFF.md) for the versioned import contract.
3. Obtain a fresh **Download handoff kit** from the app's Handoff guide for the user's project, or an **Export project context** file plus relevant plan exports.
4. Use [docs/handoff.schema.json](docs/handoff.schema.json) and [docs/examples/handoff.v1.json](docs/examples/handoff.v1.json) to construct the output. The example contains fictional data, not project defaults.

Keep project IDs, stable clip IDs, current source paths, and the user's naming conventions. A handoff contains suggestions; preparing it does not authorize moving media or writing app state. The user reviews and executes it in the app. See the guide for unresolved questions, revised handoffs, and multiple conversations.

For held clips in an existing batch, obtain **Agent follow-up → Export held clips for review** and follow [docs/BATCH_UPDATES.md](docs/BATCH_UPDATES.md) with [docs/batch-update.schema.json](docs/batch-update.schema.json). Return a batch update tied to the exported request; do not make a duplicate batch for that follow-up.

## Changing the application

- Read [README.md](README.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- Use React/TypeScript, Express, and CSS Modules. Keep the UI focused on utility and dark by default.
- Keep reusable docs and app behavior independent of one user's name, drive letters, project, or AI provider. Machine configuration belongs in the untracked `organizer.local.json` and environment variables. Follow the current user's storage preferences for scratch files.
- `src/shared/model.ts` is the runtime handoff contract. Run `npm run schema` after changing it, update the guide and examples, and preserve explicit schema versioning.
- Run `npm run build` and `npm run lint`; run relevant tests for changes to behavior. Use disposable files to test file operations.
- Do not commit personal handoffs, project state, or media. Do not move source footage as part of implementation testing.
- When a user-facing feature benefits from a practical example, extend the feature tour in `scripts/practice-fixture.ts` and its preservation-aware upgrade script. Keep existing practice decisions and filed clips intact.

The in-app guide downloads the repository's guide, example, and schema. Keep those sources current instead of maintaining a separate protocol in UI copy.
