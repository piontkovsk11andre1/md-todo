import type { Task } from "../domain/parser.js";
import type {
  PromptTransport,
  TaskRepairPort,
  TaskVerificationPort,
  TraceWriterPort,
  VerificationSidecar,
} from "../domain/ports/index.js";
import type { ApplicationOutputPort } from "../domain/ports/output-port.js";
import {
  createRepairAttemptEvent,
  createRepairOutcomeEvent,
  createVerificationEfficiencyEvent,
  createVerificationResultEvent,
} from "../domain/trace.js";

type ArtifactContext = any;

export interface VerifyRepairLoopDependencies {
  taskVerification: TaskVerificationPort;
  taskRepair: TaskRepairPort;
  verificationSidecar: VerificationSidecar;
  traceWriter: TraceWriterPort;
  output: ApplicationOutputPort;
}

export interface VerifyRepairLoopInput {
  task: Task;
  source: string;
  contextBefore: string;
  verifyTemplate: string;
  repairTemplate: string;
  workerCommand: string[];
  transport: PromptTransport;
  maxRepairAttempts: number;
  allowRepair: boolean;
  templateVars: Record<string, unknown>;
  artifactContext: ArtifactContext;
  trace: boolean;
}

export async function runVerifyRepairLoop(
  dependencies: VerifyRepairLoopDependencies,
  input: VerifyRepairLoopInput,
): Promise<boolean> {
  const emit = dependencies.output.emit.bind(dependencies.output);
  const runId = resolveTraceRunId(input.artifactContext);
  const emitVerificationResult = (valid: boolean, attemptNumber: number): void => {
    if (!input.trace || !runId) {
      return;
    }

    dependencies.traceWriter.write(createVerificationResultEvent({
      timestamp: new Date().toISOString(),
      run_id: runId,
      payload: {
        outcome: valid ? "pass" : "fail",
        failure_reason: valid
          ? null
          : dependencies.verificationSidecar.read(input.task) ?? "Verification failed (no details).",
        attempt_number: attemptNumber,
      },
    }));
  };

  const emitRepairAttempt = (attemptNumber: number, previousFailure: string | null): void => {
    if (!input.trace || !runId) {
      return;
    }

    dependencies.traceWriter.write(createRepairAttemptEvent({
      timestamp: new Date().toISOString(),
      run_id: runId,
      payload: {
        attempt_number: attemptNumber,
        max_attempts: input.maxRepairAttempts,
        previous_failure: previousFailure,
      },
    }));
  };

  const emitRepairOutcome = (finalValid: boolean, totalAttempts: number): void => {
    if (!input.trace || !runId) {
      return;
    }

    dependencies.traceWriter.write(createRepairOutcomeEvent({
      timestamp: new Date().toISOString(),
      run_id: runId,
      payload: {
        final_valid: finalValid,
        total_attempts: totalAttempts,
      },
    }));
  };

  let verifyAttempts = 0;
  let repairAttempts = 0;
  let firstPassSuccess = false;
  const cumulativeFailureReasons: string[] = [];
  let verificationDurationMs = 0;
  let executionDurationMs = 0;

  const emitVerificationEfficiency = (): void => {
    if (!input.trace || !runId) {
      return;
    }

    const verificationToExecutionRatio = executionDurationMs > 0
      ? verificationDurationMs / executionDurationMs
      : null;

    dependencies.traceWriter.write(createVerificationEfficiencyEvent({
      timestamp: new Date().toISOString(),
      run_id: runId,
      payload: {
        first_pass_success: firstPassSuccess,
        total_verify_attempts: verifyAttempts,
        total_repair_attempts: repairAttempts,
        verification_to_execution_ratio: verificationToExecutionRatio,
        cumulative_failure_reasons: cumulativeFailureReasons,
      },
    }));
  };

  emit({ kind: "info", message: "Running verification..." });

  const initialVerificationStartedAt = Date.now();
  const valid = await dependencies.taskVerification.verify({
    task: input.task,
    source: input.source,
    contextBefore: input.contextBefore,
    template: input.verifyTemplate,
    command: input.workerCommand,
    mode: "wait",
    transport: input.transport,
    templateVars: input.templateVars,
    artifactContext: input.artifactContext,
    trace: input.trace,
  });
  verificationDurationMs += Math.max(0, Date.now() - initialVerificationStartedAt);
  verifyAttempts += 1;

  const initialFailureReason = valid
    ? null
    : dependencies.verificationSidecar.read(input.task) ?? "Verification failed (no details).";

  if (initialFailureReason) {
    cumulativeFailureReasons.push(initialFailureReason);
  }

  firstPassSuccess = valid;
  emitVerificationResult(valid, 1);

  if (valid) {
    dependencies.verificationSidecar.remove(input.task);
    emitVerificationEfficiency();
    emit({ kind: "success", message: "Verification passed." });
    return true;
  }

  if (!input.allowRepair) {
    emitRepairOutcome(false, 0);
    emitVerificationEfficiency();
    emit({ kind: "error", message: "Last validation error: " + (initialFailureReason ?? "Verification failed (no details).") });
    return false;
  }

  emit({ kind: "warn", message: "Verification failed. Running repair (" + input.maxRepairAttempts + " attempt(s))..." });
  let attempts = 0;
  let previousFailure = dependencies.verificationSidecar.read(input.task) ?? "Verification failed (no details).";

  while (attempts < input.maxRepairAttempts) {
    attempts += 1;
    repairAttempts = attempts;
    emitRepairAttempt(attempts, previousFailure);

    const repairStartedAt = Date.now();
    const result = await dependencies.taskRepair.repair({
      task: input.task,
      source: input.source,
      contextBefore: input.contextBefore,
      repairTemplate: input.repairTemplate,
      verifyTemplate: input.verifyTemplate,
      command: input.workerCommand,
      maxRetries: 1,
      mode: "wait",
      transport: input.transport,
      templateVars: input.templateVars,
      artifactContext: input.artifactContext,
      trace: input.trace,
    });
    executionDurationMs += Math.max(0, Date.now() - repairStartedAt);

    verifyAttempts += 1;
    const repairFailureReason = result.valid
      ? null
      : dependencies.verificationSidecar.read(input.task) ?? "Verification failed (no details).";

    if (repairFailureReason) {
      cumulativeFailureReasons.push(repairFailureReason);
    }
    emitVerificationResult(result.valid, attempts + 1);

    if (result.valid) {
      emitRepairOutcome(true, attempts);
      dependencies.verificationSidecar.remove(input.task);
      emitVerificationEfficiency();
      emit({ kind: "success", message: "Repair succeeded after " + attempts + " attempt(s)." });
      return true;
    }

    previousFailure = repairFailureReason ?? "Verification failed (no details).";
  }

  emitRepairOutcome(false, attempts);
  emitVerificationEfficiency();
  const lastReason = cumulativeFailureReasons.at(-1) ?? "Verification failed (no details).";
  emit({ kind: "error", message: "Last validation error: " + lastReason });
  return false;
}

function resolveTraceRunId(artifactContext: ArtifactContext): string | null {
  if (!artifactContext || typeof artifactContext !== "object") {
    return null;
  }

  const runId = (artifactContext as { runId?: unknown }).runId;
  return typeof runId === "string" && runId.length > 0
    ? runId
    : null;
}
