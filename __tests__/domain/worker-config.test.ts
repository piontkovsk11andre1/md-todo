import { describe, expect, it } from "vitest";
import type { SubItem } from "../../src/domain/parser.js";
import {
  extractProfileFromSubItems,
  resolveWorkerConfig,
} from "../../src/domain/worker-config.js";

describe("resolveWorkerConfig", () => {
  it("resolves workers.default only", () => {
    const resolved = resolveWorkerConfig(
      {
        workers: {
          default: ["opencode", "run", "--model", "gpt-5.3-codex"],
        },
      },
      "run",
      undefined,
      undefined,
      undefined,
      undefined,
    );

    expect(resolved).toEqual(["opencode", "run", "--model", "gpt-5.3-codex"]);
  });

  it("applies per-command override replacing default", () => {
    const resolved = resolveWorkerConfig(
      {
        workers: {
          default: ["opencode", "run"],
        },
        commands: {
          plan: ["opencode", "plan", "--effort", "high"],
        },
      },
      "plan",
      undefined,
      undefined,
      undefined,
      undefined,
    );

    expect(resolved).toEqual(["opencode", "plan", "--effort", "high"]);
  });

  it("keeps default when command override is empty", () => {
    const resolved = resolveWorkerConfig(
      {
        workers: {
          default: ["opencode", "run"],
        },
        commands: {
          plan: [],
        },
      },
      "plan",
      undefined,
      undefined,
      undefined,
      undefined,
    );

    expect(resolved).toEqual(["opencode", "run"]);
  });

  it("applies per-command overrides for research", () => {
    const resolved = resolveWorkerConfig(
      {
        workers: {
          default: ["opencode", "run"],
        },
        commands: {
          research: ["opencode", "run", "--model", "opus-4.6"],
        },
      },
      "research",
      undefined,
      undefined,
      undefined,
      undefined,
    );

    expect(resolved).toEqual(["opencode", "run", "--model", "opus-4.6"]);
  });

  it("applies file-level frontmatter profile", () => {
    const resolved = resolveWorkerConfig(
      {
        workers: {
          default: ["opencode", "run"],
        },
        profiles: {
          complex: ["opencode", "run", "--model", "opus-4.6"],
        },
      },
      "run",
      "complex",
      undefined,
      undefined,
      undefined,
    );

    expect(resolved).toEqual(["opencode", "run", "--model", "opus-4.6"]);
  });

  it("applies directive profile overriding file profile", () => {
    const resolved = resolveWorkerConfig(
      {
        workers: {
          default: ["opencode", "run"],
        },
        profiles: {
          complex: ["opencode", "run", "--model", "opus-4.6"],
          fast: ["opencode", "run", "--model", "gpt-5.3-codex"],
        },
      },
      "run",
      "complex",
      "fast",
      undefined,
      undefined,
    );

    expect(resolved).toEqual(["opencode", "run", "--model", "gpt-5.3-codex"]);
  });

  it("applies task profile after directive profile", () => {
    const resolved = resolveWorkerConfig(
      {
        workers: {
          default: ["opencode", "run"],
        },
        profiles: {
          complex: ["opencode", "run", "--model", "opus-4.6"],
          slow: ["opencode", "run", "--model", "gpt-5.3-codex"],
          fast: ["opencode", "run", "--model", "gpt-5.3-mini"],
        },
      },
      "run",
      "complex",
      "slow",
      "fast",
      undefined,
    );

    expect(resolved).toEqual(["opencode", "run", "--model", "gpt-5.3-mini"]);
  });

  it("uses CLI worker over all other sources", () => {
    const resolved = resolveWorkerConfig(
      {
        workers: {
          default: ["opencode", "run"],
        },
        commands: {
          run: ["opencode", "plan", "--effort", "high"],
        },
        profiles: {
          fast: ["opencode", "run", "--model", "opus-4.6"],
        },
      },
      "run",
      "fast",
      "fast",
      undefined,
      ["custom-worker", "execute"],
    );

    expect(resolved).toEqual(["custom-worker", "execute"]);
  });

  it("throws when referenced profile does not exist", () => {
    expect(() =>
      resolveWorkerConfig(
        {
          workers: {
            default: ["opencode", "run"],
          },
          profiles: {
            fast: ["opencode", "run", "--model", "gpt-5.3-codex"],
          },
        },
        "run",
        "missing",
        undefined,
        undefined,
        undefined,
      ),
    ).toThrow("Unknown worker profile: missing");
  });

  it("returns empty array for empty config", () => {
    expect(resolveWorkerConfig(undefined, "run", undefined, undefined, undefined, undefined)).toEqual([]);
  });

  it("last override wins in cascade", () => {
    const resolved = resolveWorkerConfig(
      {
        workers: {
          default: ["opencode", "run"],
        },
        commands: {
          discuss: ["opencode", "discuss", "--command", "2"],
        },
        profiles: {
          complex: ["claude", "-p", "--file", "3"],
          fast: ["aider", "--directive", "4"],
        },
      },
      "discuss",
      "complex",
      "fast",
      undefined,
      undefined,
    );

    expect(resolved).toEqual(["aider", "--directive", "4"]);
  });

  it("uses workers.tui when mode is tui", () => {
    const resolved = resolveWorkerConfig(
      {
        workers: {
          default: ["opencode", "run", "$bootstrap"],
          tui: ["opencode", "$bootstrap"],
        },
      },
      "run",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "tui",
    );

    expect(resolved).toEqual(["opencode", "$bootstrap"]);
  });

  it("falls back to workers.default when mode is tui but tui is not configured", () => {
    const resolved = resolveWorkerConfig(
      {
        workers: {
          default: ["opencode", "run", "$bootstrap"],
        },
      },
      "run",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "tui",
    );

    expect(resolved).toEqual(["opencode", "run", "$bootstrap"]);
  });

  it("uses workers.default when mode is wait", () => {
    const resolved = resolveWorkerConfig(
      {
        workers: {
          default: ["opencode", "run", "$bootstrap"],
          tui: ["opencode", "$bootstrap"],
        },
      },
      "run",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "wait",
    );

    expect(resolved).toEqual(["opencode", "run", "$bootstrap"]);
  });

  it("per-command override replaces tui base when mode is tui", () => {
    const resolved = resolveWorkerConfig(
      {
        workers: {
          default: ["opencode", "run", "$bootstrap"],
          tui: ["opencode", "$bootstrap"],
        },
        commands: {
          discuss: ["claude", "-p", "$bootstrap"],
        },
      },
      "discuss",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "tui",
    );

    expect(resolved).toEqual(["claude", "-p", "$bootstrap"]);
  });

  it("applies intent-based command override", () => {
    const resolved = resolveWorkerConfig(
      {
        workers: {
          default: ["opencode", "run"],
        },
        commands: {
          run: ["opencode", "run", "--effort", "medium"],
          verify: ["claude", "-p", "$bootstrap"],
        },
      },
      "run",
      undefined,
      undefined,
      undefined,
      undefined,
      "verify",
    );

    expect(resolved).toEqual(["claude", "-p", "$bootstrap"]);
  });
});

