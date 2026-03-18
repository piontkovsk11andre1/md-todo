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

Example:

```bash
md-todo list .
md-todo list --all roadmap.md
```

### `md-todo artifacts`

Inspect or clean saved runtime artifact folders under `.md-todo/runs/`.

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

### Git and hooks

- `--commit` — auto-commit the checked file after task completion
- `--commit-message <template>` — custom commit message (supports `{{task}}`, `{{file}}` placeholders)
- `--on-complete <command>` — run a shell command after successful task completion

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

- `--dry-run` — show what would happen without executing it
- `--print-prompt` — print the rendered prompt and exit

## Legacy aliases

Legacy verification and repair flag names remain supported:

- `--validate` → `--verify`
- `--no-validate` → `--no-verify`
- `--only-validate` → `--only-verify`
- `--no-correct` → `--no-repair`

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
