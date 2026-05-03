import { describe, expect, it } from "vitest";
import { createTuiHarness } from "./harness.ts";

describe("tui profiles integration", () => {
  it("renders the profiles scene on a seeded workspace", async () => {
    const harness = await createTuiHarness({
      initialScene: "profiles",
      workspaceFiles: {
        "migrations/001-first.md": "---\nprofile: fast\n---\n\n- [ ] First task\n",
        "migrations/002-second.md": "- [ ] profile=review, Verify docs\n",
        "specs/notes.md": "- [ ] profile=fast, tighten test coverage\n",
      },
    });

    const frame = harness.frame();

    expect(frame).toContain("Profiles");
    expect(frame).toContain("Coming in migration 163 - press Esc to go back");
    expect(frame).toContain("Placeholder scene only in this migration.");
  });

  it("returns to the main menu on Esc", async () => {
    const harness = await createTuiHarness({ initialScene: "profiles" });

    expect(harness.sceneStack()).toEqual(["mainMenu", "profiles"]);

    await harness.press("esc");

    expect(harness.sceneStack()).toEqual(["mainMenu"]);
    expect(harness.frame()).toContain("Main Menu:");
    expect(harness.frame()).toContain("4. Profiles");
  });
});
