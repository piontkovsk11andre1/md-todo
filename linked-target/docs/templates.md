# Templates

`rundown` loads templates from `.rundown/*.md` in your project. If a template file is missing, the CLI falls back to a built-in default.

## Planning templates

| File | Used by | When it is used |
| --- | --- | --- |
| `.rundown/plan.md` | `rundown plan` | Default planning mode (when `--loop` is not set). |
| `.rundown/plan-loop.md` | `rundown plan --loop` | Loop planning mode for bounded `get:` + `for:` workflows with deterministic `end:` stop conditions. |

`rundown init` scaffolds both planning templates so teams can customize prompt guidance per project.
