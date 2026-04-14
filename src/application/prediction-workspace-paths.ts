import path from "node:path";
import type { FileSystem } from "../domain/ports/index.js";

export interface PredictionWorkspaceDirectories {
  design: string;
  specs: string;
  migrations: string;
}

type PredictionWorkspaceBucket = keyof PredictionWorkspaceDirectories;

export const PREDICTION_WORKSPACE_PLACEMENTS = ["sourcedir", "workdir"] as const;

export type PredictionWorkspacePlacement = typeof PREDICTION_WORKSPACE_PLACEMENTS[number];

export interface PredictionWorkspacePlacementMap {
  design: PredictionWorkspacePlacement;
  specs: PredictionWorkspacePlacement;
  migrations: PredictionWorkspacePlacement;
}

export interface PredictionWorkspacePaths {
  design: string;
  specs: string;
  migrations: string;
}

interface PredictionWorkspaceConfig {
  directories: PredictionWorkspaceDirectories;
  placement: PredictionWorkspacePlacementMap;
}

interface RundownConfigDocument {
  workspace?: {
    directories?: Partial<Record<PredictionWorkspaceBucket, unknown>>;
    placement?: Partial<Record<PredictionWorkspaceBucket, unknown>>;
  };
  [key: string]: unknown;
}

export const DEFAULT_PREDICTION_WORKSPACE_DIRECTORIES: PredictionWorkspaceDirectories = {
  design: "design",
  specs: "specs",
  migrations: "migrations",
};

export const DEFAULT_PREDICTION_WORKSPACE_PLACEMENT: PredictionWorkspacePlacementMap = {
  design: "sourcedir",
  specs: "sourcedir",
  migrations: "sourcedir",
};

export function resolvePredictionWorkspaceDirectories(input: {
  fileSystem: FileSystem;
  workspaceRoot: string;
}): PredictionWorkspaceDirectories {
  return resolvePredictionWorkspaceConfig(input).directories;
}

export function resolvePredictionWorkspacePlacement(input: {
  fileSystem: FileSystem;
  workspaceRoot: string;
}): PredictionWorkspacePlacementMap {
  return resolvePredictionWorkspaceConfig(input).placement;
}

