import { afterEach, describe, expect, it, vi } from "vitest";
import { cliOutputPort } from "../../src/presentation/output-port.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cliOutputPort", () => {
  it("ignores unknown event kinds", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    cliOutputPort.emit({ kind: "unknown" } as never);

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});