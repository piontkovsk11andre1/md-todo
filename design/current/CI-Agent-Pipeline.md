# CI/CD Agent Pipeline

Automated agentic development loop using GitHub Actions and rundown.

## Design principles

- Design docs are the source of truth — all work flows from `design/current/`
- Git is the state store — no external artifact storage for code state
- Two human review gates — design PR, materialization PR
- GitHub Copilot via `GITHUB_TOKEN` — no external AI secrets required
- Rundown builds and runs from source — agent always uses the version being developed

## Trigger map

| Event | Workflow | Action |
|---|---|---|
| PR merge touching `design/current/**` | `agent-design-release.yml` | `design release` + `migrate` → migration PR |
| PR merge touching `migrations/**.md` | `agent-materialize.yml` | `materialize` pending files → implementation PR |

## Full loop

```
Human edits design/current/
  → PR merge to main
    → design release (snapshot rev.N)
    → migrate (planner loop → migration files)
    → PR opened: "chore: design release + generated migrations"

Human reviews migration PR → merges
  → materialize pending migrations
  → per-task commits (--revertable)
  → PR opened with implementation changes

Human reviews implementation PR → merges
```

## Workflows

### `agent-design-release.yml`
- Trigger: push to `main`, paths `design/current/**`
- Concurrency group: `agent-design-release` (queue, no cancel)
- Permissions: `contents: write`, `pull-requests: write`, `models: read`
- Steps: checkout → setup rundown → git identity → branch → `design release` → `migrate` → commit → PR

### `agent-materialize.yml`
- Trigger: push to `main`, paths `migrations/**.md`
- Concurrency group: `agent-materialize-main` (queue, no cancel)
- Permissions: `contents: write`, `pull-requests: write`, `issues: write`, `models: read`
- Steps: checkout → setup rundown → detect pending files → branch → `materialize` → push → PR
- On failure: upload `.rundown/runs/` artifact (14-day retention)

### `.github/actions/setup-rundown/` (composite action)
- Runs in-process on caller's runner
- Sets up Node 24, `npm ci`, `npm run build`
- Used by both agent workflows

## Concurrency and safety

- GitHub Actions `concurrency` with `cancel-in-progress: false` prevents parallel runs of the same workflow
- Rundown file locks (`createFsFileLock`) provide secondary protection against concurrent execution on the same migration file
- Materialization is idempotent — checked tasks are skipped on re-run

## Failure handling

- `.rundown/runs/` uploaded as Actions artifact on job failure (diagnostic only)
- Rundown checkbox state is preserved on partial failure — next run resumes from last unchecked task
- Migration PRs are labeled `ai-generated` for identification

## Worker configuration

`.rundown/config.json` committed to the repo configures the worker. GitHub Copilot access through opencode uses the runner's built-in `GITHUB_TOKEN` — no external secrets needed.