describe("extractProfileFromSubItems", () => {
  it("returns undefined when no profile directive exists", () => {
    const subItems: SubItem[] = [
      { text: "verify:", line: 2, depth: 1 },
      { text: "All tests pass", line: 3, depth: 2 },
    ];

    expect(extractProfileFromSubItems(subItems)).toBeUndefined();
  });

  it("extracts profile name from profile: directive", () => {
    const subItems: SubItem[] = [
      { text: "profile: fast", line: 2, depth: 1 },
    ];

    expect(extractProfileFromSubItems(subItems)).toBe("fast");
  });

  it("matches profile directive case-insensitively", () => {
    const subItems: SubItem[] = [
      { text: "PrOfIlE: complex", line: 2, depth: 1 },
    ];

    expect(extractProfileFromSubItems(subItems)).toBe("complex");
  });

  it("returns first valid profile when multiple directives exist", () => {
    const subItems: SubItem[] = [
      { text: "note", line: 2, depth: 1 },
      { text: "profile: fast", line: 3, depth: 1 },
      { text: "profile: complex", line: 4, depth: 1 },
    ];

    expect(extractProfileFromSubItems(subItems)).toBe("fast");
  });

  it("ignores directives with empty profile names", () => {
    const subItems: SubItem[] = [
      { text: "profile:", line: 2, depth: 1 },
      { text: "profile:   ", line: 3, depth: 1 },
      { text: "profile: fast", line: 4, depth: 1 },
    ];

    expect(extractProfileFromSubItems(subItems)).toBe("fast");
  });
});
