import path from "node:path";
import {
  DEFAULT_MIGRATE_TEMPLATE,
} from "../domain/defaults.js";
import {
  formatMigrationFilename,
  parseMigrationDirectory,
  parseMigrationFilename,
} from "../domain/migration-parser.js";
import { parseTasks, type Task } from "../domain/parser.js";
import type {
  ArtifactStore,
  FileSystem,
  TaskRepairPort,
  TaskVerificationPort,
  TraceWriterPort,
  VerificationStore,
  SourceResolverPort,
  TemplateLoader,
  WorkerConfigPort,
  WorkerExecutorPort,
} from "../domain/ports/index.js";
import type { ApplicationOutputPort } from "../domain/ports/output-port.js";
import type { InteractiveInputPort } from "../domain/ports/interactive-input-port.js";
import type { ParsedWorkerPattern } from "../domain/worker-pattern.js";
import { resolveWorkerPatternForInvocation } from "./resolve-worker.js";
import { renderTemplate, type TemplateVars } from "../domain/template.js";
import {
  EXIT_CODE_FAILURE,
  EXIT_CODE_NO_WORK,
  EXIT_CODE_SUCCESS,
} from "../domain/exit-codes.js";
import {
  discoverDesignRevisionDirectories,
  findLowestUnplannedRevision,
  formatDesignRevisionUnifiedDiff,
  formatRevisionDesignContext,
  markRevisionPlanned,
  prepareDesignRevisionDiffContext,
  type DesignRevisionDiffContext,
} from "./design-context.js";
import { runVerifyRepairLoop } from "./verify-repair-loop.js";
import {
  resolveWorkspaceDirectories,
  resolveWorkspacePaths,
  resolveWorkspacePlacement,
  resolveWorkspacePath,
} from "./workspace-paths.js";
import { resolveWorkspaceRootForPathSensitiveCommand } from "./workspace-selection.js";

export interface MigrateTaskOptions {
  action?: string;
  dir?: string;
  workspace?: string;
  confirm?: boolean;
  workerPattern: ParsedWorkerPattern;
  slugWorkerPattern?: ParsedWorkerPattern;
  keepArtifacts?: boolean;
  showAgentOutput?: boolean;
}

export interface MigrateTaskDependencies {
  workerExecutor: WorkerExecutorPort;
  fileSystem: FileSystem;
  traceWriter: TraceWriterPort;
  templateLoader: TemplateLoader;
  sourceResolver: SourceResolverPort;
  workerConfigPort: WorkerConfigPort;
  artifactStore: ArtifactStore;
  configDir?: string;
  interactiveInput: InteractiveInputPort;
  output: ApplicationOutputPort;
  runExplore: (source: string, cwd: string) => Promise<number>;
  runTask?: (options: {
    source: string;
    cwd?: string;
    invocationDir?: string;
    workspaceDir?: string;
    workspaceLinkPath?: string;
    isLinkedWorkspace?: boolean;
    mode: "wait";
    workerPattern: ParsedWorkerPattern;
    sortMode: "name-sort";
    verify: true;
    onlyVerify: false;
    forceExecute: false;
    forceAttempts: 2;
    noRepair: false;
    repairAttempts: 1;
    dryRun: false;
    printPrompt: false;
    keepArtifacts: boolean;
    varsFileOption: undefined;
    cliTemplateVarArgs: [];
    commitAfterComplete: true;
    commitMode: "per-task";
    runAll: true;
    redo: false;
    resetAfter: false;
    clean: false;
    rounds: 1;
    showAgentOutput: boolean;
    trace: false;
    traceOnly: false;
    forceUnlock: false;
    ignoreCliBlock: false;
    verbose: false;
  }) => Promise<number>;
  undoTask?: (options: {
    runId: string;
    last?: number;
    workerPattern: ParsedWorkerPattern;
    force?: boolean;
    dryRun?: boolean;
    keepArtifacts?: boolean;
    showAgentOutput?: boolean;
  }) => Promise<number>;
  revertTask?: (options: {
    runId: string;
    method: "revert" | "reset";
    dryRun: boolean;
    keepArtifacts: boolean;
    force: boolean;
  }) => Promise<number>;
}

