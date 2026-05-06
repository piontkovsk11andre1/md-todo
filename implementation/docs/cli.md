# CLI

`rundown` and `rndn` are both supported executable names. `rndn` is a strict alias of `rundown` (same entrypoint, commands, flags, output, and exit codes). Examples below use `rundown` as the canonical form unless noted.

## Global options

`--config-dir <path>` is available on every command.

- If provided, rundown uses that directory as the `.rundown` config root and skips upward discovery.
- If omitted, rundown discovers `.rundown/` by walking upward from the command start directory until it finds one.
- If discovery finds nothing, command-specific fallback behavior applies (for example, `init` creates one locally).

Examples:

```bash
# Monorepo: run from a package, but keep shared rundown config at repo root
cd packages/api
rundown --config-dir ../../.rundown run TODO.md

# CI: use a workspace-mounted config outside the repo checkout
rundown --config-dir /workspace/rundown-config run docs/todos.md
```

### `rundown`

Running `rundown` with no subcommand and no positional arguments opens the root TUI when possible.

See the command-focused reference: [cli-root.md](cli-root.md).

Behavior:

- In an interactive terminal (`stdout` and `stderr` are TTY), rundown launches the root TUI.
- If TTY is unavailable (for example CI or piped output), rundown falls back to static Commander help and exits `0`.
- Use `rundown agent` for the previous no-args interactive agent-help flow.
- This no-arg behavior applies only to root startup and does not change explicit subcommands.

Compatibility notes:

- `rundown --help` remains deterministic and non-interactive.
- `rundown <invalid-command>` keeps normal Commander error/help behavior.
- Explicit subcommands (`rundown run ...`, `rundown plan ...`, etc.) are unchanged.

Examples:

```bash
# Interactive terminal: opens the root TUI
rundown

# Previous no-args interactive agent-help flow
rundown agent

# Deterministic static help output
rundown --help
```

`rndn` is alias-equivalent for each invocation above.

### `rundown agent`

Use `rundown agent` as the explicit command for interactive agent help (the behavior previously reached by running root `rundown` with no args).

See the command-focused reference: [cli-agent.md](cli-agent.md).

## Main commands

### Terminal timestamps

Human-readable CLI output uses deterministic local-time ISO-8601 timestamps (with numeric UTC offset) where rundown emits command-level lifecycle lines.

- Timestamp format: bracketed local ISO-8601 with numeric offset (`[YYYY-MM-DDTHH:mm:ss.sss+/-HH:MM]`).
- Presentation points: `info`, `warn`, `error`, `success`, `progress`, `group-start`, and `group-end` terminal lines.
- Display timestamps are localized for operator readability; persisted artifact/global log timestamps (`startedAt`/`completedAt` and JSONL `ts`) remain UTC for machine-oriented interoperability.
- Nested/grouped output preserves existing grouping prefixes; timestamps are additive and appear after group markers.
- Task/detail listing payloads (`task` events) and raw worker transcript text (`text`/`stderr`) keep their existing shape.
- Text output is human-oriented and may evolve; for machine consumers, use `--json` on supported commands.

### Auto-compact follow-up exit semantics

Commands that expose `--compact-before-exit` run compaction only after the primary command has already reached success.

- If the primary command fails or exits no-work, auto-compaction does not run and the primary exit code is preserved.
- If the primary command succeeds and auto-compaction succeeds (or reports no-work), the command exits `0`.
- If the primary command succeeds but requested auto-compaction fails, rundown reports the compaction failure as a follow-up error and exits `1`.

### `rundown start [design-dir] [workdir]`

See the command-focused reference: [cli-start.md](cli-start.md).

Quick semantics:

- `rundown start`: local bootstrap in current directory when safe.
- `rundown start <design-dir>`: adopt/bootstrap that directory as design input.
- `rundown start <design-dir> <workdir>`: keep design input in first path and place controlling rundown state in second path.
- Safety gate: non-empty local design directories require an explicit outer workdir (for example, `rundown start . ..\myproject-rundown`).

### `rundown migrate [action]`

