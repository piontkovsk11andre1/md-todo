import type {
  TaskRepairOptions,
  TaskRepairPort,
  TaskRepairResult,
} from "../../domain/ports/task-repair-port.js";
import type { VerificationStore } from "../../domain/ports/verification-store.js";
import type { ExtraTemplateVars } from "../../domain/template-vars.js";
import type { RuntimeArtifactsContext } from "../runtime-artifacts.js";
import { repair } from "../repair.js";

export function createTaskRepairAdapter(verificationStore: VerificationStore): TaskRepairPort {
  return {
    repair(options: TaskRepairOptions): Promise<TaskRepairResult> {
      return repair({
        ...options,
        verificationStore,
        templateVars: options.templateVars as ExtraTemplateVars | undefined,
        artifactContext: options.artifactContext as RuntimeArtifactsContext | undefined,
        cliBlockExecutor: options.cliBlockExecutor,
        cliExecutionOptions: options.cliExecutionOptions,
      });
    },
  };
}
