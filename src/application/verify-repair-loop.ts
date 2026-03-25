import type { Task } from "../domain/parser.js";
import type {
  PromptTransport,
  TaskCorrectionPort,
  TaskValidationPort,
  ValidationSidecar,
} from "../domain/ports/index.js";
import type { ApplicationOutputPort } from "../domain/ports/output-port.js";

type ArtifactContext = any;

export interface VerifyRepairLoopDependencies {
  taskValidation: TaskValidationPort;
  taskCorrection: TaskCorrectionPort;
  validationSidecar: ValidationSidecar;
  output: ApplicationOutputPort;
}

export interface VerifyRepairLoopInput {
  task: Task;
  source: string;
  contextBefore: string;
  validateTemplate: string;
  correctTemplate: string;
  workerCommand: string[];
  transport: PromptTransport;
  maxRepairAttempts: number;
  allowCorrection: boolean;
  templateVars: Record<string, unknown>;
  artifactContext: ArtifactContext;
}

export async function runVerifyRepairLoop(
  dependencies: VerifyRepairLoopDependencies,
  input: VerifyRepairLoopInput,
): Promise<boolean> {
  const emit = dependencies.output.emit.bind(dependencies.output);
  emit({ kind: "info", message: "Running verification..." });

  const valid = await dependencies.taskValidation.validate({
    task: input.task,
    source: input.source,
    contextBefore: input.contextBefore,
    template: input.validateTemplate,
    command: input.workerCommand,
    mode: "wait",
    transport: input.transport,
    templateVars: input.templateVars,
    artifactContext: input.artifactContext,
  });

  if (valid) {
    dependencies.validationSidecar.remove(input.task);
    emit({ kind: "success", message: "Verification passed." });
    return true;
  }

  if (!input.allowCorrection) {
    return false;
  }

  emit({ kind: "warn", message: "Verification failed. Running repair (" + input.maxRepairAttempts + " attempt(s))..." });
  const result = await dependencies.taskCorrection.correct({
    task: input.task,
    source: input.source,
    contextBefore: input.contextBefore,
    correctTemplate: input.correctTemplate,
    validateTemplate: input.validateTemplate,
    command: input.workerCommand,
    maxRetries: input.maxRepairAttempts,
    mode: "wait",
    transport: input.transport,
    templateVars: input.templateVars,
    artifactContext: input.artifactContext,
  });

  if (!result.valid) {
    return false;
  }

  dependencies.validationSidecar.remove(input.task);
  emit({ kind: "success", message: "Repair succeeded after " + result.attempts + " attempt(s)." });
  return true;
}
