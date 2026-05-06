import path from "node:path";
import { parseMigrationDirectory } from "../domain/migration-parser.js";
import { parseTasks } from "../domain/parser.js";
import {
  EXIT_CODE_FAILURE,
  EXIT_CODE_NO_WORK,
  EXIT_CODE_SUCCESS,
} from "../domain/exit-codes.js";
import type { FileSystem } from "../domain/ports/index.js";
import type { ApplicationOutputPort } from "../domain/ports/output-port.js";
import {
  discoverMigrationThreads,
  loadMigrationThreadStates,
} from "./migrate-task.js";
import {
  resolveArchiveWorkspacePaths,
  resolveImplementationRootSnapshotPath,
  resolveImplementationThreadSnapshotPath,
  resolveWorkspacePaths,
} from "./workspace-paths.js";
import { resolveWorkspaceRootForPathSensitiveCommand } from "./workspace-selection.js";

export interface SnapshotTaskOptions {
  workspace?: string;
}

export interface SnapshotTaskDependencies {
  fileSystem: FileSystem;
  output: ApplicationOutputPort;
}

interface SnapshotLaneBoundary {
  laneLabel: string;
  laneKind: "root" | "thread";
  threadSlug?: string;
  highestCompletedMigrationNumber: number | null;
  latestDiscoveredMigrationNumber: number | null;
  betweenMigrations: boolean;
}

interface SnapshotWriteTarget {
  laneLabel: string;
  laneKind: "root" | "thread";
  threadSlug?: string;
  migrationNumber: number;
  snapshotPath: string;
}

export function createSnapshotTask(
  dependencies: SnapshotTaskDependencies,
): (options: SnapshotTaskOptions) => Promise<number> {
  const emit = dependencies.output.emit.bind(dependencies.output);

  return async function snapshotTask(options: SnapshotTaskOptions): Promise<number> {
    const invocationDir = process.cwd();
    const workspaceSelection = resolveWorkspaceRootForPathSensitiveCommand({
      fileSystem: dependencies.fileSystem,
      invocationDir,
      workspaceOption: options.workspace,
    });
    if (!workspaceSelection.ok) {
      emit({ kind: "error", message: workspaceSelection.message });
      return EXIT_CODE_FAILURE;
    }

    const workspaceRoot = workspaceSelection.workspaceRoot;
    const invocationRoot = workspaceSelection.executionContext.invocationDir;
    const workspacePaths = resolveWorkspacePaths({
      fileSystem: dependencies.fileSystem,
      workspaceRoot,
      invocationRoot,
    });
    const archivePaths = resolveArchiveWorkspacePaths({
      fileSystem: dependencies.fileSystem,
      workspaceRoot,
      invocationRoot,
    });

    const implementationRootPath = workspacePaths.implementation;
    const implementationRootStat = dependencies.fileSystem.stat(implementationRootPath);
    if (!implementationRootStat?.isDirectory) {
      emit({
        kind: "error",
        message: "Implementation directory does not exist or is not a directory: " + implementationRootPath,
      });
      return EXIT_CODE_FAILURE;
    }

    const rootLaneBoundary = resolveLaneSnapshotBoundary({
      fileSystem: dependencies.fileSystem,
      laneLabel: "root",
      migrationsDir: workspacePaths.migrations,
      archivedMigrationsDir: archivePaths.migrationRootLane,
    });

    const discoveredThreads = discoverMigrationThreads(dependencies.fileSystem, workspaceRoot);
    const loadedThreadStates = loadMigrationThreadStates({
      fileSystem: dependencies.fileSystem,
      migrationsDir: workspacePaths.migrations,
      archivedThreadsDir: archivePaths.migrationThreads,
      threads: discoveredThreads,
    });
    const threadLaneBoundaries = loadedThreadStates.map((threadState) => {
      const threadLabel = `thread ${threadState.thread.threadSlug}`;
      return resolveLaneSnapshotBoundary({
        fileSystem: dependencies.fileSystem,
        laneLabel: threadLabel,
        migrationsDir: threadState.migrationsDir,
        archivedMigrationsDir: threadState.archivedMigrationsDir,
        laneKind: "thread",
        threadSlug: threadState.thread.threadSlug,
      });
    });

    const allLaneBoundaries = [rootLaneBoundary, ...threadLaneBoundaries];
    const betweenMigrationLanes = allLaneBoundaries.filter((lane) => lane.betweenMigrations);
    if (betweenMigrationLanes.length > 0) {
      emit({
        kind: "error",
        message: "Cannot create implementation snapshot between migration boundaries. Incomplete latest migration batch in: "
          + betweenMigrationLanes.map((lane) => lane.laneLabel).join(", ")
          + ".",
      });
      return EXIT_CODE_FAILURE;
    }

    const hasAnyCompletedBoundary = allLaneBoundaries
      .some((lane) => lane.highestCompletedMigrationNumber !== null);
    if (!hasAnyCompletedBoundary) {
      emit({
        kind: "error",
        message: "Cannot create implementation snapshot because no completed migration boundary exists.",
      });
      return EXIT_CODE_FAILURE;
    }

    const writeTargets = resolveSnapshotWriteTargets({
      fileSystem: dependencies.fileSystem,
      workspaceRoot,
      invocationRoot,
      rootLaneBoundary,
      threadLaneBoundaries,
    });

    if (writeTargets.length === 0) {
      emit({
        kind: "error",
        message: "Cannot create implementation snapshot because no completed migration boundary exists.",
      });
      return EXIT_CODE_FAILURE;
    }

    let createdSnapshotCount = 0;
    let existingSnapshotCount = 0;
    for (const target of writeTargets) {
      if (dependencies.fileSystem.exists(target.snapshotPath)) {
        existingSnapshotCount += 1;
        emit({
          kind: "info",
          message: "Snapshot already exists for "
            + target.laneLabel
            + " migration "
            + String(target.migrationNumber)
            + " at "
            + toWorkspaceRelativePath(workspaceRoot, target.snapshotPath)
            + ".",
        });
        continue;
      }

      dependencies.fileSystem.mkdir(target.snapshotPath, { recursive: true });
      copyImplementationTreeWithoutSnapshots({
        fileSystem: dependencies.fileSystem,
        implementationRootPath,
        snapshotPath: target.snapshotPath,
      });

      createdSnapshotCount += 1;
      emit({
        kind: "success",
        message: "Saved implementation snapshot for "
          + target.laneLabel
          + " migration "
          + String(target.migrationNumber)
          + " at "
          + toWorkspaceRelativePath(workspaceRoot, target.snapshotPath)
          + ".",
      });
    }

    if (createdSnapshotCount > 0) {
      return EXIT_CODE_SUCCESS;
    }

    if (existingSnapshotCount > 0) {
      emit({
        kind: "info",
        message: "All eligible implementation snapshots already exist.",
      });
      return EXIT_CODE_NO_WORK;
    }

    return EXIT_CODE_SUCCESS;
  };
}

