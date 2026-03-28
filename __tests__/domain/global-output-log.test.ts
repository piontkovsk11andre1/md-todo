import { describe, expect, it } from "vitest";
import { serializeGlobalOutputLogEntry } from "../../src/domain/global-output-log.js";

describe("global output log serialization", () => {
  it("serializes a single JSON object per line", () => {
    const line = serializeGlobalOutputLogEntry({
      ts: "2026-03-27T00:00:00.000Z",
      level: "info",
      stream: "stdout",
      kind: "info",
      message: "hello",
      command: "run",
      argv: ["run", "tasks.md"],
      cwd: "/workspace",
      pid: 123,
      version: "1.0.0",
      session_id: "session-1",
    });

    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1).includes("\n")).toBe(false);

    const parsed = JSON.parse(line.trim()) as Record<string, unknown>;
    expect(parsed["message"]).toBe("hello");
    expect(Object.keys(parsed).sort()).toEqual([
      "argv",
      "command",
      "cwd",
      "kind",
      "level",
      "message",
      "pid",
      "session_id",
      "stream",
      "ts",
      "version",
    ]);
  });

  it("strips ANSI escape codes from all string fields", () => {
    const ansiRed = "\u001b[31m";
    const ansiReset = "\u001b[0m";
    const line = serializeGlobalOutputLogEntry({
      ts: `${ansiRed}2026-03-27T00:00:00.000Z${ansiReset}`,
      level: "error",
      stream: "stderr",
      kind: `${ansiRed}error${ansiReset}`,
      message: `${ansiRed}boom${ansiReset}`,
      command: `${ansiRed}run${ansiReset}`,
      argv: [`${ansiRed}run${ansiReset}`, `${ansiRed}tasks.md${ansiReset}`],
      cwd: `${ansiRed}/workspace${ansiReset}`,
      pid: 999,
      version: `${ansiRed}1.0.0${ansiReset}`,
      session_id: `${ansiRed}session-2${ansiReset}`,
    });

    expect(line).not.toContain("\u001b");
    const parsed = JSON.parse(line.trim()) as Record<string, unknown>;
    expect(parsed["message"]).toBe("boom");
    expect(parsed["command"]).toBe("run");
    expect(parsed["cwd"]).toBe("/workspace");
    expect(parsed["version"]).toBe("1.0.0");
    expect(parsed["session_id"]).toBe("session-2");
    expect(parsed["argv"]).toEqual(["run", "tasks.md"]);
  });
});
