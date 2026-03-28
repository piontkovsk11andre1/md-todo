import { describe, expect, it, vi } from "vitest";
import { runVerifyRepairLoop } from "../../src/application/verify-repair-loop.js";
import type { Task } from "../../src/domain/parser.js";

describe("verify-repair-loop trace metrics", () => {
  it("emits verification.efficiency on first-pass success", async () => {
    const traceWriter = {
      write: vi.fn(),
      flush: vi.fn(),
    };

    const result = await runVerifyRepairLoop({
      taskVerification: {
        verify: vi.fn(async () => true),
      },
      taskRepair: {
        repair: vi.fn(async () => ({ valid: false, attempts: 0 })),
      },
      verificationSidecar: {
        filePath: vi.fn(() => ""),
        read: vi.fn(() => null),
        remove: vi.fn(),
      },
      traceWriter,
      output: {
        emit: vi.fn(),
      },
    }, {
      task: createTask(),
      source: "- [ ] ship release",
      contextBefore: "",
      verifyTemplate: "{{task}}",
      repairTemplate: "{{task}}",
      workerCommand: ["opencode", "run"],
      transport: "file",
      maxRepairAttempts: 2,
      allowRepair: true,
      templateVars: {},
      artifactContext: { runId: "run-1" },
      trace: true,
    });

    expect(result).toBe(true);
    expect(traceWriter.write).toHaveBeenCalledWith(expect.objectContaining({
      event_type: "verification.efficiency",
      payload: {
        first_pass_success: true,
        total_verify_attempts: 1,
        total_repair_attempts: 0,
        verification_to_execution_ratio: null,
        cumulative_failure_reasons: [],
      },
    }));
  });

  it("emits verification.efficiency with retries and cumulative failure reasons", async () => {
    const traceWriter = {
      write: vi.fn(),
      flush: vi.fn(),
    };

    const sidecarRead = vi.fn()
      .mockReturnValueOnce("missing test coverage")
      .mockReturnValueOnce("missing test coverage")
      .mockReturnValueOnce("missing test coverage")
      .mockReturnValueOnce("still failing assertions");

    const result = await runVerifyRepairLoop({
      taskVerification: {
        verify: vi.fn(async () => false),
      },
      taskRepair: {
        repair: vi.fn()
          .mockResolvedValueOnce({ valid: false, attempts: 1 })
          .mockResolvedValueOnce({ valid: true, attempts: 1 }),
      },
      verificationSidecar: {
        filePath: vi.fn(() => ""),
        read: sidecarRead,
        remove: vi.fn(),
      },
      traceWriter,
      output: {
        emit: vi.fn(),
      },
    }, {
      task: createTask(),
      source: "- [ ] ship release",
      contextBefore: "",
      verifyTemplate: "{{task}}",
      repairTemplate: "{{task}}",
      workerCommand: ["opencode", "run"],
      transport: "file",
      maxRepairAttempts: 3,
      allowRepair: true,
      templateVars: {},
      artifactContext: { runId: "run-2" },
      trace: true,
    });

    expect(result).toBe(true);
    expect(traceWriter.write).toHaveBeenCalledWith(expect.objectContaining({
      event_type: "verification.efficiency",
      payload: expect.objectContaining({
        first_pass_success: false,
        total_verify_attempts: 3,
        total_repair_attempts: 2,
        cumulative_failure_reasons: ["missing test coverage", "still failing assertions"],
      }),
    }));

    const efficiencyEvent = traceWriter.write.mock.calls
      .map((call) => call[0])
      .find((event) => event?.event_type === "verification.efficiency");

    const ratio = efficiencyEvent?.payload.verification_to_execution_ratio;
    if (ratio !== null) {
      expect(typeof ratio).toBe("number");
      expect(ratio).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("verify-repair-loop output", () => {
  it("does not emit a failure-reason error when verification passes", async () => {
    const output = {
      emit: vi.fn(),
    };

    const result = await runVerifyRepairLoop({
      taskVerification: {
        verify: vi.fn(async () => true),
      },
      taskRepair: {
        repair: vi.fn(async () => ({ valid: false, attempts: 0 })),
      },
      verificationSidecar: {
        filePath: vi.fn(() => ""),
        read: vi.fn(() => "should not be emitted"),
        remove: vi.fn(),
      },
      traceWriter: {
        write: vi.fn(),
        flush: vi.fn(),
      },
      output,
    }, {
      task: createTask(),
      source: "- [ ] ship release",
      contextBefore: "",
      verifyTemplate: "{{task}}",
      repairTemplate: "{{task}}",
      workerCommand: ["opencode", "run"],
      transport: "file",
      maxRepairAttempts: 2,
      allowRepair: false,
      templateVars: {},
      artifactContext: { runId: "run-5" },
      trace: false,
    });

    expect(result).toBe(true);
    expect(output.emit).not.toHaveBeenCalledWith(expect.objectContaining({
      kind: "error",
      message: expect.stringContaining("Last validation error:"),
    }));
  });

  it("emits the last failure reason when verification fails without repair", async () => {
    const output = {
      emit: vi.fn(),
    };

    const result = await runVerifyRepairLoop({
      taskVerification: {
        verify: vi.fn(async () => false),
      },
      taskRepair: {
        repair: vi.fn(async () => ({ valid: false, attempts: 0 })),
      },
      verificationSidecar: {
        filePath: vi.fn(() => ""),
        read: vi.fn(() => "schema mismatch on metadata.version"),
        remove: vi.fn(),
      },
      traceWriter: {
        write: vi.fn(),
        flush: vi.fn(),
      },
      output,
    }, {
      task: createTask(),
      source: "- [ ] ship release",
      contextBefore: "",
      verifyTemplate: "{{task}}",
      repairTemplate: "{{task}}",
      workerCommand: ["opencode", "run"],
      transport: "file",
      maxRepairAttempts: 2,
      allowRepair: false,
      templateVars: {},
      artifactContext: { runId: "run-3" },
      trace: false,
    });

    expect(result).toBe(false);
    expect(output.emit).toHaveBeenCalledWith({
      kind: "error",
      message: "Last validation error: schema mismatch on metadata.version",
    });
  });

  it("emits the last failure reason when all repair attempts are exhausted", async () => {
    const output = {
      emit: vi.fn(),
    };

    const sidecarRead = vi.fn()
      .mockReturnValueOnce("missing integration test")
      .mockReturnValueOnce("missing integration test")
      .mockReturnValueOnce("assertion failed in attempt 1")
      .mockReturnValueOnce("type mismatch in payload.id");

    const result = await runVerifyRepairLoop({
      taskVerification: {
        verify: vi.fn(async () => false),
      },
      taskRepair: {
        repair: vi.fn()
          .mockResolvedValueOnce({ valid: false, attempts: 1 })
          .mockResolvedValueOnce({ valid: false, attempts: 1 }),
      },
      verificationSidecar: {
        filePath: vi.fn(() => ""),
        read: sidecarRead,
        remove: vi.fn(),
      },
      traceWriter: {
        write: vi.fn(),
        flush: vi.fn(),
      },
      output,
    }, {
      task: createTask(),
      source: "- [ ] ship release",
      contextBefore: "",
      verifyTemplate: "{{task}}",
      repairTemplate: "{{task}}",
      workerCommand: ["opencode", "run"],
      transport: "file",
      maxRepairAttempts: 2,
      allowRepair: true,
      templateVars: {},
      artifactContext: { runId: "run-4" },
      trace: false,
    });

    expect(result).toBe(false);
    expect(output.emit).toHaveBeenCalledWith({
      kind: "error",
      message: "Last validation error: type mismatch in payload.id",
    });
  });
});

function createTask(): Task {
  return {
    text: "Ship release",
    checked: false,
    index: 0,
    line: 1,
    column: 1,
    offsetStart: 0,
    offsetEnd: 12,
    file: "tasks.md",
    isInlineCli: false,
    depth: 0,
  };
}
