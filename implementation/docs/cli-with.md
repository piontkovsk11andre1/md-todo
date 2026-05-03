# CLI: `with`

`rundown with <harness>` configures worker settings in `<config-dir>/config.json` from a known harness preset.

Use `with` as the fastest onboarding path when you want runnable defaults without editing JSON manually.

## Global option: `--config-dir <path>`

`--config-dir <path>` is available on every command.

- If provided, rundown uses that directory as the `.rundown` config root and skips upward discovery.
- If omitted, rundown discovers `.rundown/` by walking upward from the command start directory until it finds one.
- If discovery finds nothing, command-specific fallback behavior applies.

Synopsis:

```bash
rundown with <harness>
```

Arguments:

- `<harness>`: preset name or supported alias (case-insensitive).

Options:

- None.

Supported harness presets:

- `opencode`
- `claude`
- `gemini`
- `codex`
- `aider`
- `cursor`
- `pi`

Behavior:

- Validates `<harness>` against known presets.
- Creates `<config-dir>/config.json` when missing.
- Updates preset-targeted keys (`workers.default`, `workers.tui`, `commands.discuss`) without clobbering unrelated config.
- Preserves other config sections (`workspace`, `trace`, run defaults, tool directories, and other command settings).
- Writes to local config scope only (`<config-dir>/config.json`); global config is not modified.
- If resolved preset values are already present, reports no-op semantics and avoids rewrite noise.
- For `opencode`, if local worker keys already exist (`workers.default`, `workers.tui`, or `workers.fallbacks`) and the run would mutate worker settings, `with` asks for confirmation before writing.
- If that overwrite prompt is declined, `with` exits with no config changes.
- In non-interactive execution, required overwrite confirmation cannot be answered, so `with opencode` fails with actionable guidance instead of overwriting existing worker config.
- On interactive terminals, if `workers.tui` is configured by the applied mapping, `with` immediately opens the Rundown root TUI after printing configuration results.
- If terminal interactivity is unavailable or no `workers.tui` mapping is configured, `with` exits after configuration output.
- Prints configured keys and resolved config path.
- Unknown harnesses use an interactive custom-mapping flow (deterministic worker prompt, optional interactive/discuss prompt) and then persist the chosen local mapping.

Examples:

```bash
# Canonical OpenCode onboarding
rundown with opencode

# Alias matching is case-insensitive
rundown with Claude-Code
```

OpenCode conventions applied by `rundown with opencode`:

- Deterministic commands (`run`, `plan`, `research`, `reverify`) use `opencode run $bootstrap`.
- Interactive TUI sessions use prompt-first OpenCode transport (`opencode --prompt $bootstrap`).
- Interactive discussion (`discuss`) uses base `opencode`.
- The deterministic/interactive split is persisted via `workers.default`, `workers.tui`, and `commands.discuss`.

Persisted local config shape (merged into existing JSON without removing unrelated keys):

```json
{
  "workers": {
    "default": ["opencode", "run", "$bootstrap"],
    "tui": ["opencode", "--prompt", "$bootstrap"]
  },
  "commands": {
    "discuss": ["opencode"]
  }
}
```

Alias inputs (for example `OpenCode` and `open-code`) resolve to canonical `opencode` and persist the same command arrays shown above.
