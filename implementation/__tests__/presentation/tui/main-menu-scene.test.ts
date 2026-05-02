import { describe, expect, it, vi } from "vitest";
import { refreshMainMenuStatusProbe } from "../../../src/presentation/tui/scenes/main-menu.js";

describe("main menu scene", () => {
  it("refreshes a single status probe by id", async () => {
    const refreshProbe = vi.fn(async () => ({ text: "ok", tone: "ok" }));

    await refreshMainMenuStatusProbe("continue", {
      probeRegistry: { refreshProbe },
    });

    expect(refreshProbe).toHaveBeenCalledTimes(1);
    expect(refreshProbe).toHaveBeenCalledWith("continue");
  });

  it("ignores empty probe ids", async () => {
    const refreshProbe = vi.fn(async () => ({ text: "ok", tone: "ok" }));

    await refreshMainMenuStatusProbe("", {
      probeRegistry: { refreshProbe },
    });

    expect(refreshProbe).not.toHaveBeenCalled();
  });
});
