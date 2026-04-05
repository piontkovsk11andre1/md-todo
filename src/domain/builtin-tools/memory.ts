import type { ToolHandlerFn } from "../ports/tool-handler-port.js";
import type { ProcessRunMode } from "../ports/process-runner.js";
import type { MemoryWriterPort } from "../ports/memory-writer-port.js";

/**
 * Creates a built-in memory-capture handler.
 *
 * Executes the worker, then persists the output via the memory writer port.
 * Returns `shouldVerify: true` so the standard verification pipeline continues.
 */
export function createMemoryHandler(memoryWriter?: MemoryWriterPort): ToolHandlerFn {
  return async (context) => {
    if (!memoryWriter) {
      return {
        exitCode: 1,
        failureMessage: "Memory capture requires a configured memory writer.",
        failureReason: "Memory writer is not configured.",
      };
    }

    const runResult = await context.workerExecutor.runWorker({
      workerPattern: context.workerPattern,
      prompt: context.payload,
      mode: context.mode as ProcessRunMode,
      trace: context.trace,
      cwd: context.cwd,
      env: context.executionEnv,
      configDir: context.configDir,
      artifactContext: context.artifactContext,
      artifactPhase: "execute",
    });

    if (context.showAgentOutput) {
      if (runResult.stdout) {
        context.emit({ kind: "text", text: runResult.stdout });
      }
      if (runResult.stderr) {
        context.emit({ kind: "stderr", text: runResult.stderr });
      }
    }

    if (runResult.exitCode !== 0 && runResult.exitCode !== null) {
      return {
        exitCode: runResult.exitCode,
        failureMessage: "Memory capture worker exited with code " + runResult.exitCode + ".",
        failureReason: "Memory capture worker exited with a non-zero code.",
      };
    }

    const normalizedOutput = runResult.stdout.trim();
    if (normalizedOutput.length === 0) {
      return {
        exitCode: 1,
        failureMessage: "Memory capture worker returned empty output; nothing to persist.",
        failureReason: "Memory capture worker returned empty output.",
      };
    }

    const writeResult = memoryWriter.write({
      sourcePath: context.task.file,
      workerOutput: normalizedOutput,
      capturePrefix: context.payload,
      originTask: {
        text: context.task.text,
        line: context.task.line,
      },
    });

    if (!writeResult.ok) {
      if (writeResult.error.warningMessage) {
        context.emit({ kind: "warn", message: writeResult.error.warningMessage });
      }
      return {
        exitCode: 1,
        failureMessage: writeResult.error.message,
        failureReason: writeResult.error.reason,
      };
    }

    if (writeResult.value.warningMessage) {
      context.emit({ kind: "warn", message: writeResult.value.warningMessage });
    }

    return {
      skipExecution: true,
      shouldVerify: true,
    };
  };
}