See the command-focused reference: [cli-migrate.md](cli-migrate.md).

### `rundown run <source>`

See the command-focused reference: [cli-run.md](cli-run.md).

### `rundown all <source>`

Runs the full-task variant directly (equivalent to `rundown run <source> --all`).

See the command-focused reference: [cli-all.md](cli-all.md).

### `rundown call <source>`

See the command-focused reference: [cli-call.md](cli-call.md).

### `rundown materialize <source>`

See the command-focused reference: [cli-materialize.md](cli-materialize.md).

### `rundown snapshot`

Save implementation snapshot history at completed migration boundaries.

- Snapshot roots are lane-aware:
  - `implementation/snapshots/root/<N>/`
  - `implementation/snapshots/threads/<thread>/<N>/`
- Snapshot number `N` is derived from the highest fully completed migration batch in each lane (including lane-number reviews/supplementary files), not from user input.
- The copied payload is the full current `implementation/` tree for every written lane snapshot (excluding `implementation/snapshots/**` to avoid recursive copies).
- If any lane is between migration boundaries (latest lane batch not fully completed), `snapshot` fails with an explicit error and writes nothing.
- If an eligible lane snapshot already exists, rundown reports it and does not overwrite it.

See the command-focused reference: [cli-snapshot.md](cli-snapshot.md).

### `rundown loop <source>`

See the command-focused reference: [cli-loop.md](cli-loop.md).

### `rundown discuss <file.md>`

See the command-focused reference: [cli-discuss.md](cli-discuss.md).

### `rundown reverify`

See the command-focused reference: [cli-reverify.md](cli-reverify.md).

### `rundown revert`

See the command-focused reference: [cli-revert.md](cli-revert.md).

### `rundown undo`

See the command-focused reference: [cli-undo.md](cli-undo.md).

### `rundown test [action]`

See the command-focused reference: [cli-test.md](cli-test.md).

### `rundown plan <markdown-file>`

See the command-focused reference: [cli-plan.md](cli-plan.md).

### `rundown explore <markdown-file>`

See the command-focused reference: [cli-explore.md](cli-explore.md).

### `rundown make <seed-text> <markdown-file>`

See the command-focused reference: [cli-make.md](cli-make.md).

### `rundown do <seed-text> <markdown-file>`

See the command-focused reference: [cli-do.md](cli-do.md).

### `rundown query <text>`

See the command-focused reference: [cli-query.md](cli-query.md).

### `rundown memory-view <source>`

See the command-focused reference: [cli-memory-view.md](cli-memory-view.md).

### `rundown memory-validate <source>`

See the command-focused reference: [cli-memory-validate.md](cli-memory-validate.md).

### `rundown memory-clean <source>`

See the command-focused reference: [cli-memory-clean.md](cli-memory-clean.md).

### `rundown worker-health`

See the command-focused reference: [cli-worker-health.md](cli-worker-health.md).

### `rundown unlock <source>`

See the command-focused reference: [cli-unlock.md](cli-unlock.md).

### `rundown workspace`

See the command-focused reference: [cli-workspace.md](cli-workspace.md).

### `rundown next <source>`

See the command-focused reference: [cli-next.md](cli-next.md).

### `rundown list <source>`

See the command-focused reference: [cli-list.md](cli-list.md).

### `rundown artifacts`

See the command-focused reference: [cli-artifacts.md](cli-artifacts.md).

### `rundown log`

See the command-focused reference: [cli-log.md](cli-log.md).

### `rundown init`

See the command-focused reference: [cli-init.md](cli-init.md).

### `rundown with <harness>`

Use this to apply known harness presets into local config. For `opencode`, if local `workers.default`, `workers.tui`, or `workers.fallbacks` already exist and would be changed, `with` asks for confirmation first; declining leaves config unchanged, and non-interactive runs fail instead of silently overwriting.

See the command-focused reference: [cli-with.md](cli-with.md).

### `rundown config`

See the command-focused reference: [cli-config.md](cli-config.md).

### `rundown research <markdown-file>`

See the command-focused reference: [cli-research.md](cli-research.md).

