# CLI: Root `rundown`

Run root `rundown` with no subcommand and no positional arguments to open the root TUI when possible.

Use root no-arg mode for interactive command discovery and menu-driven navigation before running task commands.

## Global option: `--config-dir <path>`

`--config-dir <path>` is available on every command.

- If provided, rundown uses that directory as the `.rundown` config root and skips upward discovery.
- If omitted, rundown discovers `.rundown/` by walking upward from the command start directory until it finds one.
- If discovery finds nothing, command-specific fallback behavior applies.

Synopsis:

```bash
rundown
```

`rndn` is alias-equivalent.

Arguments:

- None.

Options:

- In interactive terminals (`stdout` and `stderr` are TTY), rundown launches the root TUI.
- If TTY is unavailable (for example CI or piped output), rundown falls back to static Commander help and exits `0`.
- Use `rundown agent` for the previous no-args interactive agent-help flow.
- Explicit subcommands keep their normal behavior.

Examples:

```bash
# Interactive terminal: opens the root TUI
rundown

# Previous no-args interactive agent-help flow
rundown agent

# Deterministic static help output (non-interactive)
rundown --help
```

`rndn` is alias-equivalent for each invocation above.
