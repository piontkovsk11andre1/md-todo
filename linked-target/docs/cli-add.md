# `rundown add`

Use `rundown add` to append seed text to an existing Markdown planning document, then run `plan` on that same file.

## Synopsis

```bash
rundown add "<seed-text>" "<markdown-file>" [options] -- <command>
rundown add "<seed-text>" "<markdown-file>" [options] --worker <pattern>
```

## Rules

- `<seed-text>` and `<markdown-file>` are both required positional arguments.
- `<markdown-file>` must be exactly one existing file with a `.md` or `.markdown` extension.
- Directory paths and glob inputs are rejected.
- The command appends first, then runs `plan` (single phase only).
- Appended content always starts after a blank-line boundary.
- `--mode` only accepts `wait`.
- `--dry-run` and `--print-prompt` still append content before planner execution behavior is applied.

## Options

`rundown add` supports the same plan/runtime options used by composition commands, scoped to a single `plan` phase:

- `--mode <mode>`: execution mode (`wait` only).
- `--scan-count <n>`: planning scan pass count.
- `--max-items <n>`: maximum number of generated TODO items.
- `--deep <n>`: planning depth, forwarded directly to `plan`.
- `--dry-run`: prepare execution without running planner side effects.
- `--print-prompt`: print the resolved planner prompt.
- `--keep-artifacts`: keep generated artifacts.
- `--show-agent-output`: stream agent output.
- `--trace`: enable trace diagnostics.
- `--force-unlock`: force lock release before run.
- `--vars-file <path>`: load template variables from file.
- `--var <key=value>`: set template variable (repeatable).
- `--ignore-cli-block`: skip CLI block execution.
- `--cli-block-timeout <ms>`: override CLI block timeout.
- `--worker <pattern>`: select a worker runtime pattern.
- `-- <command>`: worker command separator form (alternative to `--worker`).

## Examples

Append intent and run planning:

```bash
rundown add "Add rollback notes for failed migration steps" "migrations/119. Add command.md"
```

Append with explicit worker pattern:

```bash
rundown add "Capture edge cases for path validation" "migrations/119. Add command.md" --worker "opencode run --model gpt-5"
```

Append and preview planner prompt using separator command syntax:

```bash
rundown add "List follow-up verification tasks" "migrations/119. Add command.md" --dry-run --print-prompt -- opencode run --model gpt-5
```
