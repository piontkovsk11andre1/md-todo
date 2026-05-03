import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMigrateTask } from "../../src/application/migrate-task.js";
import {
  EXIT_CODE_FAILURE,
  EXIT_CODE_SUCCESS,
  type ExitCode,
} from "../../src/domain/exit-codes.js";
import { formatMigrationFilename } from "../../src/domain/migration-parser.js";
import { inferWorkerPatternFromCommand } from "../../src/domain/worker-pattern.js";
import { createNodeFileSystem } from "../../src/infrastructure/adapters/fs-file-system.js";
import type {
  ApplicationOutputEvent,
  ArtifactStore,
  InteractiveInputPort,
  SourceResolverPort,
  WorkerExecutorPort,
} from "../../src/domain/ports/index.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dirPath = tempDirs.pop();
    if (dirPath) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  }
});

describe("migrate-task", () => {
  it("enriches each created migration and emits no configuration warning", async () => {
    const workspace = makeTempWorkspace();
    scaffoldReleasedDesignRevisions(workspace, "design");
    fs.mkdirSync(path.join(workspace, "migrations"), { recursive: true });
    fs.writeFileSync(
      path.join(workspace, "migrations", formatMigrationFilename(1, "initialize")),
      "# 1. Initialize\n\n- [x] bootstrap\n",
      "utf-8",
    );

    const events: ApplicationOutputEvent[] = [];
    const runExplore = vi.fn<(source: string, cwd: string) => Promise<ExitCode>>(async () => EXIT_CODE_SUCCESS);

    const workerExecutor: WorkerExecutorPort = {
      runWorker: vi.fn(async ({ prompt }) => {
        if (prompt.includes("Inventory design changes not yet reflected in the current prediction tree.")) {
          const draftDirMatch = prompt.match(/staging directory:\s*(.+)/i);
          const positionMatch = prompt.match(/Current migration number:\s*(\d+)/i);
          const draftDir = draftDirMatch?.[1]?.trim() ?? "";
          const position = Number.parseInt(positionMatch?.[1] ?? "0", 10);
          fs.mkdirSync(draftDir, { recursive: true });
          fs.writeFileSync(
            path.join(draftDir, formatMigrationFilename(position + 1, "first-created-migration")),
            "# 2. First Created Migration\n\n- [ ] Draft task one\n",
            "utf-8",
          );
          fs.writeFileSync(
            path.join(draftDir, formatMigrationFilename(position + 2, "second-created-migration")),
            "# 3. Second Created Migration\n\n- [ ] Draft task two\n",
            "utf-8",
          );
          return {
            exitCode: 0,
            stdout: "drafted migration files",
            stderr: "",
          };
        }

        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
        };
      }),
      executeInlineCli: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
      executeRundownTask: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
    };

    const artifactStore: ArtifactStore = {
      createContext: vi.fn(() => ({
        runId: "run-test",
        rootDir: path.join(workspace, ".rundown", "runs", "run-test"),
        cwd: workspace,
        keepArtifacts: false,
        commandName: "migrate",
      })),
      beginPhase: vi.fn(() => {
        throw new Error("not used");
      }),
      completePhase: vi.fn(),
      finalize: vi.fn(),
      displayPath: vi.fn(() => ""),
      rootDir: vi.fn(() => ""),
      listSaved: vi.fn(() => []),
      listFailed: vi.fn(() => []),
      latest: vi.fn(() => null),
      find: vi.fn(() => null),
      removeSaved: vi.fn(() => 0),
      removeFailed: vi.fn(() => 0),
      isFailedStatus: vi.fn(() => false),
    };

    const sourceResolver: SourceResolverPort = {
      resolveSources: vi.fn(async () => []),
    };

    const interactiveInput: InteractiveInputPort = {
      isTTY: () => false,
      prompt: vi.fn(async () => ({ value: "true", usedDefault: true, interactive: false })),
    };

    const migrateTask = createMigrateTask({
      workerExecutor,
      fileSystem: createNodeFileSystem(),
      templateLoader: {
        load: () => undefined,
      },
      sourceResolver,
      workerConfigPort: {
        load: () => undefined,
      },
      artifactStore,
      interactiveInput,
      output: {
        emit: (event) => {
          events.push(event);
        },
      },
      runExplore,
    });

    const previousCwd = process.cwd();
    process.chdir(workspace);
    try {
      const code = await migrateTask({
        dir: "migrations",
        workerPattern: inferWorkerPatternFromCommand(["node", "-e", "void 0"]),
      });

      expect(code).toBe(EXIT_CODE_SUCCESS);
      expect(runExplore).toHaveBeenNthCalledWith(
        1,
        path.join(workspace, "migrations", formatMigrationFilename(2, "first-created-migration")),
        workspace,
      );
      expect(runExplore).toHaveBeenNthCalledWith(
        2,
        path.join(workspace, "migrations", formatMigrationFilename(3, "second-created-migration")),
        workspace,
      );
      expect(
        fs.existsSync(path.join(workspace, ".rundown", "runs", "run-test", "drafted-migrations", "rev.1")),
      ).toBe(true);

      const warningMessages = events
        .filter((event) => event.kind === "warn")
        .map((event) => event.message);
      expect(warningMessages.some((message) => message.includes("Explore integration is not configured"))).toBe(false);
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("fails before promotion when staged draft filenames are not canonical", async () => {
    const workspace = makeTempWorkspace();
    scaffoldReleasedDesignRevisions(workspace, "design");
    fs.mkdirSync(path.join(workspace, "migrations"), { recursive: true });
    fs.writeFileSync(
      path.join(workspace, "migrations", formatMigrationFilename(1, "initialize")),
      "# 1. Initialize\n\n- [x] bootstrap\n",
      "utf-8",
    );

    const events: ApplicationOutputEvent[] = [];
    const runExplore = vi.fn<(source: string, cwd: string) => Promise<ExitCode>>(async () => EXIT_CODE_SUCCESS);

    const workerExecutor: WorkerExecutorPort = {
      runWorker: vi.fn(async ({ prompt }) => {
        if (prompt.includes("Inventory design changes not yet reflected in the current prediction tree.")) {
          const draftDirMatch = prompt.match(/staging directory:\s*(.+)/i);
          const draftDir = draftDirMatch?.[1]?.trim() ?? "";
          fs.mkdirSync(draftDir, { recursive: true });
          fs.writeFileSync(
            path.join(draftDir, "2. first-created-migration.md"),
            "# 2. First Created Migration\n\n- [ ] Draft task one\n",
            "utf-8",
          );
        }

        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
        };
      }),
      executeInlineCli: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
      executeRundownTask: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
    };

    const artifactStore: ArtifactStore = {
      createContext: vi.fn(() => ({
        runId: "run-test",
        rootDir: path.join(workspace, ".rundown", "runs", "run-test"),
        cwd: workspace,
        keepArtifacts: false,
        commandName: "migrate",
      })),
      beginPhase: vi.fn(() => {
        throw new Error("not used");
      }),
      completePhase: vi.fn(),
      finalize: vi.fn(),
      displayPath: vi.fn(() => ""),
      rootDir: vi.fn(() => ""),
      listSaved: vi.fn(() => []),
      listFailed: vi.fn(() => []),
      latest: vi.fn(() => null),
      find: vi.fn(() => null),
      removeSaved: vi.fn(() => 0),
      removeFailed: vi.fn(() => 0),
      isFailedStatus: vi.fn(() => false),
    };

    const sourceResolver: SourceResolverPort = {
      resolveSources: vi.fn(async () => []),
    };

    const interactiveInput: InteractiveInputPort = {
      isTTY: () => false,
      prompt: vi.fn(async () => ({ value: "true", usedDefault: true, interactive: false })),
    };

    const migrateTask = createMigrateTask({
      workerExecutor,
      fileSystem: createNodeFileSystem(),
      templateLoader: {
        load: () => undefined,
      },
      sourceResolver,
      workerConfigPort: {
        load: () => undefined,
      },
      artifactStore,
      interactiveInput,
      output: {
        emit: (event) => {
          events.push(event);
        },
      },
      runExplore,
    });

    const previousCwd = process.cwd();
    process.chdir(workspace);
    try {
      const code = await migrateTask({
        dir: "migrations",
        workerPattern: inferWorkerPatternFromCommand(["node", "-e", "void 0"]),
      });

      expect(code).toBe(EXIT_CODE_FAILURE);
      expect(runExplore).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(workspace, "migrations", "2. first-created-migration.md"))).toBe(false);

      const errorMessages = events
        .filter((event) => event.kind === "error")
        .map((event) => event.message)
        .join("\n");
      expect(errorMessages).toContain("Drafted migration filenames must be canonical");
      expect(errorMessages).toContain("2. first-created-migration.md");
    } finally {
      process.chdir(previousCwd);
    }
  });
});

