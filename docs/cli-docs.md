# CLI: `docs` (alias for `design`)

`rundown docs` is available as an alias for the `rundown design` command family.

Both command names are fully supported; `rundown design` is the canonical form used throughout the documentation.

## Global option: `--config-dir <path>`

`--config-dir <path>` is available on every command.

- If provided, rundown uses that directory as the `.rundown` config root and skips upward discovery.
- If omitted, rundown discovers `.rundown/` by walking upward from the command start directory until it finds one.
- If discovery finds nothing, command-specific fallback behavior applies.

Synopsis:

```bash
rundown docs <subcommand> [options]
```

Arguments:

- `<subcommand>`: One of `release`, `publish`, `diff [target]`, or `save`.

Options:

- `release` and `publish` accept `--dir <path>`, `--workspace <dir>`, and `--label <text>`.
- `diff [target]` accepts `[target]`, `--dir <path>`, `--workspace <dir>`, `--from <rev|current>`, and `--to <rev|current>`.
- `save` is removed and accepts no runtime options.

Examples:

```bash
# Alias for design release
rundown docs release --label "snapshot"

# Alias for design publish
rundown docs publish

# Alias for design diff
rundown docs diff preview
```

## `rundown docs release`

Alias for `rundown design release`.

Behavior:

- Executes the same release flow as `rundown design release`.
- Accepts the same options as `design release` (`--dir`, `--workspace`, `--label`).

## `rundown docs publish`

Alias for `rundown design release`.

Behavior:

- Executes the same release flow as `rundown design release`.
- Accepts the same options as `design release` (`--dir`, `--workspace`, `--label`).

## `rundown docs diff [target]`

Alias for `rundown design diff [target]`.

Behavior:

- Executes the same diff flow as `rundown design diff`.
- Accepts the same argument/options as `design diff` (`[target]`, `--dir`, `--workspace`, `--from`, `--to`).

## `rundown docs save`

Removed subcommand.

Behavior:

- Fails with an actionable error.
- Does not execute any release operation.

Use `rundown design release` or `rundown docs publish` instead.

See also:

- Canonical command docs: [cli-design.md](cli-design.md).
- Top-level CLI index: [cli.md](cli.md).

Examples:

```bash
# Canonical form
rundown design release

# Equivalent alias
rundown docs release

# Canonical diff
rundown design diff preview

# Equivalent alias
rundown docs diff preview
```
