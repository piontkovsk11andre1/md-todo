import path from "node:path";
import type { FileSystem } from "../domain/ports/index.js";

export interface PredictionWorkspaceDirectories {
  design: string;
  specs: string;
  migrations: string;
}

type PredictionWorkspaceBucket = keyof PredictionWorkspaceDirectories;

interface RundownConfigDocument {
  workspace?: {
    directories?: Partial<Record<PredictionWorkspaceBucket, unknown>>;
  };
  [key: string]: unknown;
}

export const DEFAULT_PREDICTION_WORKSPACE_DIRECTORIES: PredictionWorkspaceDirectories = {
  design: "design",
  specs: "specs",
  migrations: "migrations",
};

export function resolvePredictionWorkspaceDirectories(input: {
  fileSystem: FileSystem;
  workspaceRoot: string;
}): PredictionWorkspaceDirectories {
  const { fileSystem, workspaceRoot } = input;
  const configPath = path.join(workspaceRoot, ".rundown", "config.json");
  if (!fileSystem.exists(configPath)) {
    return { ...DEFAULT_PREDICTION_WORKSPACE_DIRECTORIES };
  }

  let parsedConfig: unknown;
  try {
    parsedConfig = JSON.parse(fileSystem.readText(configPath));
  } catch (error) {
    throw new Error(
      `Invalid project config at ${configPath}: failed to parse JSON (${String(error)}).`,
    );
  }

  if (!isPlainObject(parsedConfig)) {
    throw new Error(`Invalid project config at ${configPath}: expected a top-level JSON object.`);
  }

  const workspaceSection = parsedConfig.workspace;
  if (workspaceSection !== undefined && !isPlainObject(workspaceSection)) {
    throw new Error(`Invalid project config at ${configPath}: "workspace" must be an object.`);
  }

  const directoriesSection = workspaceSection?.directories;
  if (directoriesSection !== undefined && !isPlainObject(directoriesSection)) {
    throw new Error(`Invalid project config at ${configPath}: "workspace.directories" must be an object.`);
  }

  const directories = {
    design: normalizeWorkspaceDirectoryValue({
      configPath,
      workspaceRoot,
      key: "design",
      value: directoriesSection?.design,
      fallback: DEFAULT_PREDICTION_WORKSPACE_DIRECTORIES.design,
    }),
    specs: normalizeWorkspaceDirectoryValue({
      configPath,
      workspaceRoot,
      key: "specs",
      value: directoriesSection?.specs,
      fallback: DEFAULT_PREDICTION_WORKSPACE_DIRECTORIES.specs,
    }),
    migrations: normalizeWorkspaceDirectoryValue({
      configPath,
      workspaceRoot,
      key: "migrations",
      value: directoriesSection?.migrations,
      fallback: DEFAULT_PREDICTION_WORKSPACE_DIRECTORIES.migrations,
    }),
  } satisfies PredictionWorkspaceDirectories;

  validateDirectoryConflicts(directories, configPath);
  return directories;
}

export function resolvePredictionWorkspacePath(input: {
  fileSystem: FileSystem;
  workspaceRoot: string;
  bucket: PredictionWorkspaceBucket;
  overrideDir?: string;
  directories?: PredictionWorkspaceDirectories;
}): string {
  const { fileSystem, workspaceRoot, bucket, overrideDir } = input;
  const trimmedOverride = overrideDir?.trim();
  if (trimmedOverride && trimmedOverride.length > 0) {
    return path.resolve(workspaceRoot, trimmedOverride);
  }

  const directories = input.directories ?? resolvePredictionWorkspaceDirectories({ fileSystem, workspaceRoot });
  return path.join(workspaceRoot, directories[bucket]);
}

function normalizeWorkspaceDirectoryValue(input: {
  configPath: string;
  workspaceRoot: string;
  key: PredictionWorkspaceBucket;
  value: unknown;
  fallback: string;
}): string {
  const { configPath, workspaceRoot, key, value, fallback } = input;
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid project config at ${configPath}: "workspace.directories.${key}" must be a string.`);
  }

  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) {
    throw new Error(`Invalid project config at ${configPath}: "workspace.directories.${key}" cannot be empty.`);
  }
  if (path.isAbsolute(trimmedValue)) {
    throw new Error(
      `Invalid project config at ${configPath}: "workspace.directories.${key}" must be project-relative, not absolute.`,
    );
  }

  const resolved = path.resolve(workspaceRoot, trimmedValue);
  const relativePath = path.relative(workspaceRoot, resolved).replace(/\\/g, "/");
  if (relativePath.length === 0 || relativePath === ".") {
    throw new Error(`Invalid project config at ${configPath}: "workspace.directories.${key}" resolves to the project root.`);
  }
  if (relativePath === ".." || relativePath.startsWith("../")) {
    throw new Error(
      `Invalid project config at ${configPath}: "workspace.directories.${key}" escapes the project root.`,
    );
  }

  return relativePath;
}

function validateDirectoryConflicts(directories: PredictionWorkspaceDirectories, configPath: string): void {
  const entries = Object.entries(directories) as Array<[PredictionWorkspaceBucket, string]>;

  for (let index = 0; index < entries.length; index += 1) {
    const current = entries[index];
    if (!current) {
      continue;
    }

    for (let otherIndex = index + 1; otherIndex < entries.length; otherIndex += 1) {
      const other = entries[otherIndex];
      if (!other) {
        continue;
      }

      if (current[1] === other[1]) {
        throw new Error(
          `Invalid project config at ${configPath}: workspace directories "${current[0]}" and "${other[0]}" both resolve to "${current[1]}".`,
        );
      }

      if (isAncestorOrDescendantPath(current[1], other[1])) {
        throw new Error(
          `Invalid project config at ${configPath}: workspace directories "${current[0]}" ("${current[1]}") and "${other[0]}" ("${other[1]}") overlap.`,
        );
      }
    }
  }
}

function isAncestorOrDescendantPath(left: string, right: string): boolean {
  return left.startsWith(right + "/") || right.startsWith(left + "/");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
