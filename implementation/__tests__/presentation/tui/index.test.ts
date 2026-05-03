import { describe, expect, it } from "vitest";
import * as tuiModule from "../../../src/presentation/tui/index.ts";

describe("tui index module", () => {
  it("exports runRootTui entry function", () => {
    expect(tuiModule).toHaveProperty("runRootTui");
    expect(typeof tuiModule.runRootTui).toBe("function");
  });
});
