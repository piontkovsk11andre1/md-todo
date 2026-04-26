# Architecture

Rundown follows a port/adapter (hexagonal) architecture. All external I/O goes through ports; domain logic is framework-independent and fully testable.

## Layers

### Domain (`src/domain/`)

Pure business logic with no I/O dependencies.

- **Parser** — extracts `Task[]` from Markdown checkbox syntax
- **Planner** — validates and inserts TODO items (additive-only contract)
- **Task selection** — depth-first, hierarchy-respecting selection
- **Task intent** — classifies tasks: `execute-and-verify`, `verify-only`, `memory-capture`, `tool-expansion`, `fast-execution`
- **Worker config** — resolution logic across CLI → config → profiles → frontmatter → directive
- **Worker pattern** — parses `$file` / `$bootstrap` command pattern variables
- **Builtin tools** — `verify:`, `repair:`, `memory:`, `include:`, `end:`, `for:` and others
- **Harness preset registry** — known worker presets (opencode, claude, gemini, codex, aider, cursor)
- **Trace** — typed event schema for per-run session tracking

### Application (`src/application/`)

Orchestration and use cases. All depend on ports, not adapters.

- `run-task-execution` — main `run` loop: source resolve → lock → iterate tasks → finish
- `run-task-iteration` — single task: intent resolve → dispatch → complete
- `task-execution-dispatch` — route to execute → verify → repair
- `verify-repair-loop` — bounded repair retry cycle
- `plan-task` — scan-based TODO generation with convergence detection
- `migrate-task` — planner convergence loop + `migrate up/down`
- `design-release-task` — snapshot `design/current/` to `design/rev.N/`
- `discuss-task` — interactive TUI session
- `research-task` — research-oriented worker invocation
- `test-task` — spec assertion verification (materialized + future modes)
- `undo-task` — artifact-based semantic reversal
- `with-task` — worker harness configuration via preset

### Infrastructure (`src/infrastructure/`)

Concrete port implementations and I/O adapters.

- `runner` — cross-spawn worker process (wait / tui / detached modes)
- `inline-cli` — `cli:` block execution with caching
- `inline-rundown` — nested `rundown:` invocation
- `adapters/` — filesystem, git, config, source resolver, workspace link, worker health

### Presentation (`src/presentation/`)

CLI layer only. Translates CLI args to application options, renders output events to console.

- `cli.ts` — command definitions (Commander)
- `cli-command-actions.ts` — action handlers wiring CLI → app
- `output-port.ts` — event-to-console rendering

## Port/adapter table

| Port | Adapter |
|---|---|
| `FileSystem` | `createNodeFileSystem` |
| `FileLock` | `createFsFileLock` |
| `ConfigDirPort` | `createConfigDirAdapter` |
| `ProcessRunner` | `createCrossSpawnProcessRunner` |
| `GitClient` | `createExecFileGitClient` |
| `TemplateLoader` | `createFsTemplateLoader` |
| `WorkerExecutorPort` | `worker-executor-adapter` |
| `TaskVerificationPort` | `task-verification-adapter` |
| `TaskRepairPort` | `task-repair-adapter` |
| `SourceResolverPort` | `source-resolver-adapter` |
| `WorkerConfigPort` | `worker-config-adapter` |

## Execution entry point

`src/create-app.ts` is the single composition root — wires all ports to adapters and returns the `App` instance consumed by the CLI layer.

## Key constraints

- **Sequential only** — tasks run one at a time, no parallel execution
- **Hierarchy-respecting** — parent must be checked before children execute
- **Additive-only planning** — planner can only add items, never remove or reorder
- **Verification-gated completion** — checkbox updates only after verification passes
- **File locks** — prevent concurrent rundown instances on the same file
