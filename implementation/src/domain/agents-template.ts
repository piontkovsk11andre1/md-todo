const AGENTS_TEMPLATE_LINES = [
  "# AGENTS",
  "",
  "Define project-specific agent roles and responsibilities.",
  "",
  "## Planner",
  "- Owns migration sequencing and trade-off analysis.",
  "",
  "## Builder",
  "- Implements migration tasks and keeps changes cohesive.",
  "",
  "## Verifier",
  "- Validates outcomes against specs and migration intent.",
  "",
] as const;

/**
 * Canonical AGENTS.md template used by scaffold and CLI output flows.
 *
 * Kept newline-terminated for shell redirection compatibility.
 */
export const DEFAULT_AGENTS_TEMPLATE = AGENTS_TEMPLATE_LINES.join("\n") + "\n";

/**
 * Returns deterministic AGENTS guidance for stdout/file emission.
 */
export function getAgentsTemplate(): string {
  return DEFAULT_AGENTS_TEMPLATE;
}
