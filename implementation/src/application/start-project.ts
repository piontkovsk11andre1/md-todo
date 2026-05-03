import { createInitProject } from "./init-project.js";
import { initGitRepo } from "./git-operations.js";
import {
  EXIT_CODE_FAILURE,
  EXIT_CODE_SUCCESS,
} from "../domain/exit-codes.js";
import { getAgentsTemplate } from "../domain/agents-template.js";
import {
  parseWorkspaceLinkSchema,
  serializeWorkspaceLinkSchema,
} from "../domain/workspace-link.js";
import {
  DEFAULT_WORKSPACE_DIRECTORIES,
  DEFAULT_WORKSPACE_PLACEMENT,
  WORKSPACE_PLACEMENTS,
  type WorkspacePlacement,
} from "./workspace-paths.js";
import type { ApplicationOutputPort } from "../domain/ports/output-port.js";
import type {
  FileSystem,
  GitClient,
  PathOperationsPort,
  WorkingDirectoryPort,
} from "../domain/ports/index.js";

export interface StartProjectOptions {
  description?: string;
  dir?: string;
  designDir?: string;
  specsDir?: string;
  migrationsDir?: string;
  designPlacement?: string;
  specsPlacement?: string;
  migrationsPlacement?: string;
  fromDesign?: string;
}

interface ValidatedWorkspaceDirectories {
  designDir: string;
  specsDir: string;
  migrationsDir: string;
  predictionDir: string;
}

interface ValidatedWorkspacePlacement {
  designPlacement: WorkspacePlacement;
  specsPlacement: WorkspacePlacement;
  migrationsPlacement: WorkspacePlacement;
  predictionPlacement: WorkspacePlacement;
}

interface RundownConfigDocument {
  workspace?: {
    directories?: {
      design: string;
      specs: string;
      migrations: string;
      prediction: string;
    };
    placement?: {
      design: WorkspacePlacement;
      specs: WorkspacePlacement;
      migrations: WorkspacePlacement;
      prediction: WorkspacePlacement;
    };
    design?: {
      currentPath?: string;
    };
  };
  [key: string]: unknown;
}

export interface StartProjectDependencies {
  fileSystem: FileSystem;
  gitClient: GitClient;
  output: ApplicationOutputPort;
  pathOperations: PathOperationsPort;
  runExplore: (source: string, cwd: string) => Promise<number>;
  workingDirectory: WorkingDirectoryPort;
}

/**
 * Creates the start-project use case.
 *
 * This flow ensures the target directory is inside a Git repository by
 * initializing one when needed.
 */
