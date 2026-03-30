import type { Task } from "../domain/parser.js";
import type {
  CommandExecutionOptions,
  CommandExecutor,
  PromptTransport,
  TaskRepairPort,
  TaskVerificationPort,
  TraceWriterPort,
  VerificationStore,
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
  verificationStore: VerificationStore;
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
  configDir?: string;
  maxRepairAttempts: number;
  allowRepair: boolean;
  templateVars: Record<string, unknown>;
  artifactContext: ArtifactContext;
  trace: boolean;
  cliBlockExecutor?: CommandExecutor;
  cliExecutionOptions?: CommandExecutionOptions;
  cliExpansionEnabled?: boolean;
}

export interface VerifyRepairLoopResult {
  valid: boolean;
  failureReason: string | null;
}

export async function runVerifyRepairLoop(
  dependencies: VerifyRepairLoopDependencies,
  input: VerifyRepairLoopInput,
): Promise<VerifyRepairLoopResult> {
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
          : dependencies.verificationStore.read(input.task) ?? "Verification failed (no details).",
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
    configDir: input.configDir,
    templateVars: input.templateVars,
    artifactContext: input.artifactContext,
    trace: input.trace,
    cliBlockExecutor: input.cliBlockExecutor,
    cliExecutionOptions: input.cliExecutionOptions,
    cliExpansionEnabled: input.cliExpansionEnabled,
  });
  verificationDurationMs += Math.max(0, Date.now() - initialVerificationStartedAt);
  verifyAttempts += 1;

  const initialFailureReason = valid
    ? null
    : dependencies.verificationStore.read(input.task) ?? "Verification failed (no details).";

  if (initialFailureReason) {
    cumulativeFailureReasons.push(initialFailureReason);
  }

  firstPassSuccess = valid;
  emitVerificationResult(valid, 1);

  if (valid) {
    dependencies.verificationStore.remove(input.task);
    emitVerificationEfficiency();
    emit({ kind: "success", message: "Verification passed." });
    return { valid: true, failureReason: null };
  }

  if (!input.allowRepair) {
    const failureReason = cumulativeFailureReasons.at(-1) ?? initialFailureReason;
    emitRepairOutcome(false, 0);
    emitVerificationEfficiency();
    emit({ kind: "error", message: "Last validation error: " + (failureReason ?? "Verification failed (no details).") });
    return { valid: false, failureReason };
  }

  const repairWarningReason = initialFailureReason ?? "Verification failed (no details).";
  emit({
    kind: "warn",
    message: "Verification failed: " + repairWarningReason + ". Running repair (" + input.maxRepairAttempts + " attempt(s))...",
  });
  let attempts = 0;
  let previousFailure = dependencies.verificationStore.read(input.task) ?? "Verification failed (no details).";

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
      configDir: input.configDir,
      templateVars: input.templateVars,
      artifactContext: input.artifactContext,
      trace: input.trace,
      cliBlockExecutor: input.cliBlockExecutor,
      cliExecutionOptions: input.cliExecutionOptions,
      cliExpansionEnabled: input.cliExpansionEnabled,
    });
    executionDurationMs += Math.max(0, Date.now() - repairStartedAt);

    verifyAttempts += 1;
    const repairFailureReason = result.valid
      ? null
      : dependencies.verificationStore.read(input.task) ?? "Verification failed (no details).";

    if (repairFailureReason) {
      cumulativeFailureReasons.push(repairFailureReason);
    }
    emitVerificationResult(result.valid, attempts + 1);

    if (result.valid) {
      emitRepairOutcome(true, attempts);
      dependencies.verificationStore.remove(input.task);
      emitVerificationEfficiency();
      emit({ kind: "success", message: "Repair succeeded after " + attempts + " attempt(s)." });
      return { valid: true, failureReason: null };
    }

    emit({
      kind: "warn",
      message: "Repair attempt " + attempts + " failed: " + (repairFailureReason ?? "Verification failed (no details)."),
    });

    previousFailure = repairFailureReason ?? "Verification failed (no details).";
  }

  emitRepairOutcome(false, attempts);
  emitVerificationEfficiency();
  const failureReason = cumulativeFailureReasons.at(-1) ?? initialFailureReason;
  emit({ kind: "error", message: "Last validation error: " + (failureReason ?? "Verification failed (no details).") });
  return { valid: false, failureReason };
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