export function createMigrateTask(
  dependencies: MigrateTaskDependencies,
): (options: MigrateTaskOptions) => Promise<number> {
  const emit = dependencies.output.emit.bind(dependencies.output);

  return async function migrateTask(options: MigrateTaskOptions): Promise<number> {
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
    const executionContext = workspaceSelection.executionContext;
    const workspaceDirectories = resolveWorkspaceDirectories({
      fileSystem: dependencies.fileSystem,
      workspaceRoot,
    });
    const workspacePlacement = resolveWorkspacePlacement({
      fileSystem: dependencies.fileSystem,
      workspaceRoot,
    });
    const workspacePaths = resolveWorkspacePaths({
      fileSystem: dependencies.fileSystem,
      workspaceRoot,
      invocationRoot: executionContext.invocationDir,
      directories: workspaceDirectories,
      placement: workspacePlacement,
    });
    const migrationsDir = resolveWorkspacePath({
      fileSystem: dependencies.fileSystem,
      workspaceRoot,
      invocationRoot: executionContext.invocationDir,
      bucket: "migrations",
      overrideDir: options.dir,
      directories: workspaceDirectories,
      placement: workspacePlacement,
    });

    if (!dependencies.fileSystem.exists(migrationsDir)) {
      emit({ kind: "error", message: "Migrations directory does not exist: " + migrationsDir });
      return EXIT_CODE_FAILURE;
    }

    const rawAction = options.action;
    if (rawAction !== undefined && rawAction.trim().length > 0) {
      emit({
        kind: "error",
        message: "Invalid migrate action: " + rawAction + ".",
      });
      return EXIT_CODE_FAILURE;
    }
    const projectRoot = workspaceRoot;
    const configDir = path.join(projectRoot, ".rundown");
    const loadedWorkerConfig = dependencies.fileSystem.exists(configDir)
      ? dependencies.workerConfigPort.load(configDir)
      : undefined;
    const workerTimeoutMs = loadedWorkerConfig?.workerTimeoutMs;
    const resolvedWorker = resolveWorkerPatternForInvocation({
      commandName: "migrate",
      workerConfig: loadedWorkerConfig,
      cliWorkerPattern: options.workerPattern,
      emit,
      mode: "wait",
    });
    const resolvedSlugWorker = resolveWorkerPatternForInvocation({
      commandName: "migrate-slug",
      workerConfig: loadedWorkerConfig,
      cliWorkerPattern: options.slugWorkerPattern,
      fallbackWorkerCommand: resolvedWorker.workerCommand,
      emit,
      mode: "wait",
    });
    const slugWorkerPattern = resolvedSlugWorker.workerPattern;

    if (resolvedWorker.workerCommand.length === 0) {
      emit({
        kind: "error",
        message:
          "No worker command available: .rundown/config.json has no configured worker, and no CLI worker was provided. Use --worker <pattern> or -- <command>.",
      });
      return EXIT_CODE_FAILURE;
    }

    const artifactContext = dependencies.artifactStore.createContext({
      cwd: workspaceRoot,
      configDir,
      commandName: "migrate",
      workerCommand: resolvedWorker.workerCommand,
      mode: "wait",
      source: migrationsDir,
      keepArtifacts: Boolean(options.keepArtifacts),
    });

    const artifactRunExtra: Record<string, unknown> = {};

    try {
      const exitCode = await runMigrateLoop({
        dependencies,
        migrationsDir,
        projectRoot,
        invocationRoot: executionContext.invocationDir,
        workspaceRoot,
        workspaceDirectories,
        workspacePlacement,
        workspacePaths,
        workerPattern: resolvedWorker.workerPattern,
        slugWorkerPattern,
        workerTimeoutMs,
        artifactContext,
        keepArtifacts: Boolean(options.keepArtifacts),
        showAgentOutput: Boolean(options.showAgentOutput),
        executionContext,
        confirm: Boolean(options.confirm),
        artifactRunExtra,
      });

      const finalizeExtra = Object.keys(artifactRunExtra).length > 0
        ? artifactRunExtra
        : undefined;
      dependencies.artifactStore.finalize(artifactContext, {
        status: exitCode === EXIT_CODE_SUCCESS ? "completed" : "failed",
        preserve: Boolean(options.keepArtifacts),
        extra: finalizeExtra,
      });
      return exitCode;
    } catch (error) {
      const finalizeExtra: Record<string, unknown> = {
        ...artifactRunExtra,
        error: error instanceof Error ? error.message : String(error),
      };
      dependencies.artifactStore.finalize(artifactContext, {
        status: "failed",
        preserve: Boolean(options.keepArtifacts),
        extra: finalizeExtra,
      });
      emit({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      return EXIT_CODE_FAILURE;
    }
  };
}

function isDirectory(fileSystem: FileSystem, absolutePath: string): boolean {
  const stat = fileSystem.stat(absolutePath);
  return stat?.isDirectory === true;
}

async function runMigrateLoop(input: {
  dependencies: MigrateTaskDependencies;
  migrationsDir: string;
  projectRoot: string;
  invocationRoot: string;
  workspaceRoot: string;
  workspaceDirectories: ReturnType<typeof resolveWorkspaceDirectories>;
  workspacePlacement: ReturnType<typeof resolveWorkspacePlacement>;
  workspacePaths: ReturnType<typeof resolveWorkspacePaths>;
  workerPattern: ParsedWorkerPattern;
  slugWorkerPattern: ParsedWorkerPattern;
  artifactContext: ReturnType<ArtifactStore["createContext"]>;
  workerTimeoutMs?: number;
  keepArtifacts: boolean;
  executionContext: {
    invocationDir: string;
    workspaceDir: string;
    workspaceLinkPath: string;
    isLinkedWorkspace: boolean;
  };
  confirm: boolean;
  showAgentOutput: boolean;
  artifactRunExtra: Record<string, unknown>;
}): Promise<number> {
  const {
    dependencies,
    migrationsDir,
    projectRoot,
    invocationRoot,
    workspaceRoot,
    workspaceDirectories,
    workspacePlacement,
    workspacePaths,
    workerPattern,
    slugWorkerPattern,
    artifactContext,
    workerTimeoutMs,
    keepArtifacts,
    executionContext,
    confirm,
    showAgentOutput,
    artifactRunExtra,
  } = input;
  const emit = dependencies.output.emit.bind(dependencies.output);
  const planningTemplate = readTemplate(
    dependencies.templateLoader,
    projectRoot,
    "migrate.md",
    DEFAULT_MIGRATE_TEMPLATE,
  );
  let processedAnyRevision = false;

  for (;;) {
    const targetRevision = findLowestUnplannedRevision(
      dependencies.fileSystem,
      workspaceRoot,
      { invocationRoot },
    );
    if (!targetRevision) {
      if (!processedAnyRevision) {
        const releasedRevisions = discoverDesignRevisionDirectories(
          dependencies.fileSystem,
          workspaceRoot,
          { invocationRoot },
        );
        const highestReleasedRevision = releasedRevisions[releasedRevisions.length - 1];
        if (highestReleasedRevision) {
          emit({
            kind: "info",
            message:
              "Migrations are caught up to "
              + highestReleasedRevision.name
              + " (highest released revision). Edit design/current/ and run rundown design release to create the next revision.",
          });
        } else {
          emit({
            kind: "info",
            message: "No released design revisions yet. Run rundown design release to create rev.0.",
          });
        }
      }
      return EXIT_CODE_SUCCESS;
    }
    processedAnyRevision = true;

    const latestState = readMigrationState(dependencies.fileSystem, migrationsDir);
    const revisionDiff = prepareDesignRevisionDiffContext(dependencies.fileSystem, projectRoot, {
      invocationRoot,
      target: targetRevision.name,
    });
    const migrationDraftDir = prepareStagedDraftMigrationDir(
      dependencies.fileSystem,
      artifactContext.rootDir,
      targetRevision.name,
    );

    const vars = buildTemplateVars({
      fileSystem: dependencies.fileSystem,
      state: latestState,
      projectRoot,
      invocationRoot,
      workspaceDirectories,
      workspacePlacement,
      workspacePaths,
      designRevisionTarget: targetRevision.name,
      revisionDiff,
      migrationDraftDir,
      newMigrations: "",
    });
    const prompt = renderTemplate(planningTemplate, vars);
    emit({
      kind: "info",
      message: "Planning migrations for "
        + (revisionDiff.fromRevision?.name ?? "nothing")
        + " → "
        + targetRevision.name
        + " (position "
        + String(latestState.currentPosition)
        + ")...",
    });
    const result = await dependencies.workerExecutor.runWorker({
      workerPattern: slugWorkerPattern,
      prompt,
      mode: "wait",
      cwd: workspaceRoot,
      timeoutMs: workerTimeoutMs,
      artifactContext,
      artifactPhase: "worker",
      artifactPhaseLabel: "migrate-plan",
    });
    if ((result.exitCode ?? 1) !== 0) {
      throw new Error("Worker failed to generate migration plan.");
    }
    if (showAgentOutput && result.stderr.length > 0) {
      emit({ kind: "stderr", text: result.stderr });
    }

    const syntheticTask = createSyntheticMigrateTask(
      path.join(migrationDraftDir, "_staged-migration-verification.md"),
      targetRevision.name,
    );
    const stagedVerificationStore = createInMemoryVerificationStore();
    const verifyStagedDraftTaskSet = async (): Promise<{ valid: boolean; stdout?: string }> => {
      const verification = verifyCurrentStagedDraftSet({
        fileSystem: dependencies.fileSystem,
        artifactRunRootDir: artifactContext.rootDir,
        revisionName: targetRevision.name,
        revisionDiff,
        currentPosition: latestState.currentPosition,
        migrationDraftDir,
      });
      const resultText = verification.valid
        ? "OK"
        : (verification.failureReason ?? "Verification failed (no details).");
      stagedVerificationStore.write(syntheticTask, resultText);
      return {
        valid: verification.valid,
        stdout: resultText,
      };
    };
    const stagedTaskVerification: TaskVerificationPort = {
      verify: async ({ onWorkerOutput }) => {
        const verification = await verifyStagedDraftTaskSet();
        if (onWorkerOutput) {
          onWorkerOutput(verification.stdout ?? "", "");
        }
        return verification;
      },
    };
    const stagedTaskRepair: TaskRepairPort = {
      repair: async ({ onWorkerOutput }) => {
        const previousFailure = stagedVerificationStore.read(syntheticTask)
          ?? "Verification failed (no details).";
        const repairPrompt = buildMigrateRepairPrompt({
          revisionName: targetRevision.name,
          migrationDraftDir,
          migrationsDir,
          currentPosition: latestState.currentPosition,
          failureReason: previousFailure,
          revisionDiff,
        });
        const migrationsDirSnapshotBeforeRepair = snapshotDirectoryContents(
          dependencies.fileSystem,
          migrationsDir,
        );
        const repairRunResult = await dependencies.workerExecutor.runWorker({
          workerPattern: slugWorkerPattern,
          prompt: repairPrompt,
          mode: "wait",
          cwd: workspaceRoot,
          timeoutMs: workerTimeoutMs,
          artifactContext,
          artifactPhase: "repair",
          artifactPhaseLabel: "migrate-staged-repair",
          artifactExtra: {
            revision: targetRevision.name,
            migrationDraftDir,
          },
        });
        if (onWorkerOutput) {
          onWorkerOutput(repairRunResult.stdout, repairRunResult.stderr);
        }
        if ((repairRunResult.exitCode ?? 1) !== 0) {
          const failureReason = "Staged migration repair worker failed.";
          stagedVerificationStore.write(syntheticTask, failureReason);
          return {
            valid: false,
            attempts: 1,
            repairStdout: repairRunResult.stdout,
            verificationStdout: failureReason,
          };
        }
        const migrationsDirSnapshotAfterRepair = snapshotDirectoryContents(
          dependencies.fileSystem,
          migrationsDir,
        );
        const migrationsMutation = diffDirectorySnapshots(
          migrationsDirSnapshotBeforeRepair,
          migrationsDirSnapshotAfterRepair,
        );
        if (migrationsMutation) {
          const failureReason = "Repair must mutate staged drafts only; real migrations directory changed ("
            + migrationsMutation
            + ").";
          stagedVerificationStore.write(syntheticTask, failureReason);
          return {
            valid: false,
            attempts: 1,
            repairStdout: repairRunResult.stdout,
            verificationStdout: failureReason,
          };
        }
        const verification = await verifyStagedDraftTaskSet();
        return {
          valid: verification.valid,
          attempts: 1,
          repairStdout: repairRunResult.stdout,
          verificationStdout: verification.stdout,
        };
      },
    };

    const stagedVerifyRepair = await runVerifyRepairLoop({
      taskVerification: stagedTaskVerification,
      taskRepair: stagedTaskRepair,
      verificationStore: stagedVerificationStore,
      traceWriter: dependencies.traceWriter,
      output: dependencies.output,
    }, {
      task: syntheticTask,
      source: "",
      contextBefore: "",
      verifyTemplate: "",
      repairTemplate: "",
      workerPattern: slugWorkerPattern,
      configDir: dependencies.configDir,
      maxRepairAttempts: MIGRATE_MAX_REPAIR_ATTEMPTS,
      allowRepair: true,
      templateVars: {},
      artifactContext,
      trace: false,
      showAgentOutput,
      runMode: "wait",
      executionOutputCaptured: true,
      isInlineCliTask: false,
      isToolExpansionTask: false,
    });

    if (!stagedVerifyRepair.valid) {
      throw new Error(
        "Staged migration drafts failed verification after repair attempts: "
        + (stagedVerifyRepair.failureReason ?? "Verification failed (no details).")
        + " Staged drafts preserved in "
        + migrationDraftDir
        + ".",
      );
    }

    const stagedDraftVerificationAfterRepair = verifyCurrentStagedDraftSet({
      fileSystem: dependencies.fileSystem,
      artifactRunRootDir: artifactContext.rootDir,
      revisionName: targetRevision.name,
      revisionDiff,
      currentPosition: latestState.currentPosition,
      migrationDraftDir,
    });
    if (!stagedDraftVerificationAfterRepair.valid) {
      throw new Error(
        stagedDraftVerificationAfterRepair.failureReason
        ?? "Staged migration drafts failed verification after repair.",
      );
    }
    const stagedDrafts = stagedDraftVerificationAfterRepair.drafts;
    if (stagedDrafts.length === 0 && revisionDiff.changes.length === 0) {
      emit({
        kind: "info",
        message: "Planner drafted no migrations for " + targetRevision.name + ": no diff changes detected.",
      });
      markRevisionPlanned(
        dependencies.fileSystem,
        workspaceRoot,
        targetRevision.name,
        [],
      );
      continue;
    }

    emit({
      kind: "info",
      message: "Promoting "
        + String(stagedDrafts.length)
        + " staged migration file(s): "
        + stagedDrafts.map((draft) => draft.name).join(", "),
    });

    const stateBeforeCreate = readMigrationState(dependencies.fileSystem, migrationsDir);
    const createdMigrationFileNames: string[] = [];
    const stagedValidationErrorBeforePromotion = validateStagedDraftMigrations(
      stagedDrafts,
      stateBeforeCreate.currentPosition,
    );
    if (stagedValidationErrorBeforePromotion) {
      throw new Error(stagedValidationErrorBeforePromotion);
    }
    for (const draft of stagedDrafts) {
      const migrationPath = path.join(migrationsDir, draft.fileName);
      const migrationContent = dependencies.fileSystem.readText(draft.filePath);
      dependencies.fileSystem.writeText(migrationPath, migrationContent);
      createdMigrationFileNames.push(draft.fileName);

      await runExploreForMigration({
        runExplore: dependencies.runExplore,
        migrationPath,
        projectRoot,
      });
    }

    if (confirm) {
      if (dependencies.interactiveInput.prepareForPrompt) {
        await dependencies.interactiveInput.prepareForPrompt();
      }
      const answer = await dependencies.interactiveInput.prompt({
        kind: "confirm",
        message: "Migration files created. Review or edit them, then confirm to continue prediction.",
        defaultValue: true,
      });
      if (answer.value.trim().toLowerCase() !== "true") {
        emit({
          kind: "info",
          message: "Stopped at migration file checkpoint before prediction continuation.",
        });
        return EXIT_CODE_SUCCESS;
      }
    }

    markRevisionPlanned(
      dependencies.fileSystem,
      workspaceRoot,
      targetRevision.name,
      createdMigrationFileNames,
    );
  }
}


interface StagedDraftMigration {
  fileName: string;
  filePath: string;
  number: number;
  name: string;
}

const DRAFTED_MIGRATIONS_SUBDIR = "drafted-migrations";
const MIGRATE_MAX_REPAIR_ATTEMPTS = 2;
const PLACEHOLDER_DRAFT_LINE_PATTERN = /^(?:[-*]\s*\[[ xX]\]\s*)?(?:todo|to do|tbd|placeholder|implement this migration|implement migration|pending)\b/i;
const COVERAGE_TOKEN_IGNORE = new Set([
  "md",
  "docs",
  "doc",
  "design",
  "target",
  "current",
  "rev",
  "spec",
  "specs",
  "src",
  "file",
]);

function stagedDraftMigrationDirForRevision(
  artifactRunRootDir: string,
  revisionName: string,
): string {
  return path.join(artifactRunRootDir, DRAFTED_MIGRATIONS_SUBDIR, revisionName);
}

function prepareStagedDraftMigrationDir(
  fileSystem: FileSystem,
  artifactRunRootDir: string,
  revisionName: string,
): string {
  const draftDir = stagedDraftMigrationDirForRevision(artifactRunRootDir, revisionName);
  fileSystem.rm(draftDir, { recursive: true, force: true });
  fileSystem.mkdir(draftDir, { recursive: true });
  return draftDir;
}

function readStagedDraftMigrationsFromArtifactRun(
  fileSystem: FileSystem,
  artifactRunRootDir: string,
  revisionName: string,
): {
  drafts: StagedDraftMigration[];
  invalidFileNames: string[];
} {
  const draftDir = stagedDraftMigrationDirForRevision(artifactRunRootDir, revisionName);
  return readStagedDraftMigrations(fileSystem, draftDir);
}

function readStagedDraftMigrations(
  fileSystem: FileSystem,
  draftDir: string,
): {
  drafts: StagedDraftMigration[];
  invalidFileNames: string[];
} {
  if (!fileSystem.exists(draftDir)) {
    return {
      drafts: [],
      invalidFileNames: [],
    };
  }

  const staged: StagedDraftMigration[] = [];
  const invalidFileNames: string[] = [];
  for (const entry of fileSystem.readdir(draftDir)) {
    if (!entry.isFile) {
      continue;
    }
    const fileName = entry.name;
    const parsed = parseMigrationFilename(fileName);
    if (!parsed || fileName !== formatMigrationFilename(parsed.number, parsed.name)) {
      invalidFileNames.push(fileName);
      continue;
    }
    staged.push({
      fileName,
      filePath: path.join(draftDir, fileName),
      number: parsed.number,
      name: parsed.name,
    });
  }

  staged.sort((left, right) => left.number - right.number || left.fileName.localeCompare(right.fileName));
  return {
    drafts: staged,
    invalidFileNames,
  };
}

function validateStagedDraftMigrations(
  drafts: readonly StagedDraftMigration[],
  currentPosition: number,
): string | null {
  if (drafts.length === 0) {
    return null;
  }

  if (drafts[0]!.number <= currentPosition) {
    return "Drafted migration numbers must be greater than the current migration number ("
      + String(currentPosition)
      + ").";
  }

  for (let index = 1; index < drafts.length; index += 1) {
    const previous = drafts[index - 1]!;
    const current = drafts[index]!;
    if (current.number !== previous.number + 1) {
      return "Drafted migration numbers must form a continuous forward range without gaps.";
    }
  }

  return null;
}

function verifyStagedDraftCoverage(input: {
  fileSystem: FileSystem;
  drafts: readonly StagedDraftMigration[];
  revisionDiff: DesignRevisionDiffContext;
}): string | null {
  const { fileSystem, drafts, revisionDiff } = input;
  if (drafts.length === 0) {
    return null;
  }

  const draftTexts = drafts.map((draft) => {
    const content = fileSystem.readText(draft.filePath);
    return {
      fileName: draft.fileName,
      content,
      normalized: content.toLowerCase(),
    };
  });

  const lowValueDrafts = draftTexts
    .filter((draft) => !isMateriallyMeaningfulDraftContent(draft.content))
    .map((draft) => draft.fileName);
  if (lowValueDrafts.length > 0) {
    return "Drafted migrations must contain materially meaningful content. Replace placeholder-only drafts: "
      + lowValueDrafts.join(", ")
      + ".";
  }

  const mergedDraftText = draftTexts.map((draft) => draft.normalized).join("\n");
  const uncoveredChanges = revisionDiff.changes
    .map((change) => change.relativePath)
    .filter((relativePath) => !isDiffPathCoveredByDrafts(relativePath, mergedDraftText));
  if (uncoveredChanges.length > 0) {
    return "Drafted migrations do not appear to cover all changed design areas. Uncovered diff paths: "
      + uncoveredChanges.join(", ")
      + ".";
  }

  const overlappingPairs: string[] = [];
  for (let leftIndex = 0; leftIndex < draftTexts.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < draftTexts.length; rightIndex += 1) {
      const left = draftTexts[leftIndex]!;
      const right = draftTexts[rightIndex]!;
      if (areDraftsExcessivelyOverlapping(left.content, right.content)) {
        overlappingPairs.push(left.fileName + " <-> " + right.fileName);
      }
    }
  }

  if (overlappingPairs.length > 0) {
    return "Drafted migrations are excessively overlapping; split or de-duplicate responsibilities: "
      + overlappingPairs.join(", ")
      + ".";
  }

  return null;
}

function verifyCurrentStagedDraftSet(input: {
  fileSystem: FileSystem;
  artifactRunRootDir: string;
  revisionName: string;
  revisionDiff: DesignRevisionDiffContext;
  currentPosition: number;
  migrationDraftDir: string;
}): {
  valid: boolean;
  failureReason: string | null;
  drafts: StagedDraftMigration[];
} {
  const {
    fileSystem,
    artifactRunRootDir,
    revisionName,
    revisionDiff,
    currentPosition,
    migrationDraftDir,
  } = input;
  const stagedDraftResult = readStagedDraftMigrationsFromArtifactRun(
    fileSystem,
    artifactRunRootDir,
    revisionName,
  );

  if (stagedDraftResult.invalidFileNames.length > 0) {
    return {
      valid: false,
      failureReason: "Drafted migration filenames must be canonical (N. Title.md). Invalid files in "
        + migrationDraftDir
        + ": "
        + stagedDraftResult.invalidFileNames.join(", "),
      drafts: [],
    };
  }

  const stagedDrafts = stagedDraftResult.drafts;
  if (stagedDrafts.length === 0) {
    if (revisionDiff.changes.length === 0) {
      return {
        valid: true,
        failureReason: null,
        drafts: [],
      };
    }

    return {
      valid: false,
      failureReason: "Planner did not draft migration files in "
        + migrationDraftDir
        + ". Re-run with --show-agent-output --keep-artifacts to inspect worker output.",
      drafts: [],
    };
  }

  const stagedValidationError = validateStagedDraftMigrations(stagedDrafts, currentPosition);
  if (stagedValidationError) {
    return {
      valid: false,
      failureReason: stagedValidationError,
      drafts: [],
    };
  }

  const stagedCoverageError = verifyStagedDraftCoverage({
    fileSystem,
    drafts: stagedDrafts,
    revisionDiff,
  });
  if (stagedCoverageError) {
    return {
      valid: false,
      failureReason: stagedCoverageError,
      drafts: [],
    };
  }

  return {
    valid: true,
    failureReason: null,
    drafts: stagedDrafts,
  };
}

function buildMigrateRepairPrompt(input: {
  revisionName: string;
  migrationDraftDir: string;
  migrationsDir: string;
  currentPosition: number;
  failureReason: string;
  revisionDiff: DesignRevisionDiffContext;
}): string {
  const {
    revisionName,
    migrationDraftDir,
    migrationsDir,
    currentPosition,
    failureReason,
    revisionDiff,
  } = input;
  return [
    "Repair staged migration drafts for revision " + revisionName + ".",
    "",
    "Rules:",
    "- Edit only files inside this staging directory: " + migrationDraftDir,
    "- Do not modify files in real migrations directory: " + migrationsDir,
    "- Keep canonical migration filenames: N. Title.md",
    "- Use migration numbers strictly greater than " + String(currentPosition),
    "- Keep drafted numbers continuous with no gaps",
    "",
    "Latest verification failure:",
    failureReason,
    "",
    "Design diff summary:",
    revisionDiff.summary,
    "",
    "Changed files:",
    revisionDiff.changes.map((change) => "- " + change.kind + ": " + change.relativePath).join("\n"),
    "",
    "Update staged draft files now. If no migrations are needed because there is no diff drift, remove all staged files and output DONE.",
  ].join("\n");
}

function createSyntheticMigrateTask(filePath: string, revisionName: string): Task {
  return {
    text: "verify staged migration drafts for " + revisionName,
    checked: false,
    index: 0,
    line: 1,
    column: 1,
    offsetStart: 0,
    offsetEnd: 0,
    file: filePath,
    isInlineCli: false,
    depth: 0,
    children: [],
    subItems: [],
  };
}

function createInMemoryVerificationStore(): VerificationStore {
  const store = new Map<string, string>();
  const keyOf = (task: Task): string => task.file + "::" + String(task.index);
  return {
    write(task, content) {
      store.set(keyOf(task), content);
    },
    read(task) {
      return store.get(keyOf(task)) ?? null;
    },
    remove(task) {
      store.delete(keyOf(task));
    },
  };
}

function snapshotDirectoryContents(
  fileSystem: FileSystem,
  rootDir: string,
): Map<string, string> {
  const snapshot = new Map<string, string>();
  const visit = (currentDir: string, relativePrefix: string): void => {
    if (!fileSystem.exists(currentDir)) {
      return;
    }
    const entries = fileSystem.readdir(currentDir)
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = relativePrefix.length > 0
        ? relativePrefix + "/" + entry.name
        : entry.name;
      if (entry.isDirectory) {
        visit(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile) {
        continue;
      }
      snapshot.set(relativePath, fileSystem.readText(absolutePath));
    }
  };

  visit(rootDir, "");
  return snapshot;
}

function diffDirectorySnapshots(
  before: Map<string, string>,
  after: Map<string, string>,
): string | null {
  const beforeKeys = new Set(before.keys());
  for (const [relativePath, afterContent] of after) {
    if (!before.has(relativePath)) {
      return "unexpected file created: " + relativePath;
    }
    beforeKeys.delete(relativePath);
    const beforeContent = before.get(relativePath);
    if (beforeContent !== afterContent) {
      return "unexpected file modified: " + relativePath;
    }
  }
  for (const removedPath of beforeKeys) {
    return "unexpected file removed: " + removedPath;
  }

  return null;
}

function isMateriallyMeaningfulDraftContent(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length < 40) {
    return false;
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (lines.length === 0) {
    return false;
  }

  const nonPlaceholderLines = lines.filter((line) => !PLACEHOLDER_DRAFT_LINE_PATTERN.test(line));
  if (nonPlaceholderLines.length === 0) {
    return false;
  }

  return nonPlaceholderLines.some((line) => line.length >= 16);
}

function isDiffPathCoveredByDrafts(relativePath: string, mergedDraftText: string): boolean {
  const normalizedPath = relativePath.toLowerCase().replace(/\\/g, "/");
  if (normalizedPath.length > 0 && mergedDraftText.includes(normalizedPath)) {
    return true;
  }

  const tokens = normalizedPath
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3)
    .filter((token) => !COVERAGE_TOKEN_IGNORE.has(token));
  if (tokens.length === 0) {
    return true;
  }

  const matched = tokens.filter((token) => mergedDraftText.includes(token));
  const requiredMatches = tokens.length >= 2 ? 2 : 1;
  return matched.length >= requiredMatches;
}