export function createStartProject(
  dependencies: StartProjectDependencies,
): (options?: StartProjectOptions) => Promise<number> {
  const emit = dependencies.output.emit.bind(dependencies.output);

  return async function startProject(options: StartProjectOptions = {}): Promise<number> {
    const invocationDirectory = dependencies.workingDirectory.cwd();
    const dirOption = options.dir?.trim();
    const targetDirectory = dirOption
      ? dependencies.pathOperations.resolve(dirOption)
      : invocationDirectory;
    if (!dependencies.fileSystem.exists(targetDirectory)) {
      dependencies.fileSystem.mkdir(targetDirectory, { recursive: true });
      emit({ kind: "success", message: "Created project directory: " + targetDirectory });
    }

    let workspaceDirectories: ValidatedWorkspaceDirectories;
    let workspacePlacement: ValidatedWorkspacePlacement;
    let externalDesignCurrentPath: string | undefined;
    try {
      workspaceDirectories = resolveAndValidateWorkspaceDirectories({
        targetDirectory,
        designDirOption: options.designDir,
        specsDirOption: options.specsDir,
        migrationsDirOption: options.migrationsDir,
        pathOperations: dependencies.pathOperations,
      });
      workspacePlacement = resolveAndValidateWorkspacePlacement({
        designPlacementOption: options.designPlacement,
        specsPlacementOption: options.specsPlacement,
        migrationsPlacementOption: options.migrationsPlacement,
      });
      externalDesignCurrentPath = resolveAndValidateFromDesign({
        fromDesignOption: options.fromDesign,
        invocationDirectory,
        fileSystem: dependencies.fileSystem,
        pathOperations: dependencies.pathOperations,
      });
    } catch (error) {
      emit({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      return EXIT_CODE_FAILURE;
    }

    const agentsPath = dependencies.pathOperations.join(targetDirectory, "AGENTS.md");
    const rundownConfigDir = dependencies.pathOperations.join(targetDirectory, ".rundown");
    const rundownConfigPath = dependencies.pathOperations.join(rundownConfigDir, "config.json");
    const migrationsDir = dependencies.pathOperations.join(
      targetDirectory,
      workspaceDirectories.migrationsDir,
    );
    const specsDir = dependencies.pathOperations.join(
      targetDirectory,
      workspaceDirectories.specsDir,
    );
    const predictionDir = dependencies.pathOperations.join(
      targetDirectory,
      workspaceDirectories.predictionDir,
    );
    await initGitRepo(dependencies.gitClient, targetDirectory);

    const initProject = createInitProject({
      fileSystem: dependencies.fileSystem,
      configDir: {
        configDir: rundownConfigDir,
        isExplicit: true,
      },
      pathOperations: dependencies.pathOperations,
      output: dependencies.output,
      localeMessages: {},
    });
    const initCode = await initProject();
    if (initCode !== EXIT_CODE_SUCCESS) {
      return initCode;
    }

    try {
      persistWorkspaceConfiguration({
        fileSystem: dependencies.fileSystem,
        configPath: rundownConfigPath,
        directories: workspaceDirectories,
        placement: workspacePlacement,
        designCurrentPath: externalDesignCurrentPath,
      });
      emit({
        kind: "success",
        message: "Persisted workspace directories and placement in " + rundownConfigPath,
      });
    } catch (error) {
      emit({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      return EXIT_CODE_FAILURE;
    }

    persistWorkspaceLinkMetadata({
      fileSystem: dependencies.fileSystem,
      pathOperations: dependencies.pathOperations,
      invocationDirectory,
      targetDirectory,
      emit,
    });

    const configuredExternalDesignCurrentPath = resolveConfiguredExternalDesignCurrentPath({
      fileSystem: dependencies.fileSystem,
      pathOperations: dependencies.pathOperations,
      configPath: rundownConfigPath,
      localDesignCurrentDir: dependencies.pathOperations.join(
        targetDirectory,
        workspaceDirectories.designDir,
        "current",
      ),
    });
    const activeExternalDesignCurrentPath = externalDesignCurrentPath
      ?? configuredExternalDesignCurrentPath;
    const designCurrentDir = activeExternalDesignCurrentPath
      ?? dependencies.pathOperations.join(
        targetDirectory,
        workspaceDirectories.designDir,
        "current",
      );
    const designPath = dependencies.pathOperations.join(designCurrentDir, "Target.md");

    if (!dependencies.fileSystem.exists(designCurrentDir)) {
      dependencies.fileSystem.mkdir(designCurrentDir, { recursive: true });
      emit({ kind: "success", message: "Created " + designCurrentDir + "/" });
    }

    if (activeExternalDesignCurrentPath) {
      emit({
        kind: "success",
        message: "Using external directory as design/current: " + activeExternalDesignCurrentPath,
      });
    } else {
      writeFileIfMissing(
        dependencies.fileSystem,
        designPath,
        "",
        emit,
      );
    }
    writeFileIfMissing(dependencies.fileSystem, agentsPath, getAgentsTemplate(), emit);

    if (!dependencies.fileSystem.exists(migrationsDir)) {
      dependencies.fileSystem.mkdir(migrationsDir, { recursive: true });
      emit({ kind: "success", message: "Created " + migrationsDir + "/" });
    }

    if (!dependencies.fileSystem.exists(specsDir)) {
      dependencies.fileSystem.mkdir(specsDir, { recursive: true });
      emit({ kind: "success", message: "Created " + specsDir + "/" });
    }

    if (!dependencies.fileSystem.exists(predictionDir)) {
      dependencies.fileSystem.mkdir(predictionDir, { recursive: true });
      emit({ kind: "success", message: "Created " + predictionDir + "/" });
    }

    try {
      await dependencies.gitClient.run(["add", "-A", "--", "."], targetDirectory);
      await dependencies.gitClient.run(["commit", "-m", "rundown: start project"], targetDirectory);
      emit({ kind: "success", message: "Committed scaffold: rundown: start project" });
    } catch (error) {
      if (isNoOpCommitError(error)) {
        emit({ kind: "info", message: "No scaffold changes detected; skipping commit." });
        return EXIT_CODE_SUCCESS;
      }
      emit({
        kind: "error",
        message: "Failed to create scaffold commit: " + String(error),
      });
      return EXIT_CODE_FAILURE;
    }

    return EXIT_CODE_SUCCESS;
  };
}

function buildWorkspaceLinkTarget(
  pathOperations: PathOperationsPort,
  fromDirectory: string,
  toDirectory: string,
): string {
  const relativeTarget = pathOperations.relative(fromDirectory, toDirectory);
  const normalizedTarget = relativeTarget.length > 0
    ? relativeTarget
    : ".";
  return normalizedTarget.replace(/\\/g, "/");
}

function persistWorkspaceLinkMetadata(input: {
  fileSystem: FileSystem;
  pathOperations: PathOperationsPort;
  invocationDirectory: string;
  targetDirectory: string;
  emit: ApplicationOutputPort["emit"];
}): void {
  const {
    fileSystem,
    pathOperations,
    invocationDirectory,
    targetDirectory,
    emit,
  } = input;

  const normalizedInvocationDirectory = pathOperations.resolve(invocationDirectory);
  const normalizedTargetDirectory = pathOperations.resolve(targetDirectory);
  const targetWorkspaceLinkPath = pathOperations.join(normalizedTargetDirectory, ".rundown", "workspace.link");

  writeFileIfChanged(
    fileSystem,
    targetWorkspaceLinkPath,
    serializeWorkspaceLinkSchema({
      sourceFormat: "legacy-single-path",
      records: [{
        id: "source",
        workspacePath: buildWorkspaceLinkTarget(
          pathOperations,
          normalizedTargetDirectory,
          normalizedInvocationDirectory,
        ),
        isDefault: true,
      }],
    }),
    emit,
  );

  if (normalizedInvocationDirectory === normalizedTargetDirectory) {
    return;
  }

  const sourceWorkspaceLinkPath = pathOperations.join(normalizedInvocationDirectory, ".rundown", "workspace.link");
  const targetPathFromSource = buildWorkspaceLinkTarget(
    pathOperations,
    normalizedInvocationDirectory,
    normalizedTargetDirectory,
  );
  const sourceWorkspaceLinkContent = buildUpdatedSourceWorkspaceLinkContent({
    fileSystem,
    sourceWorkspaceLinkPath,
    targetPathFromSource,
  });

  writeFileIfChanged(fileSystem, sourceWorkspaceLinkPath, sourceWorkspaceLinkContent, emit);
}

function buildUpdatedSourceWorkspaceLinkContent(input: {
  fileSystem: FileSystem;
  sourceWorkspaceLinkPath: string;
  targetPathFromSource: string;
}): string {
  const { fileSystem, sourceWorkspaceLinkPath, targetPathFromSource } = input;
  const existingContent = fileSystem.exists(sourceWorkspaceLinkPath)
    ? fileSystem.readText(sourceWorkspaceLinkPath)
    : undefined;

  const records: Array<{ id: string; workspacePath: string; isDefault?: boolean }> = [];
  let defaultRecordId: string | undefined;
  const usedRecordIds = new Set<string>();

  if (existingContent !== undefined) {
    const parsed = parseWorkspaceLinkSchema(existingContent);
    if (parsed.status === "ok") {
      for (const record of parsed.schema.records) {
        records.push({
          id: record.id,
          workspacePath: record.workspacePath,
          isDefault: record.isDefault,
        });
        usedRecordIds.add(record.id);
      }
      defaultRecordId = parsed.schema.defaultRecordId;
    }
  }

  const existingRecord = records.find((record) => record.workspacePath === targetPathFromSource);
  if (!existingRecord) {
    const proposedId = toWorkspaceRecordId(targetPathFromSource);
    const recordId = makeUniqueRecordId(proposedId, usedRecordIds);
    usedRecordIds.add(recordId);
    records.push({
      id: recordId,
      workspacePath: targetPathFromSource,
      isDefault: false,
    });
  }

  return serializeWorkspaceLinkSchema({
    records,
    ...(defaultRecordId !== undefined ? { defaultRecordId } : {}),
  });
}

function toWorkspaceRecordId(workspacePath: string): string {
  const segments = workspacePath.split("/").filter((segment) => segment.length > 0 && segment !== "." && segment !== "..");
  const raw = (segments[segments.length - 1] ?? "workspace").toLowerCase();
  const sanitized = raw
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

  if (sanitized.length > 0 && /^[a-z0-9]/.test(sanitized)) {
    return sanitized;
  }

  return "workspace";
}

function makeUniqueRecordId(baseId: string, usedIds: Set<string>): string {
  if (!usedIds.has(baseId)) {
    return baseId;
  }

  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${baseId}-${String(suffix)}`;
    if (!usedIds.has(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Failed to allocate workspace record id for "${baseId}".`);
}

function writeFileIfChanged(
  fileSystem: FileSystem,
  filePath: string,
  content: string,
  emit: ApplicationOutputPort["emit"],
): void {
  if (fileSystem.exists(filePath)) {
    const existingContent = fileSystem.readText(filePath);
    if (existingContent === content) {
      emit({ kind: "info", message: filePath + " already up to date." });
      return;
    }

    fileSystem.writeText(filePath, content);
    emit({ kind: "success", message: "Updated " + filePath });
    return;
  }

  fileSystem.writeText(filePath, content);
  emit({ kind: "success", message: "Created " + filePath });
}

function writeFileIfMissing(
  fileSystem: FileSystem,
  filePath: string,
  content: string,
  emit: ApplicationOutputPort["emit"],
): boolean {
  if (fileSystem.exists(filePath)) {
    emit({ kind: "warn", message: filePath + " already exists, skipping." });
    return false;
  }

  fileSystem.writeText(filePath, content);
  emit({ kind: "success", message: "Created " + filePath });
  return true;
}

function isNoOpCommitError(error: unknown): boolean {
  const message = String(error).toLowerCase();
  return message.includes("nothing to commit") || message.includes("nothing added to commit");
}

function resolveAndValidateWorkspaceDirectories(input: {
  targetDirectory: string;
  designDirOption: string | undefined;
  specsDirOption: string | undefined;
  migrationsDirOption: string | undefined;
  pathOperations: PathOperationsPort;
}): ValidatedWorkspaceDirectories {
  const {
    targetDirectory,
    designDirOption,
    specsDirOption,
    migrationsDirOption,
    pathOperations,
  } = input;
  const defaults = {
    designDir: DEFAULT_WORKSPACE_DIRECTORIES.design,
    specsDir: DEFAULT_WORKSPACE_DIRECTORIES.specs,
    migrationsDir: DEFAULT_WORKSPACE_DIRECTORIES.migrations,
    predictionDir: DEFAULT_WORKSPACE_DIRECTORIES.prediction,
  };

  const designDir = normalizeWorkspaceDirectoryOverride(
    targetDirectory,
    designDirOption ?? defaults.designDir,
    "--design-dir",
    pathOperations,
  );
  const specsDir = normalizeWorkspaceDirectoryOverride(
    targetDirectory,
    specsDirOption ?? defaults.specsDir,
    "--specs-dir",
    pathOperations,
  );
  const migrationsDir = normalizeWorkspaceDirectoryOverride(
    targetDirectory,
    migrationsDirOption ?? defaults.migrationsDir,
    "--migrations-dir",
    pathOperations,
  );
  const predictionDir = normalizeWorkspaceDirectoryOverride(
    targetDirectory,
    defaults.predictionDir,
    "prediction directory default",
    pathOperations,
  );

  const buckets: Array<{ optionName: string; relativeDir: string }> = [
    { optionName: "--design-dir", relativeDir: designDir },
    { optionName: "--specs-dir", relativeDir: specsDir },
    { optionName: "--migrations-dir", relativeDir: migrationsDir },
    { optionName: "prediction directory default", relativeDir: predictionDir },
  ];

  validateWorkspaceDirectoryConflicts(buckets);

  return {
    designDir,
    specsDir,
    migrationsDir,
    predictionDir,
  };
}

function normalizeWorkspaceDirectoryOverride(
  targetDirectory: string,
  rawValue: string,
  optionName: string,
  pathOperations: PathOperationsPort,
): string {
  const trimmedValue = rawValue.trim();
  if (trimmedValue.length === 0) {
    throw new Error(`Invalid ${optionName} value: path cannot be empty.`);
  }

  if (pathOperations.isAbsolute(trimmedValue)) {
    throw new Error(
      `Invalid ${optionName} value: "${trimmedValue}". Use a path relative to the project root, not an absolute path.`,
    );
  }

  const resolvedPath = pathOperations.resolve(targetDirectory, trimmedValue);
  const relativeFromProjectRoot = pathOperations
    .relative(targetDirectory, resolvedPath)
    .replace(/\\/g, "/");

  if (relativeFromProjectRoot.length === 0 || relativeFromProjectRoot === ".") {
    throw new Error(`Invalid ${optionName} value: "${trimmedValue}" resolves to the project root.`);
  }

  if (relativeFromProjectRoot === ".." || relativeFromProjectRoot.startsWith("../")) {
    throw new Error(
      `Invalid ${optionName} value: "${trimmedValue}" escapes the project root. Use a subdirectory path.`,
    );
  }

  return relativeFromProjectRoot;
}

function validateWorkspaceDirectoryConflicts(
  directories: Array<{ optionName: string; relativeDir: string }>,
): void {
  for (let index = 0; index < directories.length; index += 1) {
    const current = directories[index];
    if (!current) {
      continue;
    }

    for (let otherIndex = index + 1; otherIndex < directories.length; otherIndex += 1) {
      const other = directories[otherIndex];
      if (!other) {
        continue;
      }

      if (current.relativeDir === other.relativeDir) {
        throw new Error(
          `Invalid workspace directory overrides: ${current.optionName} and ${other.optionName} both resolve to "${current.relativeDir}". Use distinct directories.`,
        );
      }

      if (isAncestorOrDescendantPath(current.relativeDir, other.relativeDir)) {
        throw new Error(
          `Invalid workspace directory overrides: ${current.optionName} ("${current.relativeDir}") and ${other.optionName} ("${other.relativeDir}") overlap. Use separate non-nested directories.`,
        );
      }
    }
  }
}

function isAncestorOrDescendantPath(left: string, right: string): boolean {
  return left.startsWith(right + "/") || right.startsWith(left + "/");
}

function resolveAndValidateFromDesign(input: {
  fromDesignOption: string | undefined;
  invocationDirectory: string;
  fileSystem: FileSystem;
  pathOperations: PathOperationsPort;
}): string | undefined {
  const { fromDesignOption, invocationDirectory, fileSystem, pathOperations } = input;
  const trimmed = fromDesignOption?.trim();
  if (!trimmed || trimmed.length === 0) {
    return undefined;
  }

  const resolved = pathOperations.isAbsolute(trimmed)
    ? pathOperations.resolve(trimmed)
    : pathOperations.resolve(invocationDirectory, trimmed);

  if (!fileSystem.exists(resolved)) {
    throw new Error(
      `Invalid --from-design value: directory does not exist: ${resolved}.`,
    );
  }
  if (fileSystem.stat(resolved)?.isDirectory !== true) {
    throw new Error(
      `Invalid --from-design value: ${resolved} is not a directory.`,
    );
  }
  return resolved;
}

function resolveAndValidateWorkspacePlacement(input: {
  designPlacementOption: string | undefined;
  specsPlacementOption: string | undefined;
  migrationsPlacementOption: string | undefined;
}): ValidatedWorkspacePlacement {
  const designPlacement = normalizeWorkspacePlacementOverride(
    input.designPlacementOption ?? DEFAULT_WORKSPACE_PLACEMENT.design,
    "--design-placement",
  );
  const specsPlacement = normalizeWorkspacePlacementOverride(
    input.specsPlacementOption ?? DEFAULT_WORKSPACE_PLACEMENT.specs,
    "--specs-placement",
  );
  const migrationsPlacement = normalizeWorkspacePlacementOverride(
    input.migrationsPlacementOption ?? DEFAULT_WORKSPACE_PLACEMENT.migrations,
    "--migrations-placement",
  );
  const predictionPlacement = normalizeWorkspacePlacementOverride(
    DEFAULT_WORKSPACE_PLACEMENT.prediction,
    "prediction placement default",
  );

  return {
    designPlacement,
    specsPlacement,
    migrationsPlacement,
    predictionPlacement,
  };
}

function normalizeWorkspacePlacementOverride(
  rawValue: string,
  optionName: string,
): WorkspacePlacement {
  const trimmedValue = rawValue.trim();
  if (trimmedValue.length === 0) {
    throw new Error(`Invalid ${optionName} value: placement cannot be empty.`);
  }

  if (!WORKSPACE_PLACEMENTS.includes(trimmedValue as WorkspacePlacement)) {
    throw new Error(
      `Invalid ${optionName} value: "${trimmedValue}". Allowed values: ${WORKSPACE_PLACEMENTS.join(", ")}.`,
    );
  }

  return trimmedValue as WorkspacePlacement;
}

function persistWorkspaceConfiguration(input: {
  fileSystem: FileSystem;
  configPath: string;
  directories: ValidatedWorkspaceDirectories;
  placement: ValidatedWorkspacePlacement;
  designCurrentPath?: string;
}): void {
  const { fileSystem, configPath, directories, placement, designCurrentPath } = input;
  const existingSource = fileSystem.exists(configPath)
    ? fileSystem.readText(configPath)
    : "{}\n";

  let parsed: unknown;
  try {
    parsed = JSON.parse(existingSource);
  } catch (error) {
    throw new Error(
      `Failed to persist workspace directories: cannot parse ${configPath} as JSON (${String(error)}).`,
    );
  }

  if (!isPlainObject(parsed)) {
    throw new Error(
      `Failed to persist workspace directories: expected ${configPath} to contain a top-level JSON object.`,
    );
  }

  const existingWorkspace = isPlainObject(parsed.workspace) ? parsed.workspace : {};
  const existingDesignSection = isPlainObject(existingWorkspace.design) ? existingWorkspace.design : {};

  const config: RundownConfigDocument = {
    ...parsed,
    workspace: {
      ...existingWorkspace,
      directories: {
        design: directories.designDir,
        specs: directories.specsDir,
        migrations: directories.migrationsDir,
        prediction: directories.predictionDir,
      },
      placement: {
        design: placement.designPlacement,
        specs: placement.specsPlacement,
        migrations: placement.migrationsPlacement,
        prediction: placement.predictionPlacement,
      },
      design: {
        ...existingDesignSection,
        ...(designCurrentPath ? { currentPath: designCurrentPath } : {}),
      },
    },
  };

  // Drop empty design section to keep config tidy when no override is set.
  if (
    config.workspace?.design
    && Object.keys(config.workspace.design).length === 0
  ) {
    delete config.workspace.design;
  }

  fileSystem.writeText(configPath, JSON.stringify(config, null, 2) + "\n");
}

function resolveConfiguredExternalDesignCurrentPath(input: {
  fileSystem: FileSystem;
  pathOperations: PathOperationsPort;
  configPath: string;
  localDesignCurrentDir: string;
}): string | undefined {
  const {
    fileSystem,
    pathOperations,
    configPath,
    localDesignCurrentDir,
  } = input;
  if (!fileSystem.exists(configPath)) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fileSystem.readText(configPath));
  } catch {
    return undefined;
  }

  if (!isPlainObject(parsed)) {
    return undefined;
  }

  const workspace = isPlainObject(parsed.workspace) ? parsed.workspace : undefined;
  const design = workspace && isPlainObject(workspace.design) ? workspace.design : undefined;
  const configuredPath = typeof design?.currentPath === "string"
    ? design.currentPath.trim()
    : "";
  if (configuredPath.length === 0) {
    return undefined;
  }

  const resolvedPath = pathOperations.isAbsolute(configuredPath)
    ? pathOperations.resolve(configuredPath)
    : pathOperations.resolve(pathOperations.dirname(configPath), configuredPath);
  const normalizedResolvedPath = pathOperations.resolve(resolvedPath);
  const normalizedLocalDesignCurrentDir = pathOperations.resolve(localDesignCurrentDir);
  if (normalizedResolvedPath === normalizedLocalDesignCurrentDir) {
    return undefined;
  }

  if (!fileSystem.exists(normalizedResolvedPath)) {
    return undefined;
  }

  if (fileSystem.stat(normalizedResolvedPath)?.isDirectory !== true) {
    return undefined;
  }

  return normalizedResolvedPath;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
