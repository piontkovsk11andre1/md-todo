import { EXIT_CODE_SUCCESS } from "../domain/exit-codes.js";
import {
  getHarnessPresetPayload,
  listHarnessPresetKeys,
  resolveHarnessPresetKey,
} from "../domain/harness-preset-registry.js";
import type { ConfigDirResult } from "../domain/ports/config-dir-port.js";
import type { ApplicationOutputPort } from "../domain/ports/output-port.js";
import type { WorkerConfigPort } from "../domain/ports/worker-config-port.js";

export interface WithTaskOptions {
  harness: string;
}

export interface WithTaskDependencies {
  workerConfigPort: WorkerConfigPort;
  configDir: ConfigDirResult | undefined;
  output: ApplicationOutputPort;
}

function resolveConfigDirPath(configDir: ConfigDirResult | undefined): string {
  return configDir?.configDir ?? process.cwd();
}

function formatWorkerCommand(command: readonly string[]): string {
  return JSON.stringify(command);
}

/**
 * Creates the `with` command use case.
 *
 * Applies the selected harness preset by mutating only targeted worker and
 * command keys in local config, preserving all unrelated settings.
 */
export function createWithTask(
  dependencies: WithTaskDependencies,
): (options: WithTaskOptions) => number {
  const emit = dependencies.output.emit.bind(dependencies.output);

  return (options: WithTaskOptions): number => {
    const harnessKey = resolveHarnessPresetKey(options.harness);
    if (!harnessKey) {
      throw new Error(
        `Unknown harness preset: ${options.harness}. Supported presets: ${listHarnessPresetKeys().join(", ")}.`,
      );
    }

    if (!dependencies.workerConfigPort.setValue || !dependencies.workerConfigPort.unsetValue) {
      throw new Error("The `with` command is not available in this build.");
    }

    const configDirPath = resolveConfigDirPath(dependencies.configDir);
    const presetPayload = getHarnessPresetPayload(harnessKey);

    const defaultResult = dependencies.workerConfigPort.setValue(configDirPath, {
      scope: "local",
      keyPath: "workers.default",
      value: presetPayload.workers.default,
    });

    const tuiResult = presetPayload.workers.tui
      ? dependencies.workerConfigPort.setValue(configDirPath, {
        scope: "local",
        keyPath: "workers.tui",
        value: presetPayload.workers.tui,
      })
      : dependencies.workerConfigPort.unsetValue(configDirPath, {
        scope: "local",
        keyPath: "workers.tui",
      });

    const discussResult = presetPayload.commands?.discuss
      ? dependencies.workerConfigPort.setValue(configDirPath, {
        scope: "local",
        keyPath: "commands.discuss",
        value: presetPayload.commands.discuss,
      })
      : dependencies.workerConfigPort.unsetValue(configDirPath, {
        scope: "local",
        keyPath: "commands.discuss",
      });

    const configPath = defaultResult.configPath;
    const changed = defaultResult.changed || tuiResult.changed || discussResult.changed;

    emit({
      kind: changed ? "success" : "info",
      message: changed
        ? `Applied harness preset: ${harnessKey}`
        : `No change: harness preset ${harnessKey} is already configured.`,
    });
    emit({ kind: "info", message: `Path: ${configPath}` });
    emit({
      kind: "info",
      message: `Configured workers.default = ${formatWorkerCommand(presetPayload.workers.default)}`,
    });
    emit({
      kind: "info",
      message: presetPayload.workers.tui
        ? `Configured workers.tui = ${formatWorkerCommand(presetPayload.workers.tui)}`
        : "Removed workers.tui",
    });
    emit({
      kind: "info",
      message: presetPayload.commands?.discuss
        ? `Configured commands.discuss = ${formatWorkerCommand(presetPayload.commands.discuss)}`
        : "Removed commands.discuss",
    });

    return EXIT_CODE_SUCCESS;
  };
}
