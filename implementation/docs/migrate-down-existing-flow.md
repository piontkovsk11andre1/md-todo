# Existing `migrate down` flow (pre-rewrite)

This note documents the current behavior before implementing revision-boundary rewind semantics for migration 140.

## Entry points and option wiring

- CLI exposes `migrate [action] [count]` and `--run <id|latest>` for down (`implementation/src/presentation/cli.ts:393`, `implementation/src/presentation/cli.ts:400`, `implementation/src/presentation/cli.ts:405`).
- `createMigrateTask` routes `action === "down"` into `runMigrateDown(...)`, passing `downCount` and `noBacklog` (`implementation/src/application/migrate-task.ts:288`, `implementation/src/application/migrate-task.ts:304`, `implementation/src/application/migrate-task.ts:305`).
- `runId`/`--run` is defined in `MigrateTaskOptions` but is not consumed by `runMigrateDown` (`implementation/src/application/migrate-task.ts:76`, `implementation/src/application/migrate-task.ts:1049`).

## Current `runMigrateDown` algorithm

Source: `implementation/src/application/migrate-task.ts:1049`.

1. Read migration state from filesystem (`readMigrationState`).
   - If no migration files exist, emit `"No migrations found to remove."` and return `EXIT_CODE_NO_WORK` (`implementation/src/application/migrate-task.ts:1096`-`implementation/src/application/migrate-task.ts:1100`).
2. Compute removal size as run-count style input.
   - `requestedRemovalCount = max(1, floor(downCount ?? 1))` (`implementation/src/application/migrate-task.ts:1102`).
   - Select last N migration files from `stateBeforeDown.migrations` (`implementation/src/application/migrate-task.ts:1103`).
3. Snapshot removed migration contents, then delete those files from disk.
   - Reads each removed file content if present, stores `{ name, source, filePath }` (`implementation/src/application/migrate-task.ts:1109`-`implementation/src/application/migrate-task.ts:1115`).
   - Unlinks each removed file if present (`implementation/src/application/migrate-task.ts:1117`-`implementation/src/application/migrate-task.ts:1121`).
4. Optionally append removed migrations to `Backlog.md` unless `--no-backlog`.
   - Builds section format:
     - bullet `- <migration-name>`
     - fenced `md` block with trimmed prior content
   - Appends to existing backlog or initializes `# Backlog` (`implementation/src/application/migrate-task.ts:1123`-`implementation/src/application/migrate-task.ts:1145`).
5. Remove snapshot satellite files above new migration position.
   - Re-reads state, scans migration directory, deletes `snapshot` satellite files with number `> currentPosition` (`implementation/src/application/migrate-task.ts:1147`-`implementation/src/application/migrate-task.ts:1160`).
6. Build fallback migration batch source from remaining migration numbers (`implementation/src/application/migrate-task.ts:1162`-`implementation/src/application/migrate-task.ts:1168`).
7. Immediately run `runMigrateUp(...)` to re-apply/reconcile from the pruned state (`implementation/src/application/migrate-task.ts:1169`-`implementation/src/application/migrate-task.ts:1188`).
   - If up fails, return that exit code (`implementation/src/application/migrate-task.ts:1190`-`implementation/src/application/migrate-task.ts:1192`).
8. Perform post-up artifact-run lookup to infer revisions to mark unmigrated.
   - `artifactStore.listSaved(configDir)`
   - filter `commandName === "migrate" && status === "completed"`
   - `slice(0, removedMigrations.length)`
   - collect `extra.targetRevision` values (`implementation/src/application/migrate-task.ts:1194`-`implementation/src/application/migrate-task.ts:1199`, `implementation/src/application/migrate-task.ts:1211`-`implementation/src/application/migrate-task.ts:1227`).
9. For each inferred revision, call `markRevisionUnmigrated(...)` and emit info (`implementation/src/application/migrate-task.ts:1200`-`implementation/src/application/migrate-task.ts:1206`).

## `removePromotedBacklogItems` helper (current behavior)

Source: `implementation/src/application/migrate-task.ts:1262`.

- This helper is currently used during migrate planning/up flow (when promoted backlog items become concrete migration files), not in `runMigrateDown` (`implementation/src/application/migrate-task.ts:805`).
- It reads `Backlog.md` and removes matching entries via `stripBacklogEntries(...)` by:
  - normalized migration name match (`promotedNames`), or
  - normalized fenced-content match (`promotedContents`) (`implementation/src/application/migrate-task.ts:1289`-`implementation/src/application/migrate-task.ts:1336`).
- Matching is done on top-level list entry ranges outside code fences; then matching ranges are removed and file is rewritten if changed (`implementation/src/application/migrate-task.ts:1295`-`implementation/src/application/migrate-task.ts:1351`).

## Artifact-run lookup currently used by down

- The lookup in down is metadata-based only; it does not target specific migration files.
- It assumes the first `N` saved completed migrate runs correspond to removed migrations (`slice(0, removedMigrations.length)`), then extracts `extra.targetRevision`.
- This is run-order based and not revision-boundary aware (`implementation/src/application/migrate-task.ts:1194`-`implementation/src/application/migrate-task.ts:1199`).

## Git-revert path status

- `runMigrateDown` does **not** call git revert/reset directly.
- The existing git revert implementation lives in `revert-task`:
  - resolves revertable runs from artifact metadata (`extra.commitSha` / `extra.preResetRef`) (`implementation/src/application/revert-task.ts:636`, `implementation/src/application/revert-task.ts:706`),
  - runs `git revert <sha> --no-edit` in revert mode (`implementation/src/application/revert-task.ts:430`),
  - or `git reset --hard ...` in reset mode (`implementation/src/application/revert-task.ts:486`, `implementation/src/application/revert-task.ts:494`).
- `runMigrateDown` currently uses prune+re-run behavior (`runMigrateUp`) rather than delegating to this git-revert path.

## Net effect of current model

- Down semantics are based on the count of migration files at the tail of `migrations/`, not design revision boundaries.
- It performs file deletion + optional backlog append + snapshot prune + migrate-up replay.
- Revision metadata reconciliation is indirect (artifact lookup + `markRevisionUnmigrated`) and not tied to per-revision migration provenance lists.
