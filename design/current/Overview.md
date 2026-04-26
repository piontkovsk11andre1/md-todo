# Rundown — Overview

`rundown` is a Markdown-native task runtime and future-prediction framework for agentic workflows.

## What it does

At the lowest level it defines a workload protocol: select the next unchecked task from a Markdown file, build a structured prompt from document context, run a worker command, verify the result, repair on failure, and mark the checkbox only after verification passes.

At a higher level it supports a **prediction workflow**: design docs describe intent, the migration track records how the world changes over time, and `rundown materialize` executes that track against reality.

## Executables

- `rundown` — canonical CLI name
- `rd` — strict alias, identical behavior

## Core execution model

1. Select next runnable unchecked task
2. Execute via worker or inline CLI block
3. Verify result
4. Repair and retry on failure (bounded attempts)
5. Complete only after verification passes

## Prediction workflow model

1. Edit `design/current/` — living design documents
2. `rd design release` — snapshot to immutable `design/rev.N/`
3. `rundown migrate` — convergence loop: planner proposes migration names → creates files → executes → writes `N.1 Snapshot.md` → loops until `DONE`
4. `rundown materialize` — execute migration track against real world
5. `rundown test` — verify assertions against materialized or predicted state

## Key commands

| Command | Purpose |
|---|---|
| `start` | Scaffold a prediction-oriented workspace |
| `run` | Execute tasks from a Markdown file |
| `materialize` | `run --all --revertable` convenience wrapper |
| `plan` | Generate TODO items using a planner worker |
| `migrate` | Run the design→migration convergence loop |
| `migrate up` | Execute pending migrations, write snapshot checkpoint |
| `migrate down [n]` | Remove last n migrations, prune snapshots, regenerate |
| `design release` | Snapshot `design/current/` to `design/rev.N/` |
| `design diff` | Compare revision state |
| `test` | Verify specs against materialized or predicted state |
| `undo` | Semantically reverse prior task outcomes |
| `discuss` | Interactive TUI session with worker |
| `research` | Research-oriented worker invocation |

## Configuration

`.rundown/config.json` in the project root. Loaded automatically. Defines default worker, per-command overrides, named profiles, and workspace bucket placement.

## Worker model

Worker commands are external processes (opencode, claude, gemini, etc.). Rundown builds a prompt from task context and passes it via `$file` or `$bootstrap` pattern variables. Configuration resolves via CLI flag → config defaults → per-command overrides → named profiles → frontmatter → directive inline.
