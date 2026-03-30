export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface CommandExecutionOptions {
  timeoutMs?: number;
  artifactContext?: unknown;
  artifactPhase?: "execute" | "verify" | "repair" | "worker" | "plan" | "discuss";
  artifactPhaseLabel?: string;
  artifactExtra?: Record<string, unknown>;
  artifactCommandOrdinal?: number;
  onCommandExecuted?: (execution: {
    command: string;
    exitCode: number | null;
    stdoutLength: number;
    stderrLength: number;
    durationMs: number;
  }) => void | Promise<void>;
}

export const DEFAULT_CLI_BLOCK_EXEC_TIMEOUT_MS = 30_000;

export interface CommandExecutor {
  execute(
    command: string,
    cwd: string,
    options?: CommandExecutionOptions,
  ): Promise<CommandResult>;
}
