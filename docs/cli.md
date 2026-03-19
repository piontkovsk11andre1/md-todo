# CLI

## Main commands

### `md-todo run <source>`

Scan a file, directory, or glob, select the next runnable task, execute it, verify it, optionally repair it, and mark it complete only after verification succeeds.

Examples:

```bash
md-todo run roadmap.md -- opencode run
md-todo run docs/ -- opencode run
md-todo run "notes/**/*.md" -- opencode run
```

PowerShell-safe form:

```powershell
md-todo run docs/ --worker opencode run
```

### `md-todo plan <source>`

Select a task and expand it into nested unchecked subtasks using the planner template.

Use `--at file:line` to target a specific task by source file and 1-based line number.

Example:

```bash
md-todo plan roadmap.md --at roadmap.md:12 -- opencode run
```

### `md-todo next <source>`

Show the next runnable unchecked task without executing it.

Example:

```bash
md-todo next docs/
```

### `md-todo list <source>`

List unchecked tasks across the source.

Use `--all` to include checked tasks in the output.

Example:

```bash
md-todo list .
md-todo list roadmap.md --all
```

### `md-todo artifacts`

Inspect or clean saved runtime artifact folders under `.md-todo/runs/`.

Options:

| Option | Description |
|---|---|
| `--json` | Output artifact information as JSON. |
| `--failed` | Show only failed runs. |
| `--open <runId>` | Open a specific run folder by ID (use `latest` for the most recent run). |
| `--clean` | Delete saved run folders. |
| `--clean --failed` | Delete only failed run folders. |

Examples:

```bash
md-todo artifacts
md-todo artifacts --json
md-todo artifacts --failed
md-todo artifacts --open latest
md-todo artifacts --clean --failed
```

### `md-todo init`

Create `.md-todo/` with default templates and `vars.json`.

Example:

```bash
md-todo init
```

## Worker command forms

`md-todo` separates the source to scan from the worker command that performs the task.

Preferred forms:

```bash
md-todo run <source> -- <command>
md-todo run <source> --worker <command...>
```

If both are provided, `--worker` takes precedence.

## Common options

### Verification and repair

- `--no-verify` — skip verification
- `--only-verify` — verify without executing first
- `--retries <n>` — retry repair up to `n` times
- `--no-repair` — disable repair explicitly

### Execution mode

- `--mode wait` — start the worker and wait
- `--mode tui` — start an interactive terminal session and continue after exit
- `--mode detached` — start the worker without waiting

### Prompt transport

- `--transport file` — write the rendered prompt to a runtime file and pass that file to the worker
- `--transport arg` — pass the prompt as command arguments

`file` is the default and is usually the right choice.

### Sorting

- `--sort name-sort`
- `--sort none`
- `--sort old-first`
- `--sort new-first`

### Variables

- `--var key=value` — inject a template variable
- `--vars-file path/to/file.json` — load template variables from JSON
- `--vars-file` — load `.md-todo/vars.json`

Direct `--var` entries override values loaded from `--vars-file`.

### Artifacts

- `--keep-artifacts` — keep the run folder under `.md-todo/runs/`

### Planning

- `--at file:line` — target a specific task for `plan`

### Listing

- `--all` — include checked and unchecked tasks in `list` output

### Git and hooks

These options are available on `md-todo run`.

| Option | Description | Default |
|---|---|---|
| `--commit` | Auto-commit checked task file after successful completion. | off |
| `--commit-message <template>` | Commit message template (supports `{{task}}` and `{{file}}`). | `md-todo: complete "{{task}}" in {{file}}` |
| `--on-complete <command>` | Run a shell command after successful task completion. | unset |

`--commit-message` is only applied when `--commit` is enabled.

Examples:

```bash
md-todo run docs/todos/phase-3.md --commit -- opencode run
md-todo run docs/todos/phase-3.md --commit --commit-message "md-todo: complete \"{{task}}\" in {{file}}" -- opencode run
md-todo run docs/todos/phase-3.md --on-complete "git push" -- opencode run
md-todo run docs/todos/phase-3.md --commit --on-complete "npm run release:notes" -- opencode run
```

`--commit` creates a focused commit containing only the checked Markdown file, with a structured message:

```
md-todo: complete "Rewrite the README intro" in docs/README.md
```

This makes task history searchable via `git log --grep="md-todo:"`.

`--on-complete` receives task metadata as environment variables:

| Variable | Value |
|---|---|
| `MD_TODO_TASK` | The task text |
| `MD_TODO_FILE` | Absolute path to the Markdown file |
| `MD_TODO_LINE` | 1-based line number |
| `MD_TODO_INDEX` | Zero-based task index |
| `MD_TODO_SOURCE` | The original source argument |

Both `--commit` and `--on-complete` are non-fatal: if they fail, the task is still marked complete and `md-todo` exits `0` with a warning.

When both are used, `--commit` runs first so that `--on-complete` can safely push or tag.

### Inspection and dry runs

- `--dry-run` — select the task and render the prompt, then print what command would run and exit `0` without executing, verifying, repairing, or editing Markdown files.
- `--print-prompt` — print the fully rendered prompt and exit `0` without executing the worker.

Behavior notes:

- If both flags are provided, `--print-prompt` takes precedence.
- For `run`, `--print-prompt` and `--dry-run` target the execute prompt by default.
- For `run --only-verify`, `--print-prompt` and `--dry-run` target the verify prompt instead.
- For `plan`, both flags apply to the planner prompt.

Examples:

```bash
md-todo run roadmap.md --dry-run -- opencode run
md-todo run roadmap.md --print-prompt -- opencode run
md-todo run roadmap.md --only-verify --dry-run -- opencode run
md-todo run roadmap.md --only-verify --print-prompt -- opencode run
md-todo plan roadmap.md --dry-run -- opencode run
md-todo plan roadmap.md --print-prompt -- opencode run
```

## Inline CLI tasks

If the selected task begins with `cli:`, `md-todo` executes it directly instead of sending it to the external worker.

The command runs from the directory containing the Markdown file, not the current working directory. This makes inline CLI tasks portable — they behave the same regardless of where `md-todo` is invoked from.

Example:

```md
- [ ] cli: npm test
```

## Shell guidance

### PowerShell 5.1

Prefer `--worker` because it avoids argument splitting issues around `--`.

Example:

```powershell
md-todo run docs/ --worker opencode run
```

### Large prompts on Windows

Prefer `--transport file`.

It is more robust for large Markdown context, file paths, quotes, and multiline prompts.

## Practical default for OpenCode

A clean setup is:

- `wait` mode with `opencode run`
- `tui` mode with `opencode`
- `file` transport for staged prompt files

Examples:

```bash
md-todo run roadmap.md -- opencode run
md-todo run roadmap.md --mode tui -- opencode
```

## Exit codes

- `0` — command completed successfully
- `1` — execution error
- `2` — validation failed
- `3` — no actionable target
