import { EXIT_CODE_SUCCESS } from "../domain/exit-codes.js";
import type { ApplicationOutputPort } from "../domain/ports/output-port.js";
import type { ConfigDirResult } from "../domain/ports/config-dir-port.js";
import type { WorkerConfigPort } from "../domain/ports/worker-config-port.js";

export type ConfigMutationScope = "local" | "global";
export type ConfigValueType = "auto" | "string" | "number" | "boolean" | "json";

export interface ConfigSetOptions {
  scope: ConfigMutationScope;
  key: string;
  value: string;
  valueType: ConfigValueType;
}

export interface ConfigUnsetOptions {
  scope: ConfigMutationScope;
  key: string;
}

export interface ConfigMutationDependencies {
  workerConfigPort: WorkerConfigPort;
  configDir: ConfigDirResult | undefined;
  output: ApplicationOutputPort;
}

function parseConfigValue(raw: string, valueType: ConfigValueType): unknown {
  if (valueType === "string") {
    return raw;
  }

  if (valueType === "number") {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      throw new Error(`Invalid config value for --type number: ${raw}.`);
    }
    return parsed;
  }

  if (valueType === "boolean") {
    const normalized = raw.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
    throw new Error(`Invalid config value for --type boolean: ${raw}. Use true or false.`);
  }

  if (valueType === "json") {
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new Error(`Invalid config value for --type json: ${(error as Error).message}`);
    }
  }

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function resolveConfigDirPath(configDir: ConfigDirResult | undefined): string {
  return configDir?.configDir ?? process.cwd();
}

export function createConfigSet(
  dependencies: ConfigMutationDependencies,
): (options: ConfigSetOptions) => number {
  const emit = dependencies.output.emit.bind(dependencies.output);

  return (options: ConfigSetOptions): number => {
    if (!dependencies.workerConfigPort.setValue) {
      throw new Error("The `config set` command is not available in this build.");
    }

    const parsedValue = parseConfigValue(options.value, options.valueType);
    const result = dependencies.workerConfigPort.setValue(resolveConfigDirPath(dependencies.configDir), {
      scope: options.scope,
      keyPath: options.key,
      value: parsedValue,
    });

    if (result.changed) {
      emit({ kind: "success", message: `Updated ${options.scope} config: ${options.key}` });
      emit({ kind: "info", message: `Path: ${result.configPath}` });
    } else {
      emit({ kind: "info", message: `No change: ${options.key} already has the requested value.` });
      emit({ kind: "info", message: `Path: ${result.configPath}` });
    }

    return EXIT_CODE_SUCCESS;
  };
}

export function createConfigUnset(
  dependencies: ConfigMutationDependencies,
): (options: ConfigUnsetOptions) => number {
  const emit = dependencies.output.emit.bind(dependencies.output);

  return (options: ConfigUnsetOptions): number => {
    if (!dependencies.workerConfigPort.unsetValue) {
      throw new Error("The `config unset` command is not available in this build.");
    }

    const result = dependencies.workerConfigPort.unsetValue(resolveConfigDirPath(dependencies.configDir), {
      scope: options.scope,
      keyPath: options.key,
    });

    if (result.changed) {
      emit({ kind: "success", message: `Removed ${options.scope} config key: ${options.key}` });
      emit({ kind: "info", message: `Path: ${result.configPath}` });
    } else {
      emit({ kind: "info", message: `No change: ${options.key} was not set.` });
      emit({ kind: "info", message: `Path: ${result.configPath}` });
    }

    return EXIT_CODE_SUCCESS;
  };
}
