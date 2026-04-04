import { describe, expect, it } from "vitest";
import { parseWorkerPattern } from "../../src/domain/worker-pattern.js";
import { splitWorkerFromSeparator } from "../../src/presentation/cli-argv.js";

describe("splitWorkerFromSeparator", () => {
  it("returns separator worker tokens as a single worker pattern", () => {
    const argv = ["run", "tasks.md", "--", "opencode", "run", "--model", "gpt-5"];

    const result = splitWorkerFromSeparator(argv);

    expect(result.rundownArgs).toEqual(["run", "tasks.md"]);
    expect(result.workerFromSeparator).toBe("opencode run --model gpt-5");
  });

  it("quotes separator tokens so pattern parsing restores original tokens", () => {
    const workerTokens = [
      "C:\\Program Files\\Tool\\runner.cmd",
      "--flag",
      "value with spaces",
      'with"quote',
      "C:\\Temp\\path\\with\\slashes",
    ];
    const argv = ["run", "tasks.md", "--", ...workerTokens];

    const result = splitWorkerFromSeparator(argv);

    expect(result.workerFromSeparator).toBeDefined();
    expect(parseWorkerPattern(result.workerFromSeparator ?? "").command).toEqual(workerTokens);
  });

  it("returns undefined worker pattern when separator is absent or empty", () => {
    expect(splitWorkerFromSeparator(["run", "tasks.md"]).workerFromSeparator).toBeUndefined();
    expect(splitWorkerFromSeparator(["run", "tasks.md", "--"]).workerFromSeparator).toBeUndefined();
  });
});
