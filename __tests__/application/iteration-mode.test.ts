import { describe, expect, it, vi } from "vitest";
import { resolveIterationVerificationMode } from "../../src/application/iteration-mode.js";
import type { Task } from "../../src/domain/parser.js";

function createTask(text: string): Task {
  return {
    text,
    checked: false,
    index: 0,
    line: 1,
    column: 1,
    offsetStart: 0,
    offsetEnd: text.length,
    file: "tasks.md",
    isInlineCli: false,
    depth: 0,
    children: [],
    subItems: [],
  };
}

describe("resolveIterationVerificationMode", () => {
  it.each(["fast", "raw"])("suppresses verification for %s tasks when configuredShouldVerify is enabled", (prefix) => {
    const emit = vi.fn();

    const mode = resolveIterationVerificationMode({
      configuredOnlyVerify: false,
      configuredShouldVerify: true,
      forceExecute: false,
      task: createTask(`${prefix}: ship release notes`),
      emit,
    });

    expect(mode.taskIntentDecision.intent).toBe("fast-execution");
    expect(mode.onlyVerify).toBe(false);
    expect(mode.shouldVerify).toBe(false);
    expect(emit).toHaveBeenCalledWith({
      kind: "info",
      message: "Task uses fast/raw intent (explicit fast marker); skipping verification.",
    });
  });

  it("suppresses verification for fast tasks when configuredOnlyVerify is enabled", () => {
    const emit = vi.fn();

    const mode = resolveIterationVerificationMode({
      configuredOnlyVerify: true,
      configuredShouldVerify: false,
      forceExecute: false,
      task: createTask("fast: ship release notes"),
      emit,
    });

    expect(mode.taskIntentDecision.intent).toBe("fast-execution");
    expect(mode.onlyVerify).toBe(false);
    expect(mode.shouldVerify).toBe(false);
    expect(emit).toHaveBeenCalledWith({
      kind: "info",
      message: "Task uses fast/raw intent (explicit fast marker); skipping verification.",
    });
  });

  it("suppresses verification for tasks with inherited fast-execution directive intent", () => {
    const emit = vi.fn();

    const mode = resolveIterationVerificationMode({
      configuredOnlyVerify: false,
      configuredShouldVerify: true,
      forceExecute: false,
      task: {
        ...createTask("Ship release notes"),
        intent: "fast-execution",
      },
      emit,
    });

    expect(mode.taskIntentDecision.intent).toBe("fast-execution");
    expect(mode.onlyVerify).toBe(false);
    expect(mode.shouldVerify).toBe(false);
    expect(emit).toHaveBeenCalledWith({
      kind: "info",
      message: "Task uses fast/raw intent (inherited directive intent); skipping verification.",
    });
  });

  it("keeps verify-only behavior unchanged for verify-prefixed tasks", () => {
    const emit = vi.fn();

    const mode = resolveIterationVerificationMode({
      configuredOnlyVerify: false,
      configuredShouldVerify: false,
      forceExecute: false,
      task: createTask("verify: confirm changelog is complete"),
      emit,
    });

    expect(mode.taskIntentDecision.intent).toBe("verify-only");
    expect(mode.onlyVerify).toBe(true);
    expect(mode.shouldVerify).toBe(true);
    expect(emit).toHaveBeenCalledWith({
      kind: "info",
      message: "Task classified as verify-only (explicit marker); skipping execution.",
    });
  });
});
