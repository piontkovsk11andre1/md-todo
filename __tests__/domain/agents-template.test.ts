import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENTS_TEMPLATE,
  getAgentsTemplate,
} from "../../src/domain/agents-template.js";

describe("agents template", () => {
  it("exports deterministic newline-terminated AGENTS markdown", () => {
    expect(DEFAULT_AGENTS_TEMPLATE).toBe([
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
      "",
    ].join("\n"));
  });

  it("returns the canonical template through helper", () => {
    expect(getAgentsTemplate()).toBe(DEFAULT_AGENTS_TEMPLATE);
  });
});
