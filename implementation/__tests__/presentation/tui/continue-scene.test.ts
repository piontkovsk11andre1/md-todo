import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../src/create-app.js";
import {
  createContinueSceneState,
  handleContinueInput,
  renderContinueSceneLines,
  updateContinueUiState,
} from "../../../src/presentation/tui/scenes/continue.js";
import { applyOutputEvent, createInitialRunState } from "../../../src/presentation/tui/output-bridge.js";

vi.mock("../../../src/create-app.js", () => ({
  createApp: vi.fn(() => ({
    listTasks: vi.fn(async () => 0),
    releaseAllLocks: vi.fn(),
    awaitShutdown: vi.fn(async () => {}),
    runTask: vi.fn(async () => 0),
  })),
}));

function stripAnsi(lines: string[]): string[] {
  return lines.map((line) => line.replace(/\u001B\[[0-9;]*m/g, ""));
}

describe("continue scene cockpit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders golden frames for previewing, running transitions, and done-with-failure", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-05-02T21:56:50.000Z"));

      const state = {
        ...createContinueSceneState(),
        previewLoaded: true,
        sourceTarget: "migrations/",
        taskItems: [
          { line: 12, textLines: ["First unchecked task"] },
          { line: 24, textLines: ["Second unchecked task"] },
          { line: 48, textLines: ["Third unchecked task"] },
        ],
      };

      const runState = createInitialRunState();
      runState.actionLabel = "materialize";
      runState.sourceTarget = "migrations/";
      runState.totalTasks = state.taskItems.length;
      runState.runStartedAt = Date.now();

      const previewFrame = stripAnsi(renderContinueSceneLines({
        uiState: "previewing",
        state,
        runState,
        currentWorkingDirectory: process.cwd(),
        sectionGap: 1,
        hintGap: 1,
        errorGap: 1,
      })).join("\n");

      applyOutputEvent(runState, {
        kind: "group-start",
        label: "Task 1",
        counter: { current: 1, total: 3 },
      });
      applyOutputEvent(runState, {
        kind: "progress",
        progress: { label: "scan", current: 1, total: 4, detail: "scan 1/4" },
      });
      applyOutputEvent(runState, {
        kind: "progress",
        progress: { label: "resolveRepair", current: 2, total: 3, detail: "attempt 2/3" },
      });

      const runningFrame = stripAnsi(renderContinueSceneLines({
        uiState: "running",
        state,
        runState,
        currentWorkingDirectory: process.cwd(),
        sectionGap: 1,
        hintGap: 1,
        errorGap: 1,
      })).join("\n");

      vi.setSystemTime(new Date("2026-05-02T21:56:58.000Z"));
      applyOutputEvent(runState, {
        kind: "group-end",
        status: "failure",
        message: "verify failed for task 12",
      });
      runState.finished = true;
      runState.exitCode = 1;
      runState.error = "Verification failed in step verify";

      const doneFrame = stripAnsi(renderContinueSceneLines({
        uiState: updateContinueUiState("running", runState),
        state,
        runState,
        currentWorkingDirectory: process.cwd(),
        sectionGap: 1,
        hintGap: 1,
        errorGap: 1,
      })).join("\n");

      expect({ previewFrame, runningFrame, doneFrame }).toMatchInlineSnapshot(`
        {
          "doneFrame": "Action:  materialize                                                    Phase Counters:\n+Target:  migrations/                                                   current: 2/3\n+Elapsed: 00:08\n+Tasks:   0 / 3\n+\n+Run Started:           2026-05-02 21:56:50\n+Current Task Started:  n/a (run complete)\n+\n+Operation:      REPAIR\n+Task Progress:  [----------------------------------------] 0%\n+\n+previous 048 - [x] Third unchecked task\n+\n+current  (none)\n+\n+next     (none)\n+\n+Failures: 1   Repairs: 0\n+Resolvings: 0   Resets: 0\n+\n+Recent:\n+  scan 1/4\n+  attempt 2/3\n+  verify failed for task 12\n+\n+Run failed (exit 1). Press Esc to return to menu.\n+Verification failed in step verify\n+\n+Summary: 0/3 tasks, 00:08, 1 failures, 0 repairs, 0 resolves",
          "previewFrame": "Continue Preview\n+\n+Source: migrations/\n+Task count: 3\n+\n+next: 012 - First unchecked task\n+after: 024 - Second unchecked task\n+later: 048 - Third unchecked task\n+\n+Enter: start run. r: refresh list. Esc: back.",
          "runningFrame": "Action:  materialize                                                    Phase Counters:\n+Target:  migrations/                                                   current: 2/3\n+Elapsed: 00:00\n+Tasks:   0 / 3\n+\n+Run Started:           2026-05-02 21:56:50\n+Current Task Started:  2026-05-02 21:56:50\n+\n+Operation:      RESOLVEREPAIR\n+Task Progress:  [----------------------------------------] 0%\n+\n+previous (none)\n+\n+current  012 - [ ] First unchecked task\n+\n+next     024 - [ ] Second unchecked task\n+\n+Failures: 0   Repairs: 0\n+Resolvings: 0   Resets: 0\n+\n+Recent:\n+  scan 1/4\n+  attempt 2/3",
        }
      `);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders task preview with next unchecked task and 3-line preview", () => {
    const state = {
      ...createContinueSceneState(),
      previewLoaded: true,
      sourceTarget: "migrations/",
      taskItems: [
        { line: 12, textLines: ["First unchecked task"] },
        { line: 24, textLines: ["Second unchecked task"] },
        { line: 48, textLines: ["Third unchecked task"] },
      ],
    };
    const runState = createInitialRunState();

    const lines = stripAnsi(renderContinueSceneLines({
      uiState: "previewing",
      state,
      runState,
      currentWorkingDirectory: process.cwd(),
      sectionGap: 1,
      hintGap: 1,
      errorGap: 1,
    }));

    expect(lines.join("\n")).toContain("Continue Preview");
    expect(lines.join("\n")).toContain("Task count: 3");
    expect(lines.join("\n")).toContain("next: 012 - First unchecked task");
    expect(lines.join("\n")).toContain("after: 024 - Second unchecked task");
    expect(lines.join("\n")).toContain("later: 048 - Third unchecked task");
  });

  it("updates running operation badge from progress events including resolveRepair", () => {
    const state = {
      ...createContinueSceneState(),
      previewLoaded: true,
      taskItems: [{ line: 8, textLines: ["Task body"] }],
      sourceTarget: "migrations/",
    };
    const runState = createInitialRunState();
    runState.actionLabel = "materialize";
    runState.sourceTarget = "migrations/";
    runState.runStartedAt = Date.now();
    runState.totalTasks = 1;

    applyOutputEvent(runState, {
      kind: "progress",
      progress: { label: "resolveRepair", current: 2, total: 3, detail: "repairing" },
    });

    const lines = stripAnsi(renderContinueSceneLines({
      uiState: "running",
      state,
      runState,
      currentWorkingDirectory: process.cwd(),
      sectionGap: 1,
      hintGap: 1,
      errorGap: 1,
    }));

    expect(lines.join("\n")).toContain("Operation:     RESOLVEREPAIR");
    expect(lines.join("\n")).toContain("Phase Counters:");
    expect(lines.join("\n")).toContain("current: 2/3");
  });

  it("transitions to done and shows failure details for non-zero exit", () => {
    const state = {
      ...createContinueSceneState(),
      previewLoaded: true,
      taskItems: [{ line: 3, textLines: ["Will fail"] }],
    };
    const runState = createInitialRunState();
    runState.actionLabel = "materialize";
    runState.sourceTarget = "migrations/";
    runState.runStartedAt = Date.now() - 5000;
    runState.totalTasks = 1;
    runState.finished = true;
    runState.exitCode = 1;
    runState.error = "Verification failed in step verify";
    runState.failures = 1;

    const nextUiState = updateContinueUiState("running", runState);
    const lines = stripAnsi(renderContinueSceneLines({
      uiState: nextUiState,
      state,
      runState,
      currentWorkingDirectory: process.cwd(),
      sectionGap: 1,
      hintGap: 1,
      errorGap: 1,
    }));

    expect(nextUiState).toBe("done");
    expect(lines.join("\n")).toContain("Run failed (exit 1). Press Esc to return to menu.");
    expect(lines.join("\n")).toContain("Verification failed in step verify");
    expect(lines.join("\n")).toContain("Summary:");
  });

  it("returns to main menu only on Esc after completion", async () => {
    const state = createContinueSceneState();
    const runState = createInitialRunState();

    const enterResult = await handleContinueInput({
      rawInput: "\n",
      uiState: "done",
      state,
      runState,
      currentWorkingDirectory: process.cwd(),
    });
    expect(enterResult.handled).toBe(false);

    const escResult = await handleContinueInput({
      rawInput: "\u001b",
      uiState: "done",
      state,
      runState,
      currentWorkingDirectory: process.cwd(),
    });
    expect(escResult.handled).toBe(true);
    expect(escResult.backToParent).toBe(true);
  });

  it("starts run on Enter from previewing", async () => {
    const state = {
      ...createContinueSceneState(),
      previewLoaded: true,
      sourceTarget: "migrations/",
      taskItems: [{ line: 10, textLines: ["Task 1"] }],
    };
    const runState = createInitialRunState();

    const result = await handleContinueInput({
      rawInput: "\n",
      uiState: "previewing",
      state,
      runState,
      currentWorkingDirectory: process.cwd(),
    });

    expect(result.handled).toBe(true);
    expect(result.uiState).toBe("running");
    expect(result.runState.totalTasks).toBe(1);
    expect(createApp).toHaveBeenCalled();
  });

  it("shows pause hint on Space while running", async () => {
    const state = createContinueSceneState();
    const runState = createInitialRunState();

    const result = await handleContinueInput({
      rawInput: " ",
      uiState: "running",
      state,
      runState,
      currentWorkingDirectory: process.cwd(),
    });

    expect(result.handled).toBe(true);
    expect(result.uiState).toBe("running");
    expect(result.state.uiHint).toBe("Pause not yet supported.");
  });

  it("stops run on s and releases locks", async () => {
    const releaseAllLocks = vi.fn();
    const awaitShutdown = vi.fn(async () => {});
    const state = createContinueSceneState();
    const runState = {
      ...createInitialRunState(),
      app: { releaseAllLocks, awaitShutdown },
    };

    const result = await handleContinueInput({
      rawInput: "s",
      uiState: "running",
      state,
      runState,
      currentWorkingDirectory: process.cwd(),
    });

    expect(result.handled).toBe(true);
    expect(result.uiState).toBe("done");
    expect(releaseAllLocks).toHaveBeenCalledTimes(1);
    expect(awaitShutdown).toHaveBeenCalledTimes(1);
    expect(result.runState.finished).toBe(true);
    expect(result.runState.exitCode).toBe(130);
  });
});
