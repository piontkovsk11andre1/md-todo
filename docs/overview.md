# Overview

`md-todo` is a Markdown-native task runtime.

It scans Markdown, selects the next runnable unchecked task, builds a structured prompt from the document context, runs a worker command or inline CLI task, validates the result, optionally repairs it, and only then marks the checkbox complete.

## Core model

The workflow is intentionally simple:

1. **Select** the next runnable task.
2. **Execute** the task through a worker or inline CLI command.
3. **Verify** the result.
4. **Repair** and retry when verification fails.
5. **Complete** the task only after verification returns `OK`.

This makes the checkbox a consequence of successful work, not a guess.

## Sources

`md-todo` can scan:

- a single Markdown file,
- a directory,
- or a glob such as `notes/**/*.md`.

Supported task forms include:

- `- [ ] task`
- `* [ ] task`
- `+ [ ] task`

Nested tasks are supported.

## Task selection

Task selection is deterministic:

1. resolve the source into Markdown files,
2. sort those files,
3. scan each file in document order,
4. pick the first runnable unchecked task.

A task is runnable only when it has **no unchecked descendants**.

That means child tasks always run before their parent. This is what makes planning safe: once a task is decomposed into subtasks, the parent is blocked until those subtasks are completed.

## Sorting

Default sorting is `name-sort`, a human-friendly natural sort that works well for filenames such as:

- `01. Idea.md`
- `02. Plan.md`
- `10. Ship.md`

Other modes:

- `none`
- `old-first`
- `new-first`

Inside each file, tasks are always scanned from top to bottom.

## Two task types

### Agent tasks

A normal Markdown task is rendered into a prompt and sent to the configured worker command.

Example:

```md
- [ ] Rewrite the opening section so the README is clearer and more confident
```

### Inline CLI tasks

A task beginning with `cli:` is executed directly by `md-todo`.

The working directory is the directory containing the Markdown file.

Example:

```md
- [ ] cli: npm test
- [ ] cli: node scripts/build-index.js
```

If a CLI command is written in a saved Markdown file, `md-todo` treats that as explicit permission to run it.

## Runner modes

Runner mode controls how the selected task is handed off.

### `wait`

Start the worker and wait for completion.

This is the default and the strongest mode for verification and repair.

### `tui`

Start an interactive terminal session, let the user steer it, then continue verification after exit.

This works well with tools such as `opencode`.

### `detached`

Start the worker without waiting.

This mode keeps runtime artifacts on disk, skips immediate verification, and leaves the task unchecked.

## Prompt transport

Rendered prompts can be delivered in two ways.

### `file`

Write the rendered prompt to a Markdown file under `.md-todo/runs/` and pass that file to the worker.

This is the default because it is robust, especially on Windows where large prompts and shell quoting are fragile.

### `arg`

Pass the prompt directly as command arguments.

This can be useful for smaller prompts, but it is less reliable for large Markdown context.

## Runtime artifacts

Each real `run` or `plan` execution can create a per-run folder under `.md-todo/runs/`.

Typical contents include:

- `run.json`
- phase folders such as `01-execute/`, `02-verify/`, `03-repair/`
- `prompt.md`
- `stdout.log`
- `stderr.log`
- `metadata.json`

Artifacts are cleaned up by default after a successful normal run.

Use `--keep-artifacts` to preserve them.

Detached mode always keeps them.

## Validation and repair

Verification is a separate phase from execution.

After execution, `md-todo` renders the verify template and produces a task-specific sidecar file next to the source document, for example:

```text
Tasks.md.3.validation
```

If that file contains exactly `OK`, the task is considered complete.

Anything else means the task stays unchecked.

If verification fails and retries are enabled, `md-todo` renders the repair template, runs another pass, and validates again.

## Planning

`md-todo plan` expands a selected task into nested subtasks.

The planner worker should return only unchecked Markdown task items. Those items are inserted directly beneath the parent task at one indentation level deeper.

After planning, the parent task becomes blocked until its new children are complete.

## Why this model matters

Many AI workflows still depend on copy-paste handoffs and human memory.

`md-todo` replaces that with a visible, file-based loop:

- Markdown provides the intent,
- templates provide the instructions,
- workers provide execution,
- verification provides trust,
- and checkbox updates become evidence rather than optimism.
