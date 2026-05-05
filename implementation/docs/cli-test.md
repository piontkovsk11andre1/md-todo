# CLI: `test`

Verify assertion specs against explicit target states and create new assertions.

Canonical action forms:

- `rundown test now` validates current implementation/materialized state.
- `rundown test future` validates prediction state.
- `rundown test new <assertion>` creates a new assertion spec.

Compatibility:

- Omitting action (`rundown test`) keeps compatibility behavior and runs in `now` mode.
- Unknown actions are rejected with guidance to `now`, `future`, and `new`.

## Global option: `--config-dir <path>`

`--config-dir <path>` is available on every command.

- If provided, rundown uses that directory as the `.rundown` config root and skips upward discovery.
- If omitted, rundown discovers `.rundown/` by walking upward from the command start directory until it finds one.
- If discovery finds nothing, command-specific fallback behavior applies.

Synopsis:

```bash
rundown test [action] [options] -- <command>
rundown test [action] [options] --worker <pattern>
```

Arguments:

- `[action]`: Optional action (`now`, `future`, `new <assertion>`).

Actions:

- omitted: verify all specs in `now` mode
- `now`: verify all specs against current implementation/materialized state
- `future`: verify all specs against prediction state
- `new <assertion>`: create a new assertion spec file

Options:

| Option | Description | Default |
|---|---|---|
| `--dir <path>` | Specs directory. | `./specs` |
| `--run` | For `test new`, create then immediately verify the new spec. | off |
| `--worker <pattern>` | Worker pattern override (alternative to `-- <command>`). | unset |

Template resolution:

- `now` mode (`test` / `test now`): `.rundown/test-materialized.md` -> `.rundown/test-verify.md` -> built-in default
- `future` mode (`test future`): `.rundown/test-future.md` -> `.rundown/test-verify.md` -> built-in default

Harness/environment hints:

- `RUNDOWN_TEST_MODE` = `materialized` or `future`
- `RUNDOWN_TEST_INCLUDED_DIRECTORIES` = JSON array of included directories
- `RUNDOWN_TEST_EXCLUDED_DIRECTORIES` = JSON array of excluded directories

Examples:

```bash
# Verify all specs in materialized mode
rundown test now

# Verify prediction at latest target
rundown test future

# Create a new assertion spec and run it immediately
rundown test new "API returns 200 for health endpoint" --run

# Compatibility (same as `test now`)
rundown test
```
