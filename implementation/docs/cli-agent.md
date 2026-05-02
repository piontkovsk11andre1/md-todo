# CLI: `rundown agent`

Run `rundown agent` to open the interactive rundown agent explicitly under a stable subcommand name.

`rundown agent` is functionally equivalent to the current root no-arg agent entrypoint for interactive help behavior. It supports `-c, --continue` to resume the previous session, `--agents` to print canonical AGENTS guidance and exit `0`, `--trace` for structured tracing, and worker forwarding via `--worker <pattern>` or `-- <command>`.
