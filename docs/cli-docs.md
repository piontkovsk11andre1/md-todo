# CLI: `docs` (deprecated alias)

`rundown docs` remains available as a compatibility alias for design revision commands during migration.

Use `rundown design ...` as the canonical command family for all new scripts and documentation.

## `rundown docs release`

Deprecated alias for `rundown design release`.

Behavior:

- Prints a deprecation warning: `rundown docs release is deprecated; use rundown design release`.
- Executes the same release flow as `rundown design release` after warning.
- Accepts the same options as `design release` (`--dir`, `--workspace`, `--label`).

Migration guidance:

- Replace `rundown docs release` with `rundown design release`.

## `rundown docs publish`

Deprecated alias for `rundown design release`.

Behavior:

- Prints a deprecation warning: `rundown docs publish is deprecated; use rundown design release`.
- Executes the same release flow as `rundown design release` after warning.
- Accepts the same options as `design release` (`--dir`, `--workspace`, `--label`).

Migration guidance:

- Replace `rundown docs publish` with `rundown design release`.

## `rundown docs diff [target]`

Deprecated alias for `rundown design diff [target]`.

Behavior:

- Prints a deprecation warning: `rundown docs diff is deprecated; use rundown design diff`.
- Executes the same diff flow as `rundown design diff` after warning.
- Accepts the same argument/options as `design diff` (`[target]`, `--dir`, `--workspace`, `--from`, `--to`).

Migration guidance:

- Replace `rundown docs diff ...` with `rundown design diff ...`.

## `rundown docs save`

Removed alias.

Behavior:

- Fails with an actionable error.
- Does not execute any release operation.

Migration guidance:

- Preferred: use `rundown design release`.
- Transitional fallback: `rundown docs publish` remains available as a deprecated alias.

## Examples

```bash
# Canonical replacement for legacy docs release/publish
rundown design release

# Canonical replacement for legacy docs diff
rundown design diff preview
```
