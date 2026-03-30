import type {
  TaskVerificationOptions,
  TaskVerificationPort,
} from "../../domain/ports/task-verification-port.js";
import type { VerificationStore } from "../../domain/ports/verification-store.js";
import type { ExtraTemplateVars } from "../../domain/template-vars.js";
import type { RuntimeArtifactsContext } from "../runtime-artifacts.js";
import { verify } from "../verification.js";

export function createTaskVerificationAdapter(verificationStore: VerificationStore): TaskVerificationPort {
  return {
    verify(options: TaskVerificationOptions) {
      return verify({
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
