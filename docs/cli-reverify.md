# CLI: `reverify`

Re-run verification for a previously completed task from saved run artifacts, without selecting a new unchecked task and without mutating Markdown checkboxes.

`reverify` intentionally does not acquire the per-source Markdown lock because it never writes task source files; it only reads source content to resolve historical task context.

By default, `reverify` targets the latest completed task in the current repository (`--run latest`).

Use this when you want a deterministic confidence check against an exact historical task context (for example, before a release or push) without advancing task selection.

`--worker` is optional when rundown can resolve a worker for `reverify` from `.rundown/config.json`.

`reverify` applies the same phase-aware routing rules as `run` for verify/repair/resolve/resolve-informed-repair stages.

## Global option: `--config-dir <path>`

`--config-dir <path>` is available on every command.

- If provided, rundown uses that directory as the `.rundown` config root and skips upward discovery.
- If omitted, rundown discovers `.rundown/` by walking upward from the command start directory until it finds one.
- If discovery finds nothing, command-specific fallback behavior applies.

Synopsis:

```bash
rundown reverify [options] -- <command>
rundown reverify [options] --worker <pattern>
```

Arguments:

- None.

Options:

| Option | Description |
|---|---|
| `--run <id|latest>` | Choose the artifact run to inspect for the completed task to re-verify. Default: `latest`. |
| `--last <n>` | Re-verify the last `n` completed runs. Default processing order is newest first. |
| `--all` | Re-verify all completed runs. Default processing order is newest first. |
| `--oldest-first` | Process selected runs in oldest-first order (applies to `--all` and `--last <n>`). |
| `--repair-attempts <n>` | Retry repair up to `n` times when verification fails. |
| `--resolve-repair-attempts <n>` | Retry resolve-informed repair up to `n` times after resolve diagnosis. |
| `--no-repair` | Disable repair attempts and fail immediately on verification failure. |
| `--worker <pattern>` | Worker pattern to execute verify/repair phases (preferred on PowerShell). |
| `--print-prompt` | Print the rendered verify prompt and exit `0` without running the worker. |
| `--dry-run` | Resolve the target task, render the verify prompt, print planned execution, and exit `0`. |
| `--keep-artifacts` | Keep the reverify run folder under `<config-dir>/runs/`. |
| `--ignore-cli-block` | Skip `cli` fenced-block command execution during prompt expansion. |
| `--cli-block-timeout <ms>` | Per-command timeout for `cli` fenced-block execution (`0` disables timeout). Default: `30000`. |

## Phase-aware routing behavior

For each selected historical run, `reverify` resolves workers per phase:

- verify
- repair attempt `N`
- resolve
- resolve-informed repair attempt `N`

Routing source is `run.workerRouting` in config (shared with `run` semantics).

Fallback policy is identical to `run`:

- inherited routes use normal health failover (`workers.fallbacks`),
- explicit phase routes skip fallbacks unless `useFallbacks: true` is set.

Notes:

- `reverify` does not run an execute phase and does not use the `reset` phase route.
- `--worker`/`-- <command>` still overrides config for all reverify phases.

Note: `--print-prompt` is only supported for single-run reverify. Combining it with `--all` or `--last` returns exit code `1`.

Examples:

```bash
rundown reverify
rundown reverify --all
rundown reverify --last 3
rundown reverify --last 3 --oldest-first
rundown reverify --run latest
rundown reverify --run run-20260319T222645632Z-04e84d73 --repair-attempts 2
rundown reverify --run latest --no-repair
rundown reverify --run run-20260319T222645632Z-04e84d73 --no-repair
rundown reverify --print-prompt
rundown reverify --dry-run
```