function resolvePredictionWorkspaceConfig(input: {
  fileSystem: FileSystem;
  workspaceRoot: string;
}): PredictionWorkspaceConfig {
  const { fileSystem, workspaceRoot } = input;
  const configPath = path.join(workspaceRoot, ".rundown", "config.json");
  if (!fileSystem.exists(configPath)) {
    return {
      directories: { ...DEFAULT_PREDICTION_WORKSPACE_DIRECTORIES },
      placement: { ...DEFAULT_PREDICTION_WORKSPACE_PLACEMENT },
    };
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
  const placementSection = workspaceSection?.placement;
  if (placementSection !== undefined && !isPlainObject(placementSection)) {
    throw new Error(`Invalid project config at ${configPath}: "workspace.placement" must be an object.`);
  }

  const directories = {
    design: normalizeWorkspaceDirectoryValue({
      configPath,
      key: "design",
      value: directoriesSection?.design,
      fallback: DEFAULT_PREDICTION_WORKSPACE_DIRECTORIES.design,
    }),
    specs: normalizeWorkspaceDirectoryValue({
      configPath,
      key: "specs",
      value: directoriesSection?.specs,
      fallback: DEFAULT_PREDICTION_WORKSPACE_DIRECTORIES.specs,
    }),
    migrations: normalizeWorkspaceDirectoryValue({
      configPath,
      key: "migrations",
      value: directoriesSection?.migrations,
      fallback: DEFAULT_PREDICTION_WORKSPACE_DIRECTORIES.migrations,
    }),
  } satisfies PredictionWorkspaceDirectories;

  const placement = {
    design: normalizeWorkspacePlacementValue({
      configPath,
      key: "design",
      value: placementSection?.design,
      fallback: DEFAULT_PREDICTION_WORKSPACE_PLACEMENT.design,
    }),
    specs: normalizeWorkspacePlacementValue({
      configPath,
      key: "specs",
      value: placementSection?.specs,
      fallback: DEFAULT_PREDICTION_WORKSPACE_PLACEMENT.specs,
    }),
    migrations: normalizeWorkspacePlacementValue({
      configPath,
      key: "migrations",
      value: placementSection?.migrations,
      fallback: DEFAULT_PREDICTION_WORKSPACE_PLACEMENT.migrations,
    }),
  } satisfies PredictionWorkspacePlacementMap;

  validateDirectoryConflicts(directories, configPath);
  return {
    directories,
    placement,
  };
}

export function resolvePredictionWorkspacePath(input: {
  fileSystem: FileSystem;
  workspaceRoot: string;
  invocationRoot?: string;
  bucket: PredictionWorkspaceBucket;
  overrideDir?: string;
  directories?: PredictionWorkspaceDirectories;
  placement?: PredictionWorkspacePlacementMap;
}): string {
  const { workspaceRoot, bucket, overrideDir } = input;
  const trimmedOverride = overrideDir?.trim();
  if (trimmedOverride && trimmedOverride.length > 0) {
    return path.resolve(workspaceRoot, trimmedOverride);
  }

  return resolvePredictionWorkspacePaths(input)[bucket];
}

export function resolvePredictionWorkspacePaths(input: {
  fileSystem: FileSystem;
  workspaceRoot: string;
  invocationRoot?: string;
  directories?: PredictionWorkspaceDirectories;
  placement?: PredictionWorkspacePlacementMap;
}): PredictionWorkspacePaths {
  const { fileSystem, workspaceRoot } = input;
  const invocationRoot = input.invocationRoot ?? workspaceRoot;
  const directories = input.directories ?? resolvePredictionWorkspaceDirectories({ fileSystem, workspaceRoot });
  const placement = input.placement ?? resolvePredictionWorkspacePlacement({ fileSystem, workspaceRoot });

  const resolvedPaths = {
    design: resolveBucketPath({
      configPath: path.join(workspaceRoot, ".rundown", "config.json"),
      bucket: "design",
      root: resolvePlacementRoot(placement.design, workspaceRoot, invocationRoot),
      relativeDirectory: directories.design,
    }),
    specs: resolveBucketPath({
      configPath: path.join(workspaceRoot, ".rundown", "config.json"),
      bucket: "specs",
      root: resolvePlacementRoot(placement.specs, workspaceRoot, invocationRoot),
      relativeDirectory: directories.specs,
    }),
    migrations: resolveBucketPath({
      configPath: path.join(workspaceRoot, ".rundown", "config.json"),
      bucket: "migrations",
      root: resolvePlacementRoot(placement.migrations, workspaceRoot, invocationRoot),
      relativeDirectory: directories.migrations,
    }),
  } satisfies PredictionWorkspacePaths;

  validateResolvedBucketConflicts({
    configPath: path.join(workspaceRoot, ".rundown", "config.json"),
    paths: resolvedPaths,
  });

  return resolvedPaths;
}

function resolvePlacementRoot(
  placement: PredictionWorkspacePlacement,
  workspaceRoot: string,
  invocationRoot: string,
): string {
  return placement === "workdir" ? invocationRoot : workspaceRoot;
}

function normalizeWorkspacePlacementValue(input: {
  configPath: string;
  key: PredictionWorkspaceBucket;
  value: unknown;
  fallback: PredictionWorkspacePlacement;
}): PredictionWorkspacePlacement {
  const { configPath, key, value, fallback } = input;
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid project config at ${configPath}: "workspace.placement.${key}" must be a string.`);
  }
  if (!PREDICTION_WORKSPACE_PLACEMENTS.includes(value as PredictionWorkspacePlacement)) {
    throw new Error(
      `Invalid project config at ${configPath}: "workspace.placement.${key}" must be "sourcedir" or "workdir".`,
    );
  }

  return value as PredictionWorkspacePlacement;
}

function normalizeWorkspaceDirectoryValue(input: {
  configPath: string;
  key: PredictionWorkspaceBucket;
  value: unknown;
  fallback: string;
}): string {
  const { configPath, key, value, fallback } = input;
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

  const normalizedPath = path.posix.normalize(trimmedValue.replace(/\\/g, "/"));
  if (normalizedPath.length === 0 || normalizedPath === ".") {
    throw new Error(`Invalid project config at ${configPath}: "workspace.directories.${key}" resolves to the project root.`);
  }
  if (normalizedPath === ".." || normalizedPath.startsWith("../")) {
    throw new Error(
      `Invalid project config at ${configPath}: "workspace.directories.${key}" escapes the project root.`,
    );
  }

  return normalizedPath;
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

function resolveBucketPath(input: {
  configPath: string;
  bucket: PredictionWorkspaceBucket;
  root: string;
  relativeDirectory: string;
}): string {
  const { configPath, bucket, root, relativeDirectory } = input;
  const normalizedRelativeDirectory = normalizeWorkspaceDirectoryValue({
    configPath,
    key: bucket,
    value: relativeDirectory,
    fallback: relativeDirectory,
  });

  return path.join(root, normalizedRelativeDirectory);
}

function validateResolvedBucketConflicts(input: { configPath: string; paths: PredictionWorkspacePaths }): void {
  const { configPath, paths } = input;
  const entries = Object.entries(paths) as Array<[PredictionWorkspaceBucket, string]>;

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

      const currentPath = normalizeForPathComparison(current[1]);
      const otherPath = normalizeForPathComparison(other[1]);
      if (currentPath === otherPath) {
        throw new Error(
          `Invalid project config at ${configPath}: workspace directories "${current[0]}" and "${other[0]}" both resolve to "${current[1]}".`,
        );
      }

      if (isAncestorOrDescendantPath(currentPath, otherPath)) {
        throw new Error(
          `Invalid project config at ${configPath}: workspace directories "${current[0]}" ("${current[1]}") and "${other[0]}" ("${other[1]}") overlap.`,
        );
      }
    }
  }
}

function normalizeForPathComparison(targetPath: string): string {
  const normalized = path.normalize(targetPath).replace(/\\/g, "/");
  if (process.platform === "win32") {
    return normalized.toLowerCase();
  }

  return normalized;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
