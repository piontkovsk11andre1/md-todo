# CLI: `start`

Bootstrap or adopt a prediction-oriented workspace from directory paths, then hand off to the normal `migrate` flow.

`start` is path-oriented and directory-only:

- `rundown start`
- `rundown start <design-dir>`
- `rundown start <design-dir> <workdir>`

Interpretation:

- No positional args: bootstrap in the current directory when safe.
- One positional directory: adopt that directory as design input.
- Two positional directories: adopt the first as design input and place controlling rundown state in the second.

Safety rule:

- Empty local design directories may be initialized in place.
- Non-empty local design directories require an explicit outer workdir.
- Safe explicit form: `rundown start . ..\myproject-rundown`.

Path-type guard:

- Positional paths are directories, not freeform text.
- If a positional path resolves to an existing file, `start` fails with a directory-required error.

`--mount <logical-path=target-path>` is the authoritative bootstrap surface for mounted workspace adoption and may be repeated.

By default, `start` creates a design-first project structure and prepares implementation/spec/migration workflows:

- `design/current/`
- `design/current/Target.md`
- `migrations/`
- `migrations/1. Initialization.md`
- `specs/`
- `.rundown/`

Use `--design-dir`, `--specs-dir`, and `--migrations-dir` to override these logical workspace roots at bootstrap time. The implementation logical root is also part of the persisted workspace mapping (default: `implementation`) and can be remapped with `--mount implementation=<target-path>` for adoption scenarios. Rundown persists resolved absolute routing in `.rundown/config.json` and reuses it across prediction flows (`migrate`, `design`, `test`, and related commands), including implementation-aware runtime workspace context and mount summary metadata.

Use `--mount <logical-path=target-path>` to attach logical workspace paths to existing directories:

- `logical-path` must be a normalized rundown logical path prefix (for example, `design`, `implementation`, `specs`, `migrations`, `prediction`, `implementation/generated`).
- `target-path` may be absolute or relative.
- Relative target paths are resolved from the invocation directory (where `rundown start` is run), then persisted as normalized absolute targets in workspace config.
- `--mount` is repeatable.
- Nested overrides are supported: a deeper logical prefix (for example `implementation/generated`) can route to a different absolute target than its parent (`implementation`).

Adoption pattern: place the controlling rundown workspace in a separate satellite directory with `--dir`, then mount existing directories from the invocation tree into logical paths. This enables bare control workspaces where most content lives outside the control directory.

Authoritative routing note:

- Runtime workspace path variables (`workspaceDesignPath`, `workspaceImplementationPath`, `workspaceSpecsPath`, `workspaceMigrationsPath`, `workspacePredictionPath`) are already resolved absolute targets.
- Prompt and template consumers should treat those resolved paths (and `workspaceMountSummary` when present) as canonical and should not recompute paths from `workspaceDir` + bucket names.

Compatibility note: `--design-dir`, `--specs-dir`, `--migrations-dir`, placement flags, and `--from-design` remain supported as transition-era shorthands. Implementation workspace routing remains part of the same compatibility surface via persisted defaults and mount mappings.

Legacy placement compatibility (`--design-placement`, `--specs-placement`, `--migrations-placement`):

- `sourcedir` (default): resolve bucket path under the effective workspace/source directory.
- `workdir`: resolve bucket path under the invocation/working directory.

Implementation and prediction buckets also expose legacy placement compatibility values in runtime workspace context; when not otherwise configured, both default to `sourcedir`.

Runtime compatibility semantics for `workspace*Placement` template variables:

- They are transition-era compatibility metadata, not authoritative routing data.
- Use resolved `workspace*Path` values (and `workspaceMountSummary` when present) for canonical routing.
- Values can be empty when no legacy placement config is active (for example, mount-only routing).
- Nested mounts can override placement expectations; do not recompute logical targets from placement + directory names.

Placement defaults persist to `.rundown/config.json` under `workspace.placement` for compatibility with transition-era behavior.

Legacy placement terminology:

- `sourcedir`: effective workspace/source directory used by command resolution.
- `workdir`: invocation directory where the command was launched.

