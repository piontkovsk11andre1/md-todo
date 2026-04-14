import { describe, expect, it } from "vitest";
import { CLI_TIMESTAMP_FORMAT, formatCliTimestamp } from "../../src/domain/cli-timestamp.js";

describe("cli-timestamp", () => {
  it("documents UTC ISO-8601 as the canonical CLI format", () => {
    expect(CLI_TIMESTAMP_FORMAT).toBe("UTC ISO-8601");
  });

  it("formats Date values as ISO UTC strings", () => {
    const value = new Date("2026-04-14T08:26:01.557Z");
    expect(formatCliTimestamp(value)).toBe("2026-04-14T08:26:01.557Z");
  });

  it("normalizes parseable strings and preserves invalid values", () => {
    expect(formatCliTimestamp("2026-04-14T08:26:01.557Z")).toBe("2026-04-14T08:26:01.557Z");
    expect(formatCliTimestamp("not-a-date")).toBe("not-a-date");
  });
});
