# CLI: `migrate`

Create migrations from design revisions, implementation changes, or prediction changes.

`rundown migrate` is the canonical revision-aware planning command.
Before migration planning, it performs a design-revision preflight sync:

- If `design/current/` changed from the latest released revision, it creates the next immutable `design/revisions/rev.N/` snapshot.
- If unchanged, it creates no new revision.
- If no released revisions exist yet and managed design workspace is present, it bootstraps `rev.0` from `design/current/`.

Planning then proceeds against released revision metadata boundaries (`plannedAt`, `migrations`) as usual.

`migrate` always runs as a single workspace-level orchestration command (no positional actions). It executes a convergence loop:

1. Ask the planner worker for uncovered migration names.
2. If worker output is `DONE`, stop.
3. Create migration files for newly proposed names.
4. Run enrichment for each created migration.
5. Optionally pause at `--confirm`.
6. Apply the drafted migration batch, then loop again.

Design context resolution is revision-aware: it prefers `design/current/**`, includes revision/archive directories (`design/revisions/rev.*/**`) as context sources, and falls back to legacy `design/rev.*/**`, `docs/current/**`, `docs/rev.*/**`, and root `Design.md` only as compatibility-only paths for older projects.

## Global option: `--config-dir <path>`

`--config-dir <path>` is available on every command.

- If provided, rundown uses that directory as the `.rundown` config root and skips upward discovery.
- If omitted, rundown discovers `.rundown/` by walking upward from the command start directory until it finds one.
- If discovery finds nothing, command-specific fallback behavior applies.

Synopsis:

```bash
rundown migrate [options] -- <command>
rundown migrate [options] --worker <pattern>
```

Options:

| Option | Description | Default |
|---|---|---|
| `--dir <path>` | Migration directory to operate on. | `./migrations` |
| `--workspace <dir>` | Explicit workspace root for linked/multi-workspace resolution. Required when link metadata is ambiguous. | unset |
| `--from <source>` | Source reconciliation mode. Allowed values: `implementation`, `prediction`. Omit to use default design-diff mode. | default design-diff |
| `--compact-before-exit` | Run post-success compaction as a follow-up step before command exit. | off |
| `--confirm` | During loop mode, pause after migration files are created so you can edit them before applying the batch. | off |
| `--keep-artifacts` | Preserve runtime prompts, logs, and metadata under `<config-dir>/runs`. | off |
| `--show-agent-output` | Show worker stdout/stderr during execution. | off |
| `--worker <pattern>` | Worker pattern override (alternative to `-- <command>`). | unset |
| `--slug-worker <pattern>` | Worker override used only for migration slug naming/reconciliation. | unset |

Auto-compact defaults:

- You can opt in persistently by setting `autoCompact.beforeExit=true` in config.
- Defaults remain off unless explicitly enabled by config or `--compact-before-exit`.

Workspace selection notes (`migrate`):

- By default, path-sensitive commands resolve workspace from `.rundown/workspace.link`.
- If link metadata has multiple records and no default, command resolution is ambiguous and the command fails with candidate paths.
- Use `--workspace <dir>` to select the effective workspace explicitly (relative to invocation directory).

Prediction workspace routing notes (`migrate`, `test`, `plan`, `research`, `run` prompt context):

- Logical roots (`design`, `implementation`, `specs`, `migrations`, `prediction`) resolve to authoritative absolute targets before prompt rendering.
- Prompt/runtime consumers should treat resolved `workspace*Path` values as canonical and should not recompute paths from `workspaceDir` + bucket names.
- If present, `workspaceMountSummary` is the canonical routing map for logical-path resolution, including nested overrides.
- Nested mount overrides are valid (for example `implementation/generated` routed separately from `implementation`).
- In linked mode, `workspaceDir` may differ from `invocationDir`; resolved absolute targets remain authoritative in both modes.
- If any two required logical roots resolve to the same absolute path, command resolution fails with a workspace routing conflict error.

Legacy placement compatibility example:

```json
{
  "workspace": {
    "directories": {
      "design": "design",
      "implementation": "implementation",
      "specs": "specs",
      "migrations": "migrations",
      "prediction": "prediction"
    },
    "placement": {
      "design": "sourcedir",
      "implementation": "sourcedir",
      "specs": "workdir",
      "migrations": "sourcedir",
      "prediction": "sourcedir"
    }
  }
}
```

The placement map above remains supported for transition-era compatibility; runtime prompt routing is still based on resolved absolute workspace targets.

Compatibility guidance for runtime `workspace*Placement` variables:

- Treat placement variables as migration-era compatibility metadata only.
- Use resolved absolute `workspace*Path` variables as authoritative routing targets.
- If present, `workspaceMountSummary` is canonical for logical-path routing (including nested overrides).
- Placement variables may be empty when workspace routing is mount-only and no legacy placement map is configured.

Linked workspace example (resolved roots):

- invocation (`workdir`): `/Users/alex/client-a`
- resolved workspace (`sourcedir`): `/Users/alex/platform-core`
- effective paths:
  - design -> `/Users/alex/platform-core/design`
  - implementation -> `/Users/alex/platform-core/implementation`
  - specs -> `/Users/alex/client-a/specs`
  - migrations -> `/Users/alex/platform-core/migrations`
  - prediction -> `/Users/alex/platform-core/prediction`

Bare control workspace example (major content mounted elsewhere):

- invocation: `/Users/alex/app`
- control workspace: `/Users/alex/control`
- effective paths:
  - design -> `/Users/alex/docs/design`
  - implementation -> `/Users/alex/app`
  - specs -> `/Users/alex/qa/specs`
  - migrations -> `/Users/alex/control/migrations`
  - prediction -> `/Users/alex/control/prediction`

Examples:

```bash
# Default mode: derive migrations from design diffs
rundown migrate

# Reconcile current design from implementation changes, then draft/promote migrations
rundown migrate --from implementation

# Reconcile current design from prediction changes, then draft/promote migrations
rundown migrate --from prediction
```

## Backlog and snapshots

- Backlog is a singleton file: `migrations/Backlog.md`.
- Snapshot checkpoints are numbered satellites: `N.1 Snapshot.md`.
- New snapshots are additive historical checkpoints; older `N.1 Snapshot.md` files stay.
- Snapshot regeneration and revision planning continue to run through the migrate pipeline in every source mode.
