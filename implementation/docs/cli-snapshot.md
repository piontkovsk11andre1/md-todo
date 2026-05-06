# CLI: `snapshot`

Save implementation snapshot history at completed migration boundaries.

`snapshot` is filesystem-backed and does not require git commit metadata, a clean worktree, or revertable run artifacts.

## Global options

`--config-dir <path>` is available on every command.

- If provided, rundown uses that directory as the `.rundown` config root and skips upward discovery.
- If omitted, rundown discovers `.rundown/` by walking upward from the command start directory until it finds one.
- If discovery finds nothing, command-specific fallback behavior applies.

## Synopsis

```bash
rundown snapshot [options]
```

`rndn snapshot` is alias-equivalent.

## Options

- `--workspace <dir>`: Workspace directory to use for linked/multi-workspace resolution.

## Storage layout

Live implementation head remains:

- `implementation/`

Saved snapshots are lane-aware:

- root lane: `implementation/snapshots/root/<N>/`
- thread lane: `implementation/snapshots/threads/<thread>/<N>/`

Each written snapshot directory contains a full copy of the live `implementation/` tree (excluding `implementation/snapshots/**` so snapshots do not recursively include prior snapshots).

## Numbering and boundary rules

- Snapshot number `N` is inferred from migration completion state, not provided by the user.
- Root lane uses the highest fully completed root migration number.
- Each thread lane uses the highest fully completed migration number for that thread.
- For a migration number `N`, the lane boundary is complete only when the whole lane-number batch is complete (migration file plus review/supplementary files for `N`).
- Snapshot creation is rejected between migrations: if any lane has an incomplete latest migration batch, rundown exits with an explicit error and writes no new snapshots.

## Existing snapshot behavior

- If a target lane snapshot path for boundary `N` already exists, rundown reports it as already recorded and does not overwrite it.
- If all eligible lane snapshots already exist, the command exits with no-work.

## Examples

```bash
# Save implementation snapshots for current completed lane boundaries
rundown snapshot

# Resolve workspace explicitly in linked/multi-workspace setups
rundown snapshot --workspace ../my-workspace
```
