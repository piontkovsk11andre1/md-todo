import type { Task } from "../parser.js";
import type { CommandExecutionOptions, CommandExecutor } from "./command-executor.js";
import type { ProcessRunMode } from "./process-runner.js";
import type { PromptTransport } from "./worker-executor-port.js";

export interface TaskVerificationOptions {
  task: Task;
  source: string;
  contextBefore: string;
  template: string;
  command: string[];
  mode?: ProcessRunMode;
  transport?: PromptTransport;
  trace?: boolean;
  cwd?: string;
  configDir?: string;
  templateVars?: Record<string, unknown>;
  artifactContext?: unknown;
  cliBlockExecutor?: CommandExecutor;
  cliExecutionOptions?: CommandExecutionOptions;
  cliExpansionEnabled?: boolean;
}

export interface TaskVerificationPort {
  verify(options: TaskVerificationOptions): Promise<boolean>;
}