function resolveSnapshotWriteTargets(input: {
  fileSystem: FileSystem;
  workspaceRoot: string;
  invocationRoot: string;
  rootLaneBoundary: SnapshotLaneBoundary;
  threadLaneBoundaries: SnapshotLaneBoundary[];
}): SnapshotWriteTarget[] {
  const writeTargets: SnapshotWriteTarget[] = [];

  if (input.rootLaneBoundary.highestCompletedMigrationNumber !== null) {
    const migrationNumber = input.rootLaneBoundary.highestCompletedMigrationNumber;
    writeTargets.push({
      laneLabel: input.rootLaneBoundary.laneLabel,
      laneKind: "root",
      migrationNumber,
      snapshotPath: resolveImplementationRootSnapshotPath({
        fileSystem: input.fileSystem,
        workspaceRoot: input.workspaceRoot,
        invocationRoot: input.invocationRoot,
        snapshotNumber: migrationNumber,
      }),
    });
  }

  for (const threadLaneBoundary of input.threadLaneBoundaries) {
    if (threadLaneBoundary.highestCompletedMigrationNumber === null || !threadLaneBoundary.threadSlug) {
      continue;
    }
    const migrationNumber = threadLaneBoundary.highestCompletedMigrationNumber;
    writeTargets.push({
      laneLabel: threadLaneBoundary.laneLabel,
      laneKind: "thread",
      threadSlug: threadLaneBoundary.threadSlug,
      migrationNumber,
      snapshotPath: resolveImplementationThreadSnapshotPath({
        fileSystem: input.fileSystem,
        workspaceRoot: input.workspaceRoot,
        invocationRoot: input.invocationRoot,
        threadSlug: threadLaneBoundary.threadSlug,
        snapshotNumber: migrationNumber,
      }),
    });
  }

  return writeTargets;
}