function areDraftsExcessivelyOverlapping(leftContent: string, rightContent: string): boolean {
  const leftTerms = collectDraftTerms(leftContent);
  const rightTerms = collectDraftTerms(rightContent);
  if (leftTerms.size === 0 || rightTerms.size === 0) {
    return false;
  }

  let intersectionCount = 0;
  for (const term of leftTerms) {
    if (rightTerms.has(term)) {
      intersectionCount += 1;
    }
  }

  const smallerSize = Math.min(leftTerms.size, rightTerms.size);
  if (smallerSize < 20) {
    return false;
  }

  return intersectionCount / smallerSize >= 0.92;
}

function collectDraftTerms(content: string): Set<string> {
  const terms = new Set<string>();
  for (const token of content.toLowerCase().split(/[^a-z0-9]+/)) {
    if (token.length < 4) {
      continue;
    }
    if (COVERAGE_TOKEN_IGNORE.has(token)) {
      continue;
    }
    terms.add(token);
  }
  return terms;
}


function buildMigrationBatchSourceFromNumbers(input: {
  fileSystem: FileSystem;
  state: ReturnType<typeof readMigrationState>;
  migrationNumbers: readonly number[];
}): string {
  const { fileSystem, state, migrationNumbers } = input;
  const selectedNumbers = new Set(migrationNumbers);
  const sections: string[] = [];
  for (const migration of state.migrations) {
    if (!selectedNumbers.has(migration.number)) {
      continue;
    }
    sections.push(`# ${path.basename(migration.filePath)}\n\n${fileSystem.readText(migration.filePath).trim()}`);
  }

  return sections.join("\n\n---\n\n");
}