## Source file locking

`rundown` uses per-source lockfiles to prevent concurrent writes to the same Markdown file.

- Lock path: `<source-dir>/.rundown/<basename>.lock`
- Lock payload: JSON metadata with holder `pid`, command name, start time, and source path

Lock location strategy:

- Lockfiles remain source-relative even when `--config-dir` points elsewhere or config discovery resolves to a parent directory.
- `--config-dir` does not move lockfiles; it only controls configuration/template/vars/artifact/log roots.

Lock scope by command:

- `run`: acquires before task-selection reads and holds through the full task lifecycle, including `--all` loops, verification/repair, checkbox updates, and `--on-complete`/`--on-fail` hooks.
- `plan`: acquires before planning starts and holds for the full scan loop until planning finalization completes.
- `explore`: acquires phase locks in sequence (`research` lock first, then `plan` lock).
- `make`: acquires phase locks in sequence (`research` lock first, then `plan` lock) while running create -> research -> plan.
- `research`: acquires before reading the source and holds through worker invocation plus document replacement/guard checks.
- `revert`: acquires before git undo operations for the target source set and releases after undo processing finishes.
- `discuss`: acquires before task-selection reads and holds for the full discussion lifecycle, including worker invocation and finalization.
- `list`, `next`, and `reverify`: no exclusive source lock (read-only behavior).

Stale lock detection:

- If lockfile exists and holder PID is still running, lock acquisition fails fast with holder details.
- If lockfile exists but holder PID is no longer running, the lock is treated as stale and can be removed.

Stale lock recovery:

- `run`, `plan`, `research`, `make`, and `explore` support `--force-unlock` to remove stale lockfiles before normal lock acquisition. Live-process locks are never removed by this flag.
- `unlock` provides manual stale-lock cleanup for one source file at `<source-dir>/.rundown/<basename>.lock`.

`unlock` exit behavior:

- `0`: stale lock removed
- `1`: lock held by live process (no change)
- `3`: no lockfile found at `<source-dir>/.rundown/<basename>.lock`

## Global output log (JSONL)

`rundown` also defines a process-wide append-only JSONL stream at `<config-dir>/logs/output.jsonl`.

When `--trace` is enabled on `run`, `discuss`, `reverify`, or `plan`, each artifact trace event (including LLM/worker-derived stages such as `agent.signals`, `agent.thinking`, and `analysis.summary`) is also appended to `<config-dir>/logs/trace.jsonl` as a cumulative stream.

For `force:` retries in `run`, each retry attempt creates a separate artifact run with a distinct run identifier (`runId` in docs, serialized as `run_id` in trace records). Attempts are separate runs (N retries => N runs), not sub-attempts inside one run. The new attempt emits a `force.retry` event carrying `previous_run_id` and `previous_exit_code` so trace consumers can correlate attempts to the prior run.

Promtail note: configure this file as a scrape target to ingest a single cumulative CLI output stream across all runs.

First-iteration constraints: rundown does not implement built-in rotation or compression for this file, and it does not backfill older run output into this global stream. Manage retention with external log rotation or downstream pipeline policy.

Each line is one JSON object with these stable fields:

| Field | Type | Description |
|---|---|---|
| `ts` | `string` | Event timestamp in ISO-8601 UTC format. |
| `level` | `"info" \| "warn" \| "error"` | Severity level for the rendered event. |
| `stream` | `"stdout" \| "stderr"` | Logical stream classification for sink routing. |
| `kind` | `string` | Stable event kind label from rundown output semantics. |
| `message` | `string` | Plain-text message payload for the event. |
| `command` | `string` | Top-level CLI command name (for example `run`, `reverify`, `plan`). |
| `argv` | `string[]` | Full CLI argument vector for the invocation (excluding node runtime executable paths). |
| `cwd` | `string` | Process current working directory for the invocation. |
| `pid` | `number` | Process identifier for the CLI invocation. |
| `version` | `string` | Rundown CLI version string. |
| `session_id` | `string` | Invocation-scoped unique identifier used to correlate entries from one CLI session. |

