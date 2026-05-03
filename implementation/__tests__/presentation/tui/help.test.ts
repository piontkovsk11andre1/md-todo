import { describe, expect, it } from "vitest";
import { createTuiHarness } from "./harness.ts";

describe("tui help integration", () => {
  it("discovers local docs including fixed files and docs/*.md", async () => {
    const harness = await createTuiHarness({ initialScene: "help" });

    const frame = harness.frame();
    expect(frame).toContain("Help");
    expect(frame).toContain("Documentation (local)");
    expect(frame).toContain("README.md");
    expect(frame).toContain("roadmap.md");
    expect(frame).toMatch(/docs\/[\w.-]+\.md/);
  });

  it("opens AGENTS.md template in pager", async () => {
    const harness = await createTuiHarness({ initialScene: "help" });

    for (let index = 0; index < 200; index += 1) {
      if (harness.frame().includes("> [↵] AGENTS.md template (live, via getAgentsTemplate())")) {
        break;
      }
      await harness.press("down");
    }

    expect(harness.frame()).toContain("> [↵] AGENTS.md template (live, via getAgentsTemplate())");

    await harness.press("enter");

    const frame = harness.frame();
    expect(frame).toContain("Help");
    expect(frame).toContain("AGENTS.md template");
    expect(frame).toContain("# AGENTS");
    expect(frame).toContain("## Planner");
    expect(frame).toContain("[q/Esc] close");
  });

  it("renders keybindings overlay with [k]", async () => {
    const harness = await createTuiHarness({
      initialScene: "help",
    });

    await harness.press("k");

    const frame = harness.frame();
    expect(frame).toContain("Keybindings cheatsheet");
    expect(frame).toContain("Global");
    expect(frame).toContain("[Enter] open local docs and synthesized references");
    expect(frame).toContain("[Esc] close");
  });
});
