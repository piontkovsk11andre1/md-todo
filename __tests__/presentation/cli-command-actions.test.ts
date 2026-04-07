import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApplicationOutputEvent } from "../../src/domain/ports/output-port.js";
import { createLoopCommandAction } from "../../src/presentation/cli-command-actions.js";
import type { CliApp } from "../../src/presentation/cli-app-init.js";
import * as sleepModule from "../../src/infrastructure/cancellable-sleep.js";

type RunTaskRequest = Record<string, unknown>;
type RunTaskFn = (request: RunTaskRequest) => Promise<number>;
type CliOpts = Record<string, string | string[] | boolean>;

interface LoopHarness {
  action: ReturnType<typeof createLoopCommandAction>;
  runTask: ReturnType<typeof vi.fn<RunTaskFn>>;
  emitOutput: ReturnType<typeof vi.fn<(event: ApplicationOutputEvent) => void>>;
  releaseAllLocks: ReturnType<typeof vi.fn<() => void>>;
  outputEvents: ApplicationOutputEvent[];
  setLoopSignalExitCode: ReturnType<typeof vi.fn<(code: number) => void>>;
}

function createLoopHarness(runTaskImpl: RunTaskFn = async () => 0): LoopHarness {
  const outputEvents: ApplicationOutputEvent[] = [];
  const runTask = vi.fn<RunTaskFn>(runTaskImpl);
  const emitOutput = vi.fn<(event: ApplicationOutputEvent) => void>((event) => {
    outputEvents.push(event);
  });
  const releaseAllLocks = vi.fn<() => void>();
  const setLoopSignalExitCode = vi.fn<(code: number) => void>();
  const app = {
    runTask,
    emitOutput,
    releaseAllLocks,
  } as unknown as CliApp;

  const action = createLoopCommandAction({
    getApp: () => app,
    getWorkerFromSeparator: () => undefined,
    runnerModes: ["wait", "tui"],
    setLoopSignalExitCode,
  });

  return {
    action,
    runTask,
    emitOutput,
    releaseAllLocks,
    outputEvents,
    setLoopSignalExitCode,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("createLoopCommandAction", () => {
  it("runs exactly --iterations full call-style passes", async () => {
    const { action, runTask, releaseAllLocks } = createLoopHarness(async () => 0);

    const exitCode = await action("tasks.md", {
      worker: "opencode run",
      iterations: "3",
      cooldown: "0",
    });

    expect(exitCode).toBe(0);
    expect(runTask).toHaveBeenCalledTimes(3);
    expect(releaseAllLocks).toHaveBeenCalledTimes(3);
    expect(runTask).toHaveBeenNthCalledWith(1, expect.objectContaining({
      source: "tasks.md",
      runAll: true,
      clean: true,
      redo: true,
      resetAfter: true,
      cacheCliBlocks: true,
    }));
    expect(runTask).toHaveBeenNthCalledWith(2, expect.objectContaining({
      source: "tasks.md",
      runAll: true,
      clean: true,
      redo: true,
      resetAfter: true,
      cacheCliBlocks: true,
    }));
    expect(runTask).toHaveBeenNthCalledWith(3, expect.objectContaining({
      source: "tasks.md",
      runAll: true,
      clean: true,
      redo: true,
      resetAfter: true,
      cacheCliBlocks: true,
    }));
  });

  it("waits for the configured cooldown between iterations", async () => {
    vi.useFakeTimers();
    const { action, runTask, outputEvents } = createLoopHarness(async () => 0);

    const completion = Promise.resolve(action("tasks.md", {
      worker: "opencode run",
      iterations: "2",
      cooldown: "2",
    }));

    let settled = false;
    void completion.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(runTask).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    expect(runTask).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    await completion;

    expect(runTask).toHaveBeenCalledTimes(2);
    const cooldownMessages = outputEvents
      .filter((event) => event.kind === "info")
      .map((event) => {
        if ("message" in event) {
          return event.message;
        }
        return "";
      })
      .filter((message) => message.startsWith("Loop cooldown:"));
    expect(cooldownMessages).toEqual([
      "Loop cooldown: 2s remaining before iteration 2.",
      "Loop cooldown: 1s remaining before iteration 2.",
    ]);
  });

  it("continues on failed iterations when --continue-on-error is enabled", async () => {
    const { action, runTask, outputEvents } = createLoopHarness(
      vi
        .fn<RunTaskFn>()
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(0),
    );

    const exitCode = await action("tasks.md", {
      worker: "opencode run",
      iterations: "2",
      cooldown: "0",
      continueOnError: true,
    });

    expect(exitCode).toBe(0);
    expect(runTask).toHaveBeenCalledTimes(2);
    expect(outputEvents).toContainEqual({
      kind: "warn",
      message: "Loop iteration 1 failed with exit code 2; starting next iteration immediately.",
    });
  });

  it("stops gracefully on SIGINT during cooldown", async () => {
    const sleepSpy = vi.spyOn(sleepModule, "cancellableSleep").mockImplementation(() => {
      process.emit("SIGINT");
      return {
        promise: Promise.resolve(),
        cancel: () => {},
      };
    });

    const { action, runTask, setLoopSignalExitCode } = createLoopHarness(async () => 0);

    const exitCode = await action("tasks.md", {
      worker: "opencode run",
      cooldown: "5",
    });

    expect(exitCode).toBe(0);
    expect(runTask).toHaveBeenCalledTimes(1);
    expect(setLoopSignalExitCode).toHaveBeenCalledWith(0);
    expect(sleepSpy).toHaveBeenCalled();
  });
});
