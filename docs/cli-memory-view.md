# CLI: `memory-view`

`rundown memory-view <source>` displays source-local memory entries for one or more Markdown sources.

Synopsis:

```bash
rundown memory-view <source> [options]
```

Arguments:

- `<source>`: file, directory, or glob to scan for Markdown memory.

Options:

| Option | Description | Default |
|---|---|---|
| `--json` | Print memory entries as JSON. | off |
| `--summary` | Show index summary fields without full memory body content. | off |
| `--all` | Show memory for all matched files (otherwise first resolved source). | off |

Examples:

```bash
# Show memory for first matched source
rundown memory-view docs/tasks.md

# Show summaries for all matched markdown files
rundown memory-view "docs/**/*.md" --all --summary

# Emit machine-readable output
rundown memory-view roadmap.md --json
```