function resolveLaneSnapshotBoundary(input: {
  fileSystem: FileSystem;
  laneLabel: string;
  migrationsDir: string;
  archivedMigrationsDir?: string;
  laneKind?: "root" | "thread";
  threadSlug?: string;
}): SnapshotLaneBoundary {
  const laneFiles = listMigrationLaneFiles({
    fileSystem: input.fileSystem,
    migrationsDir: input.migrationsDir,
    archivedMigrationsDir: input.archivedMigrationsDir,
  });

  const laneMigrationState = parseMigrationDirectory(laneFiles, input.migrationsDir);
  const laneMigrations = laneMigrationState.migrations;
  if (laneMigrations.length === 0) {
    return {
      laneLabel: input.laneLabel,
      laneKind: input.laneKind ?? "root",
      ...(input.threadSlug ? { threadSlug: input.threadSlug } : {}),
      highestCompletedMigrationNumber: null,
      latestDiscoveredMigrationNumber: null,
      betweenMigrations: false,
    };
  }

  let highestCompletedMigrationNumber: number | null = null;
  let firstIncompleteMigrationNumber: number | null = null;
  for (const migration of laneMigrations) {
    const migrationNumber = migration.number;
    const migrationBatch = [migration.filePath, ...migration.reviews.map((review) => review.filePath)];
    const batchCompleted = migrationBatch.every((filePath) => {
      return isMigrationFileFullyCompleted(input.fileSystem, filePath);
    });

    if (batchCompleted) {
      highestCompletedMigrationNumber = migrationNumber;
      continue;
    }

    if (firstIncompleteMigrationNumber === null) {
      firstIncompleteMigrationNumber = migrationNumber;
    }
  }

  const latestDiscoveredMigrationNumber = laneMigrations[laneMigrations.length - 1]?.number ?? null;
  const betweenMigrations = firstIncompleteMigrationNumber !== null
    && latestDiscoveredMigrationNumber !== null
    && firstIncompleteMigrationNumber <= latestDiscoveredMigrationNumber;

  return {
    laneLabel: input.laneLabel,
    laneKind: input.laneKind ?? "root",
    ...(input.threadSlug ? { threadSlug: input.threadSlug } : {}),
    highestCompletedMigrationNumber,
    latestDiscoveredMigrationNumber,
    betweenMigrations,
  };
}

function isMigrationFileFullyCompleted(fileSystem: FileSystem, migrationFilePath: string): boolean {
  const source = fileSystem.readText(migrationFilePath);
  const tasks = parseTasks(source, migrationFilePath);
  return !tasks.some((task) => !task.checked);
}

function listMigrationLaneFiles(input: {
  fileSystem: FileSystem;
  migrationsDir: string;
  archivedMigrationsDir?: string;
}): string[] {
  const { fileSystem, migrationsDir, archivedMigrationsDir } = input;
  const archivedFiles = listMigrationFilesInDirectory(fileSystem, archivedMigrationsDir);
  const hotFiles = listMigrationFilesInDirectory(fileSystem, migrationsDir);

  const hotFileKeys = new Set(hotFiles.map((filePath) => path.basename(filePath).toLowerCase()));
  const archivedWithoutHotOverlaps = archivedFiles
    .filter((filePath) => !hotFileKeys.has(path.basename(filePath).toLowerCase()));

  return [...archivedWithoutHotOverlaps, ...hotFiles];
}

function listMigrationFilesInDirectory(fileSystem: FileSystem, migrationsDir?: string): string[] {
  if (!migrationsDir) {
    return [];
  }
  if (!fileSystem.exists(migrationsDir)) {
    return [];
  }

  const stat = fileSystem.stat(migrationsDir);
  if (!stat?.isDirectory) {
    return [];
  }

  return fileSystem.readdir(migrationsDir)
    .filter((entry) => entry.isFile)
    .map((entry) => path.join(migrationsDir, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function copyImplementationTreeWithoutSnapshots(input: {
  fileSystem: FileSystem;
  implementationRootPath: string;
  snapshotPath: string;
}): void {
  const { fileSystem, implementationRootPath, snapshotPath } = input;

  const entries = fileSystem.readdir(implementationRootPath)
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.name === "snapshots") {
      continue;
    }

    const sourcePath = path.join(implementationRootPath, entry.name);
    const destinationPath = path.join(snapshotPath, entry.name);
    copyPathRecursively({
      fileSystem,
      sourcePath,
      destinationPath,
    });
  }
}

function copyPathRecursively(input: {
  fileSystem: FileSystem;
  sourcePath: string;
  destinationPath: string;
}): void {
  const { fileSystem, sourcePath, destinationPath } = input;
  const stat = fileSystem.stat(sourcePath);
  if (!stat) {
    return;
  }

  if (stat.isDirectory) {
    fileSystem.mkdir(destinationPath, { recursive: true });
    const entries = fileSystem.readdir(sourcePath)
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const nestedSourcePath = path.join(sourcePath, entry.name);
      const nestedDestinationPath = path.join(destinationPath, entry.name);
      copyPathRecursively({
        fileSystem,
        sourcePath: nestedSourcePath,
        destinationPath: nestedDestinationPath,
      });
    }
    return;
  }

  if (!stat.isFile) {
    return;
  }

  fileSystem.writeText(destinationPath, fileSystem.readText(sourcePath));
}

function toWorkspaceRelativePath(workspaceRoot: string, absolutePath: string): string {
  return path.relative(workspaceRoot, absolutePath).replace(/\\/g, "/");
}