function getPendingExecutableMigrationNumbers(
  fileSystem: FileSystem,
  state: ReturnType<typeof readMigrationState>,
): number[] {
  const pending: number[] = [];
  for (const migration of state.migrations) {
    const tasks = parseTasks(fileSystem.readText(migration.filePath), migration.filePath);
    if (tasks.length === 0) {
      continue;
    }

    if (tasks.some((task) => !task.checked)) {
      pending.push(migration.number);
    }
  }

  return pending;
}

async function runExploreForMigration(input: {
  runExplore: (source: string, cwd: string) => Promise<number>;
  migrationPath: string;
  projectRoot: string;
}): Promise<void> {
  const { runExplore, migrationPath, projectRoot } = input;

  const exploreExitCode = await runExplore(migrationPath, projectRoot);
  if (exploreExitCode !== EXIT_CODE_SUCCESS) {
    throw new Error("Explore failed for " + migrationPath + ".");
  }
}

function readTemplate(
  templateLoader: TemplateLoader,
  projectRoot: string,
  fileName: string,
  fallback: string,
): string {
  const templatePath = path.join(projectRoot, ".rundown", fileName);
  return templateLoader.load(templatePath) ?? fallback;
}

function buildTemplateVars(input: {
  fileSystem: FileSystem;
  state: ReturnType<typeof readMigrationState>;
  projectRoot: string;
  invocationRoot: string;
  workspaceDirectories: ReturnType<typeof resolveWorkspaceDirectories>;
  workspacePlacement: ReturnType<typeof resolveWorkspacePlacement>;
  workspacePaths: ReturnType<typeof resolveWorkspacePaths>;
  designRevisionTarget?: string | number;
  revisionDiff?: DesignRevisionDiffContext;
  migrationDraftDir?: string;
  newMigrations?: string;
}): TemplateVars {
  const {
    fileSystem,
    state,
    projectRoot,
    invocationRoot,
    workspaceDirectories,
    workspacePlacement,
    workspacePaths,
    designRevisionTarget,
    revisionDiff: providedRevisionDiff,
    migrationDraftDir,
    newMigrations,
  } = input;
  const latestMigration = state.migrations[state.migrations.length - 1] ?? null;

  const revisionDiff = providedRevisionDiff
    ?? prepareDesignRevisionDiffContext(fileSystem, projectRoot, {
      invocationRoot,
      target: designRevisionTarget,
    });
  const designContextSources = {
    sourceReferences: [revisionDiff.toTarget.absolutePath],
    hasManagedDocs: isDirectory(fileSystem, revisionDiff.toTarget.absolutePath),
  };
  const design = formatRevisionDesignContext(fileSystem, revisionDiff.toTarget.absolutePath);
  const previousRevisionId = revisionDiff.fromRevision?.name ?? (revisionDiff.hasComparison ? "nothing" : "");
  const currentRevisionId = revisionDiff.toTarget.name;
  const currentRevisionCreatedAt = revisionDiff.toTarget.metadata.createdAt;
  const currentRevisionLabel = revisionDiff.toTarget.metadata.label;
  const previousRevisionCreatedAt = revisionDiff.fromRevision?.metadata.createdAt ?? "";
  const previousRevisionLabel = revisionDiff.fromRevision?.metadata.label ?? "";
  const currentRevisionMetadataPath = revisionDiff.toTarget.metadataPath;
  const previousRevisionMetadataPath = revisionDiff.fromRevision?.metadataPath ?? "";
  const revisionDiffFiles = revisionDiff.changes.map((change) => {
    return "- " + change.kind + ": " + change.relativePath;
  }).join("\n");
  const revisionDiffContent = formatDesignRevisionUnifiedDiff(fileSystem, revisionDiff);
  const revisionDiffSourceRefs = revisionDiff.sourceReferences.map((sourcePath) => "- " + sourcePath).join("\n");
  const designContextSourceRefs = designContextSources.sourceReferences.map((sourcePath) => "- " + sourcePath).join("\n");

  const historyLines = state.migrations.map((migration) => {
    const fileName = path.basename(migration.filePath);
    return "- " + fileName;
  });

  return {
    task: "migrate",
    file: latestMigration?.filePath ?? "",
    context: "",
    taskIndex: 0,
    taskLine: 1,
    source: "",
    design,
    latestMigration: latestMigration ? fileSystem.readText(latestMigration.filePath) : "",
    newMigrations: newMigrations ?? "",
    migrationDraftDir: migrationDraftDir ?? "",
    migrationHistory: historyLines.join("\n"),
    designContextSourceReferences: designContextSourceRefs,
    designContextSourceReferencesJson: JSON.stringify(designContextSources.sourceReferences),
    designContextHasManagedDocs: designContextSources.hasManagedDocs ? "true" : "false",
    currentRevisionId,
    previousRevisionId,
    currentRevisionCreatedAt,
    currentRevisionLabel,
    previousRevisionCreatedAt,
    previousRevisionLabel,
    currentRevisionMetadataPath,
    previousRevisionMetadataPath,
    revisionDiffSummary: revisionDiff.summary,
    revisionDiffSourceReferences: revisionDiffSourceRefs,
    revisionDiffSourceReferencesJson: JSON.stringify(revisionDiff.sourceReferences),
    designRevisionDiffSummary: revisionDiff.summary,
    designRevisionDiffHasComparison: revisionDiff.hasComparison ? "true" : "false",
    designRevisionFromRevision: previousRevisionId,
    designRevisionToTarget: currentRevisionId,
    designRevisionDiffAddedCount: revisionDiff.addedCount,
    designRevisionDiffModifiedCount: revisionDiff.modifiedCount,
    designRevisionDiffRemovedCount: revisionDiff.removedCount,
    designRevisionDiffFiles: revisionDiffFiles,
    designRevisionDiffContent: revisionDiffContent,
    designRevisionDiffSources: revisionDiffSourceRefs,
    workspaceDesignDir: workspaceDirectories.design,
    workspaceSpecsDir: workspaceDirectories.specs,
    workspaceMigrationsDir: workspaceDirectories.migrations,
    workspacePredictionDir: workspaceDirectories.prediction,
    workspaceDesignPlacement: workspacePlacement.design,
    workspaceSpecsPlacement: workspacePlacement.specs,
    workspaceMigrationsPlacement: workspacePlacement.migrations,
    workspaceDesignPath: workspacePaths.design,
    workspaceSpecsPath: workspacePaths.specs,
    workspaceMigrationsPath: workspacePaths.migrations,
    invocationDir: invocationRoot,
    workspaceDir: projectRoot,
    position: state.currentPosition,
  };
}

function readMigrationState(fileSystem: FileSystem, migrationsDir: string) {
  const files = fileSystem.readdir(migrationsDir)
    .filter((entry) => entry.isFile)
    .map((entry) => path.join(migrationsDir, entry.name));
  return parseMigrationDirectory(files, migrationsDir);
}

export async function confirmBeforeWrite(
  output: ApplicationOutputPort,
  interactiveInput: InteractiveInputPort,
  filename: string,
  content: string,
): Promise<boolean> {
  output.emit({ kind: "text", text: content.endsWith("\n") ? content : content + "\n" });

  if (interactiveInput.prepareForPrompt) {
    await interactiveInput.prepareForPrompt();
  }

  const answer = await interactiveInput.prompt({
    kind: "confirm",
    message: "Write " + filename + "?",
    defaultValue: true,
  });
  const approved = answer.value.trim().toLowerCase() === "true";

  if (!approved) {
    output.emit({ kind: "info", message: "Skipped " + filename + "." });
  }

  return approved;
}

export function isMigrationLikeFileName(fileName: string): boolean {
  return parseMigrationFilename(fileName) !== null;
}
