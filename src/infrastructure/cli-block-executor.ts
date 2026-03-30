import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_CLI_BLOCK_EXEC_TIMEOUT_MS,
  type CommandExecutionOptions,
  type CommandExecutor,
  type CommandResult,
} from "../domain/ports/command-executor.js";
import {
  beginRuntimePhase,
  completeRuntimePhase,
  type RuntimeArtifactsContext,
  type RuntimePhaseHandle,
} from "./runtime-artifacts.js";

export function createCliBlockExecutor(): CommandExecutor {
  return {
    execute(
      command: string,
      cwd: string,
      options?: CommandExecutionOptions,
    ): Promise<CommandResult> {
      return new Promise((resolve, reject) => {
        const phaseHandle = beginCliCommandPhase(command, options);
        const child = spawn(command, {
          stdio: ["inherit", "pipe", "pipe"],
          cwd,
          // `shell: true` uses the host default shell (`/bin/sh` on Unix,
          // `process.env.ComSpec`/`cmd.exe` on Windows).
          shell: true,
        });

        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let timedOut = false;

        const configuredTimeout = options?.timeoutMs;
        const effectiveTimeoutMs = typeof configuredTimeout === "number"
          ? configuredTimeout
          : DEFAULT_CLI_BLOCK_EXEC_TIMEOUT_MS;
        const timeoutMs = effectiveTimeoutMs > 0 ? Math.floor(effectiveTimeoutMs) : 0;
        const timeoutHandle = timeoutMs > 0
          ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
          }, timeoutMs)
          : null;

        child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
        child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));

        child.on("close", (exitCode) => {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }

          if (timedOut) {
            const timedOutStderr = Buffer.concat(stderr).toString("utf-8");
            const timeoutMessage = `Command timed out after ${timeoutMs}ms.`;
            const stderrWithTimeout = timedOutStderr.length > 0
              ? `${timedOutStderr}${timedOutStderr.endsWith("\n") ? "" : "\n"}${timeoutMessage}`
              : timeoutMessage;
            const stdoutText = Buffer.concat(stdout).toString("utf-8");

            completeCliCommandPhase(phaseHandle, {
              exitCode: 124,
              stdout: stdoutText,
              stderr: stderrWithTimeout,
            });
            writeCliCommandOutputArtifacts(phaseHandle, options, stdoutText, stderrWithTimeout);
            resolve({
              exitCode: 124,
              stdout: stdoutText,
              stderr: stderrWithTimeout,
            });
            return;
          }

          const stdoutText = Buffer.concat(stdout).toString("utf-8");
          const stderrText = Buffer.concat(stderr).toString("utf-8");

          completeCliCommandPhase(phaseHandle, {
            exitCode,
            stdout: stdoutText,
            stderr: stderrText,
          });
          writeCliCommandOutputArtifacts(phaseHandle, options, stdoutText, stderrText);
          resolve({
            exitCode,
            stdout: stdoutText,
            stderr: stderrText,
          });
        });

        child.on("error", (error) => {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
          }

          completeRuntimePhaseSafely(phaseHandle, {
            exitCode: null,
            outputCaptured: true,
            notes: error.message,
            extra: { error: true },
          });
          reject(error);
        });
      });
    },
  };
}

function beginCliCommandPhase(
  command: string,
  options: CommandExecutionOptions | undefined,
): RuntimePhaseHandle | null {
  const artifactContext = resolveArtifactContext(options?.artifactContext);
  if (!artifactContext) {
    return null;
  }

  return beginRuntimePhase(artifactContext, {
    phase: options?.artifactPhase ?? "worker",
    phaseLabel: options?.artifactPhaseLabel,
    command: [command],
    mode: "wait",
    transport: "cli-block",
    extra: {
      cliBlockCommand: command,
      ...(options?.artifactExtra ?? {}),
    },
  });
}

function completeCliCommandPhase(
  phaseHandle: RuntimePhaseHandle | null,
  result: CommandResult,
): void {
  completeRuntimePhaseSafely(phaseHandle, {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    outputCaptured: true,
  });
}

function completeRuntimePhaseSafely(
  phaseHandle: RuntimePhaseHandle | null,
  options: {
    exitCode: number | null;
    stdout?: string;
    stderr?: string;
    outputCaptured: boolean;
    notes?: string;
    extra?: Record<string, unknown>;
  },
): void {
  if (!phaseHandle) {
    return;
  }

  completeRuntimePhase(phaseHandle, options);
}

function resolveArtifactContext(input: unknown): RuntimeArtifactsContext | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const candidate = input as Partial<RuntimeArtifactsContext>;
  if (typeof candidate.runId !== "string" || typeof candidate.rootDir !== "string") {
    return null;
  }

  return candidate as RuntimeArtifactsContext;
}

function writeCliCommandOutputArtifacts(
  phaseHandle: RuntimePhaseHandle | null,
  options: CommandExecutionOptions | undefined,
  stdout: string,
  stderr: string,
): void {
  if (!phaseHandle) {
    return;
  }

  const commandOrdinal = normalizeCommandOrdinal(options?.artifactCommandOrdinal);
  const stdoutFileName = `cli-block-${commandOrdinal}-stdout.txt`;
  const stderrFileName = `cli-block-${commandOrdinal}-stderr.txt`;

  fs.writeFileSync(path.join(phaseHandle.dir, stdoutFileName), stdout, "utf-8");
  fs.writeFileSync(path.join(phaseHandle.dir, stderrFileName), stderr, "utf-8");
}

function normalizeCommandOrdinal(ordinal: number | undefined): number {
  if (typeof ordinal !== "number") {
    return 1;
  }

  if (!Number.isFinite(ordinal) || ordinal < 1) {
    return 1;
  }

  return Math.floor(ordinal);
}
