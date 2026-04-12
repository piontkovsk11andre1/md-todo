import fs from "node:fs";
import path from "node:path";
import type { WorkerConfigPort } from "../../domain/ports/worker-config-port.js";
import {
  DEFAULT_TRACE_STATISTICS_FIELDS,
  TRACE_STATISTICS_FIELD_REGISTRY,
  WORKER_HEALTH_POLICY_FALLBACK_STRATEGY_PRIORITY,
  WORKER_HEALTH_POLICY_FALLBACK_STRATEGY_STRICT_ORDER,
  WORKER_HEALTH_POLICY_UNAVAILABLE_REEVALUATION_COOLDOWN,
  WORKER_HEALTH_POLICY_UNAVAILABLE_REEVALUATION_MANUAL,
  WORKER_CONFIG_COMMAND_NAMES,
  type WorkerHealthPolicyConfig,
  type TraceStatisticsConfig,
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
 * Validates optional inline trace statistics configuration.
 */
function validateTraceStatisticsConfig(value: unknown, keyPath: string): TraceStatisticsConfig {
  if (value === undefined) {
    return {
      enabled: false,
      fields: [...DEFAULT_TRACE_STATISTICS_FIELDS],
    };
  }

  if (!isPlainObject(value)) {
    throw new Error(`Invalid worker config at ${keyPath}: expected object.`);
  }

  const enabled = value.enabled;
  const fields = value.fields;

  if (enabled !== undefined && typeof enabled !== "boolean") {
    throw new Error(`Invalid worker config at ${keyPath}.enabled: expected boolean.`);
  }

  if (fields !== undefined && !isStringArray(fields)) {
    throw new Error(`Invalid worker config at ${keyPath}.fields: expected string array.`);
  }

  if (fields !== undefined) {
    const allowedFields = new Set<string>(TRACE_STATISTICS_FIELD_REGISTRY);
    const unknownField = fields.find((field) => !allowedFields.has(field));
    if (unknownField) {
      throw new Error(
        `Invalid worker config at ${keyPath}.fields: unknown field "${unknownField}". Allowed: ${TRACE_STATISTICS_FIELD_REGISTRY.join(", ")}.`,
      );
    }
  }

  return {
    enabled: enabled === true,
    fields: fields === undefined ? [...DEFAULT_TRACE_STATISTICS_FIELDS] : [...fields],
  };
}

function validateNonNegativeNumber(value: unknown, keyPath: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid worker config at ${keyPath}: expected non-negative number.`);
  }

  return value;
}

function validatePositiveInteger(value: unknown, keyPath: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid worker config at ${keyPath}: expected positive integer.`);
  }

  return value;
}

function validateHealthPolicy(value: unknown, keyPath: string): WorkerHealthPolicyConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isPlainObject(value)) {
    throw new Error(`Invalid worker config at ${keyPath}: expected object.`);
  }

  const result: WorkerHealthPolicyConfig = {};

  const cooldowns = value.cooldownSecondsByFailureClass;
  if (cooldowns !== undefined) {
    if (!isPlainObject(cooldowns)) {
      throw new Error(`Invalid worker config at ${keyPath}.cooldownSecondsByFailureClass: expected object.`);
    }

    const validatedCooldowns: NonNullable<WorkerHealthPolicyConfig["cooldownSecondsByFailureClass"]> = {};
    if (cooldowns.usage_limit !== undefined) {
      validatedCooldowns.usage_limit = validateNonNegativeNumber(
        cooldowns.usage_limit,
        `${keyPath}.cooldownSecondsByFailureClass.usage_limit`,
      );
    }
    if (cooldowns.transport_unavailable !== undefined) {
      validatedCooldowns.transport_unavailable = validateNonNegativeNumber(
        cooldowns.transport_unavailable,
        `${keyPath}.cooldownSecondsByFailureClass.transport_unavailable`,
      );
    }
    if (cooldowns.execution_failure_other !== undefined) {
      validatedCooldowns.execution_failure_other = validateNonNegativeNumber(
        cooldowns.execution_failure_other,
        `${keyPath}.cooldownSecondsByFailureClass.execution_failure_other`,
      );
    }

    result.cooldownSecondsByFailureClass = validatedCooldowns;
  }

  if (value.maxFailoverAttemptsPerTask !== undefined) {
    result.maxFailoverAttemptsPerTask = validatePositiveInteger(
      value.maxFailoverAttemptsPerTask,
      `${keyPath}.maxFailoverAttemptsPerTask`,
    );
  }

  if (value.maxFailoverAttemptsPerRun !== undefined) {
    result.maxFailoverAttemptsPerRun = validatePositiveInteger(
      value.maxFailoverAttemptsPerRun,
      `${keyPath}.maxFailoverAttemptsPerRun`,
    );
  }

  if (value.fallbackStrategy !== undefined) {
    const fallbackStrategy = value.fallbackStrategy;
    if (
      fallbackStrategy !== WORKER_HEALTH_POLICY_FALLBACK_STRATEGY_STRICT_ORDER
      && fallbackStrategy !== WORKER_HEALTH_POLICY_FALLBACK_STRATEGY_PRIORITY
    ) {
      throw new Error(
        `Invalid worker config at ${keyPath}.fallbackStrategy: expected one of `
          + `${WORKER_HEALTH_POLICY_FALLBACK_STRATEGY_STRICT_ORDER}, ${WORKER_HEALTH_POLICY_FALLBACK_STRATEGY_PRIORITY}.`,
      );
    }

    result.fallbackStrategy = fallbackStrategy;
  }

  const unavailableReevaluation = value.unavailableReevaluation;
  if (unavailableReevaluation !== undefined) {
    if (!isPlainObject(unavailableReevaluation)) {
      throw new Error(`Invalid worker config at ${keyPath}.unavailableReevaluation: expected object.`);
    }

    const validatedUnavailableReevaluation: NonNullable<WorkerHealthPolicyConfig["unavailableReevaluation"]> = {};

    if (unavailableReevaluation.mode !== undefined) {
      const mode = unavailableReevaluation.mode;
      if (
        mode !== WORKER_HEALTH_POLICY_UNAVAILABLE_REEVALUATION_MANUAL
        && mode !== WORKER_HEALTH_POLICY_UNAVAILABLE_REEVALUATION_COOLDOWN
      ) {
        throw new Error(
          `Invalid worker config at ${keyPath}.unavailableReevaluation.mode: expected one of `
            + `${WORKER_HEALTH_POLICY_UNAVAILABLE_REEVALUATION_MANUAL}, ${WORKER_HEALTH_POLICY_UNAVAILABLE_REEVALUATION_COOLDOWN}.`,
        );
      }

      validatedUnavailableReevaluation.mode = mode;
    }

    if (unavailableReevaluation.probeCooldownSeconds !== undefined) {
      validatedUnavailableReevaluation.probeCooldownSeconds = validateNonNegativeNumber(
        unavailableReevaluation.probeCooldownSeconds,
        `${keyPath}.unavailableReevaluation.probeCooldownSeconds`,
      );
    }

    result.unavailableReevaluation = validatedUnavailableReevaluation;
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
    traceStatistics: validateTraceStatisticsConfig(value.traceStatistics, "traceStatistics"),
    healthPolicy: validateHealthPolicy(value.healthPolicy, "healthPolicy"),
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
