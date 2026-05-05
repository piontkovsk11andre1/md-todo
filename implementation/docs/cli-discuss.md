# CLI: `discuss`

Start a discussion session for a specific Markdown file.

## Global option: `--config-dir <path>`

`--config-dir <path>` is available on every command.

- If provided, rundown uses that directory as the `.rundown` config root and skips upward discovery.
- If omitted, rundown discovers `.rundown/` by walking upward from the command start directory until it finds one.
- If discovery finds nothing, command-specific fallback behavior applies.

Synopsis:

```bash
rundown discuss <file.md> [options] -- <command>
rundown discuss <file.md> [options] --worker <pattern>
```

`discuss` opens a file-oriented discussion session (default `--mode tui`) without executing implementation work.

`discuss <file.md>` always targets the file itself. The rendered prompt includes the full source snapshot, lightweight task context (using the next unchecked task when present, or a file-level anchor when none exist), and one related-artifacts list for that file.

Related artifacts are discovered by file association, not by selecting a target run.

`--worker` is optional when rundown can resolve a worker for `discuss` from `.rundown/config.json`.

By default, `discuss` is conversational and non-mutating: the agent analyzes the file with the selected task as an anchor, answers questions, and can reference prior file-level run history. The agent should not edit source Markdown unless the user explicitly requests edits (for example rewriting wording, splitting tasks, or adding sub-items). `discuss` does not mutate checkbox completion state.

Arguments:

| Argument | Description |
|---|---|
| `<file.md>` | Markdown file to discuss. |

Options:

| Option | Description | Default |
|---|---|---|
| `--mode <tui|wait>` | Discussion worker mode. `tui` opens an interactive terminal UI; `wait` runs non-interactively. | `tui` |
| `--sort <name-sort|none|old-first|new-first>` | Source ordering strategy before task selection. | `name-sort` |
| `--dry-run` | Resolve task + render discuss prompt, print planned execution, and exit `0` without running worker. | off |
| `--print-prompt` | Print rendered discuss prompt and exit `0` without running worker. | off |
| `--keep-artifacts` | Keep discuss run artifacts under `<config-dir>/runs/` even on success. | off |
| `--trace` | Write structured trace events to `<config-dir>/runs/<id>/trace.jsonl` and mirror to `<config-dir>/logs/trace.jsonl`. | off |
| `--vars-file [path]` | Load template variables from JSON (default path: `<config-dir>/vars.json`). | unset |
| `--var <key=value>` | Inject template variables (repeatable). | none |
| `--ignore-cli-block` | Skip `cli` fenced-block command execution during prompt expansion. | off |
| `--cli-block-timeout <ms>` | Per-command timeout for `cli` fenced-block execution (`0` disables timeout). | `30000` |
| `--show-agent-output` | Show discussion worker stdout/stderr transcript output during the discuss session (hidden by default). | off |
| `--force-unlock` | Remove stale source lockfile before acquiring discuss lock. Active locks held by live processes are not removed. | off |
| `--worker <pattern>` | Worker pattern override (preferred on PowerShell). | unset |

Examples:

```bash
rundown discuss roadmap.md
rundown discuss tasks.md --mode wait
rundown discuss roadmap.md --print-prompt
rundown discuss roadmap.md --dry-run
```
