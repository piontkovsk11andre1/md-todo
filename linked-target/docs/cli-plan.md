# `rundown plan`

Use `rundown plan` to generate a TODO workflow from a prompt. By default, the planner uses `.rundown/plan.md`.

## Loop planning mode

Use `--loop` to switch planner prompting to `.rundown/plan-loop.md`.

```bash
rundown plan "process every pending migration" --loop
```

When `--loop` is enabled, the planner is expected to produce bounded loop workflows that:

- use `get:` to discover an iterable set of values/items,
- use `for:` to run per-item implementation/review steps from prompt context,
- use `end:` with a deterministic stop condition (for example: no values returned by `get:`).

This keeps loop plans explicit and safe to execute, rather than relying on open-ended recursion or implicit stopping behavior.

## Template resolution

Template selection for planning:

- default mode: `.rundown/plan.md` (fallback to built-in default),
- loop mode (`--loop`): `.rundown/plan-loop.md` (fallback to built-in loop default).

If you run `rundown init`, both templates are scaffolded so they can be customized per project.

## `--commit` behavior with loop workflows

`--loop` changes how a plan is authored; it does not disable commit behavior. If your execution path uses `--commit`, commits still apply to loop-generated tasks under the same command semantics.

## Examples

Generate a standard plan:

```bash
rundown plan "add retry logic to flaky API calls"
```

Generate a loop-oriented plan for each item from discovery:

```bash
rundown plan "for each open TODO file, repair failing checks" --loop
```

Preview the exact prompt/template usage in loop mode:

```bash
rundown plan "triage all stale specs" --loop --print-prompt --dry-run
```