function scaffoldReleasedDesignRevisions(workspace: string, designDir: string): void {
  const designRoot = path.join(workspace, designDir);
  const now = "2026-01-01T00:00:00.000Z";

  fs.mkdirSync(path.join(designRoot, "current"), { recursive: true });
  fs.mkdirSync(path.join(designRoot, "rev.0"), { recursive: true });
  fs.mkdirSync(path.join(designRoot, "rev.1"), { recursive: true });

  fs.writeFileSync(path.join(designRoot, "current", "Target.md"), "# Design\n\nWorking draft in current/.\n", "utf-8");
  fs.writeFileSync(path.join(designRoot, "rev.0", "Target.md"), "# Design\n\nBaseline design.\n", "utf-8");
  fs.writeFileSync(path.join(designRoot, "rev.1", "Target.md"), "# Design\n\nReleased rev.1 design.\n", "utf-8");

  fs.writeFileSync(path.join(designRoot, "rev.0.meta.json"), JSON.stringify({
    revision: "rev.0",
    index: 0,
    createdAt: now,
    plannedAt: now,
    migrations: [],
  }, null, 2) + "\n", "utf-8");

  fs.writeFileSync(path.join(designRoot, "rev.1.meta.json"), JSON.stringify({
    revision: "rev.1",
    index: 1,
    createdAt: now,
    plannedAt: null,
    migrations: [],
  }, null, 2) + "\n", "utf-8");
}

function makeTempWorkspace(): string {
  const isolatedTempRoot = path.join(path.parse(os.tmpdir()).root, "rundown-test-tmp");
  fs.mkdirSync(isolatedTempRoot, { recursive: true });
  const dirPath = fs.mkdtempSync(path.join(isolatedTempRoot, "rundown-migrate-app-"));
  tempDirs.push(dirPath);
  return dirPath;
}
