import { describe, expect, it } from "vitest";
import {
  createContinueSceneState,
  handleContinueInput,
  renderContinueSceneLines,
  updateContinueUiState,
} from "../../../src/presentation/tui/scenes/continue.js";
import { applyOutputEvent, createInitialRunState } from "../../../src/presentation/tui/output-bridge.js";

function stripAnsi(lines: string[]): string[] {
  return lines.map((line) => line.replace(/\u001B\[[0-9;]*m/g, ""));
}

describe("continue scene cockpit", () => {
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
});
