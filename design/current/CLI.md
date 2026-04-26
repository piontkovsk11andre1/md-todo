# CLI Commands

Full command surface of `rundown` / `rd`.

## Execution commands

### `run <source>`
Execute tasks from a Markdown file, directory, or glob. Selects next unchecked task, executes via worker, verifies, repairs on failure, marks complete.

Key options: `--all`, `--verify`, `--repair-attempts`, `--commit`, `--revertable`, `--rounds`, `--sort`, `--worker`, `--vars-file`, `--trace`

### `materialize <source>`
`run --all --revertable` convenience wrapper. Keeps commit metadata and artifacts aligned for reversal flows.

### `call <source>`
Run a single named task by index or text match.

### `do <task-text>`
Execute a one-off inline task without a file.

### `loop <source>`
Repeatedly run tasks until source is fully checked or an error occurs.

## Planning commands

### `plan <source>`
Generate unchecked TODO items using a planner worker. Scan-based with convergence detection. Supports `--scan-count`, `--deep`, `--mode`, `--dry-run`.

### `research <source>`
Research-oriented worker invocation. Produces output without executing tasks.

### `explore <source>`
Exploration pass — combines planning and research.

## Prediction workflow commands

### `start "<description>"`
Scaffold a prediction-oriented project workspace. Creates `design/current/`, `migrations/`, `specs/`, `AGENTS.md`, `.rundown/`. Persists bucket placement to `config.json`.

### `migrate [action]`
Run the design→migration convergence loop, or execute a specific action:
- *(omitted)*: full loop until planner returns `DONE`
- `up`: execute pending migrations, write `N.1 Snapshot.md` checkpoint
- `down [n]`: remove last n migrations, prune snapshots, optionally append to `Backlog.md`, regenerate snapshot

### `design release`
Snapshot `design/current/` to next immutable `design/rev.N/`. No-op if content unchanged.

### `design diff [target]`
Show revision diff. Shorthand targets: `current`, `preview`. Explicit: `--from rev.N --to current`.

### `test [source]`
Verify specs against workspace state. `--future` mode evaluates against predicted migration state. `--future <n>` targets prediction at migration n.

## Review commands

### `discuss <source>`
Launch interactive TUI discussion session with worker against a file.

### `query <source>`
Non-interactive single-turn worker query.

### `next <source>`
Show what the next runnable task would be without executing.

### `list <source>`
List unchecked tasks. `--all` includes checked tasks.

### `log`
Show run history and session traces.

## Maintenance commands

### `undo`
Semantically reverse the most recent task outcome using saved artifacts.

### `revert <source>`
Revert revertable task commits.

### `reverify <source>`
Re-run verification pass on already-completed tasks.

### `repair <source>`
Run repair pass on a task without full execution.

### `unlock <source>`
Release stuck file locks.

### `init`
Initialize `.rundown/` config directory in current project.

### `with <harness>`
Configure worker harness from preset (opencode, claude, gemini, etc.) and persist to `config.json`.

### `config <action>`
Get/set/unset config values by key path. Supports `--scope local|global`.

### `workspace`
Manage linked workspace metadata.

### `migrate memory-clean`
Clean outdated memory entries from migration workspace.

### `migrate memory-validate`
Validate memory entries against current state.

### `migrate memory-view`
View current memory contents.

### `worker-health`
Show worker health status and cooling-down state.

## Global options

- `--config-dir <path>` — explicit `.rundown/` config root, bypasses upward discovery
- `--agents` — print AGENTS.md guidance to stdout and exit (root-level only)
