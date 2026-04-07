import fs from "node:fs";
import path from "node:path";
import type { WorkerConfigPort } from "../../domain/ports/worker-config-port.js";
import {
  WORKER_CONFIG_COMMAND_NAMES,
  type WorkerCommand,
  type WorkerCommandProfiles,
  type WorkerConfig,
  type WorkerConfigCommandName,
  type WorkersConfig,
} from "../../domain/worker-config.js";

const WORKER_CONFIG_FILE_NAME = "config.json";

/**
 * Determines whether a value is a non-null, non-array object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Determines whether a value is an array composed entirely of strings.
 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/**
 * Validates and normalizes a worker command (flat string array) from parsed JSON input.
 */
function validateWorkerCommand(value: unknown, keyPath: string): WorkerCommand {
  if (!isStringArray(value)) {
    throw new Error(`Invalid worker config at ${keyPath}: expected string array.`);
  }

  return [...value];
}

/**
 * Validates the `workers` section: { default?, tui?, fallbacks? }.
 */
function validateWorkers(value: unknown, keyPath: string): WorkersConfig {
  if (!isPlainObject(value)) {
    throw new Error(`Invalid worker config at ${keyPath}: expected object.`);
  }

  const result: WorkersConfig = {};

  if (value.default !== undefined) {
    result.default = validateWorkerCommand(value.default, `${keyPath}.default`);
  }

  if (value.tui !== undefined) {
    result.tui = validateWorkerCommand(value.tui, `${keyPath}.tui`);
  }

  if (value.fallbacks !== undefined) {
    if (!Array.isArray(value.fallbacks)) {
      throw new Error(`Invalid worker config at ${keyPath}.fallbacks: expected array.`);
    }

    result.fallbacks = (value.fallbacks as unknown[]).map((entry, index) =>
      validateWorkerCommand(entry, `${keyPath}.fallbacks[${index}]`),
    );
  }

  return result;
}

/**
 * Validates a map of worker commands keyed by profile name.
 */
function validateProfileMap(value: unknown, keyPath: string): Record<string, WorkerCommand> {
  if (!isPlainObject(value)) {
    throw new Error(`Invalid worker config at ${keyPath}: expected object.`);
  }

  const result: Record<string, WorkerCommand> = {};
  for (const [key, command] of Object.entries(value)) {
    result[key] = validateWorkerCommand(command, `${keyPath}.${key}`);
  }

  return result;
}

/**
 * Returns true when a config key matches the `tools.{toolName}` pattern.
 */
function isToolsKey(key: string): key is `tools.${string}` {
  return key.startsWith("tools.") && key.length > "tools.".length;
}

/**
 * Validates `commands` config and accepts known command keys and `tools.*` keys.
 */
function validateCommandProfiles(value: unknown, keyPath: string): WorkerCommandProfiles {
  if (!isPlainObject(value)) {
    throw new Error(`Invalid worker config at ${keyPath}: expected object.`);
  }

  const allowedNames = new Set<string>(WORKER_CONFIG_COMMAND_NAMES);
  const result: WorkerCommandProfiles = {};

  for (const [key, command] of Object.entries(value)) {
    if (!allowedNames.has(key) && !isToolsKey(key)) {
      throw new Error(
        `Invalid worker config at ${keyPath}.${key}: unknown command. Allowed: ${WORKER_CONFIG_COMMAND_NAMES.join(", ")}, or tools.{toolName}.`,
      );
    }

    result[key as WorkerConfigCommandName] = validateWorkerCommand(command, `${keyPath}.${key}`);
  }

  return result;
}

/**
 * Validates the top-level worker configuration document.
 */
function validateWorkerConfig(value: unknown): WorkerConfig {
  if (!isPlainObject(value)) {
    throw new Error("Invalid worker config: expected top-level JSON object.");
  }

  const workers = value.workers;
  const commands = value.commands;
  const profiles = value.profiles;

  return {
    workers: workers === undefined ? undefined : validateWorkers(workers, "workers"),
    commands: commands === undefined ? undefined : validateCommandProfiles(commands, "commands"),
    profiles: profiles === undefined ? undefined : validateProfileMap(profiles, "profiles"),
  };
}

/**
 * Creates the worker configuration adapter that loads and validates config
 * values from `<configDir>/config.json`.
 */
export function createWorkerConfigAdapter(): WorkerConfigPort {
  return {
    /**
     * Loads worker configuration from disk.
     *
     * Returns `undefined` when the configuration file does not exist.
     */
    load(configDir) {
      const configPath = path.join(configDir, WORKER_CONFIG_FILE_NAME);

      let parsed: unknown;
      try {
        const source = fs.readFileSync(configPath, "utf-8");
        parsed = JSON.parse(source);
      } catch (error) {
        // Missing config is allowed and treated as an optional file.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return undefined;
        }

        // Surface malformed JSON with a targeted parse error.
        if (error instanceof SyntaxError) {
          throw new Error(`Failed to parse worker config at \"${configPath}\": invalid JSON (${error.message}).`);
        }

        // Preserve any unexpected I/O failure details.
        throw new Error(`Failed to read worker config at \"${configPath}\": ${String(error)}.`);
      }

      try {
        return validateWorkerConfig(parsed);
      } catch (error) {
        // Prefix validation failures with the source path for traceability.
        throw new Error(`Invalid worker config at \"${configPath}\": ${(error as Error).message}`);
      }
    },
  };
}