In non-linked mode, `sourcedir` and `workdir` are the same path. In linked mode, they can differ. Mount-resolved absolute workspace paths remain authoritative regardless of placement terminology.

Linked-workspace behavior:

- When `start` is invoked from a linked directory, rundown writes link metadata in both places:
  - target workspace `.rundown/workspace.link` points back to the source workspace (legacy single-path format for compatibility)
  - source workspace `.rundown/workspace.link` is updated in multi-record schema so one source can link to multiple targets
- Existing single-link repositories remain compatible; legacy single-path `workspace.link` still resolves.

Directory override rules:

- Paths must be relative to the project root.
- Paths must resolve inside the project root (for example, `../outside` is rejected).
- Workspace targets must be distinct and non-nested (no duplicates or parent/child overlaps).
- Invalid values fail fast with actionable CLI errors that name the offending option.

Compatibility note: legacy `docs/current/Design.md` and root `Design.md` are still read only as compatibility-only fallbacks when `design/current/` is not available.

## Global option: `--config-dir <path>`

`--config-dir <path>` is available on every command.

- If provided, rundown uses that directory as the `.rundown` config root and skips upward discovery.
- If omitted, rundown discovers `.rundown/` by walking upward from the command start directory until it finds one.
- If discovery finds nothing, command-specific fallback behavior applies.

Synopsis:

```bash
rundown start [design-dir] [workdir] [--mount <logical-path=target-path> ...] [--design-dir <path>] [--specs-dir <path>] [--migrations-dir <path>] -- <command>
rundown start [design-dir] [workdir] [--mount <logical-path=target-path> ...] [--design-dir <path>] [--specs-dir <path>] [--migrations-dir <path>] --worker <pattern>
```

Arguments:

- `design-dir` (optional): Directory to use/adopt as design input.
- `workdir` (optional): Outer control workspace directory where `.rundown` and work buckets are placed.

Argument semantics:

- `rundown start` uses current directory as design target.
- `rundown start <design-dir>` uses that directory directly.
- `rundown start <design-dir> <workdir>` separates design input from control workspace.

Options:

| Option | Description | Default |
|---|---|---|
| `--dir <path>` | Compatibility override for control workspace directory. Positional `workdir` is preferred. | current working directory |
| `--mount <logical-path=target-path>` | Repeatable logical-path mount declaration for mounted workspace adoption. Relative targets resolve from invocation directory. | unset |
| `--design-dir <path>` | Design workspace directory name/path for start scaffold. | `design` |
| `--mount implementation=<target-path>` | Common adoption mapping to route logical `implementation` to an existing codebase directory. | unset |
| `--specs-dir <path>` | Specs workspace directory name/path for start scaffold. | `specs` |
| `--migrations-dir <path>` | Migrations workspace directory name/path for start scaffold. | `migrations` |
| `--design-placement <mode>` | Legacy compatibility placement root for `design`: `sourcedir` or `workdir`. | `sourcedir` |
| `--specs-placement <mode>` | Legacy compatibility placement root for `specs`: `sourcedir` or `workdir`. | `sourcedir` |
| `--migrations-placement <mode>` | Legacy compatibility placement root for `migrations`: `sourcedir` or `workdir`. | `sourcedir` |
| `--worker <pattern>` | Worker pattern override (alternative to `-- <command>`). | unset |

Examples:

```bash
# Greenfield local bootstrap (safe when current directory is empty)
rundown start -- opencode run

# Adopt local non-empty project safely with explicit outer workdir
rundown start . ../control --mount implementation=. -- opencode run

# Adopt explicit design directory in place (safe when that directory is empty)
rundown start ./design-input -- opencode run

# Full mounted adoption with separate control workspace
rundown start . ../control --mount design=../docs/design --mount implementation=. --mount specs=../qa/specs --mount migrations=../control/migrations --mount prediction=../control/prediction -- opencode run

# Nested mount override
rundown start . ../control --mount implementation=. --mount implementation/generated=./generated -- opencode run

# Legacy compatibility flags are still accepted
rundown start ./design-input --design-placement sourcedir --specs-placement workdir --migrations-placement sourcedir --mount implementation=./implementation -- opencode run
```
