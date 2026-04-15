# CLI: `memory-validate`

`rundown memory-validate <source>` validates source-local memory consistency and reports issues.

Checks include orphaned index entries, missing index entries for body files, entry-count mismatch, summary drift, and stale source references.

Synopsis:

```bash
rundown memory-validate <source> [options]
```

Arguments:

- `<source>`: file, directory, or glob to scan for Markdown memory.

Options:

| Option | Description | Default |
|---|---|---|
| `--fix` | Auto-fix recoverable index issues while validating. | off |
| `--json` | Print validation report as JSON. | off |

Examples:

```bash
# Human-readable validation report
rundown memory-validate docs/

# Validate and attempt automatic repairs
rundown memory-validate docs/ --fix

# Emit JSON report for automation
rundown memory-validate "docs/**/*.md" --json
```
