import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMigrateTask,
  discoverMigrationThreads,
  loadMigrationThreadStates,
  materializeMigrationThreadBriefs,
} from "../../src/application/migrate-task.js";
import {
  EXIT_CODE_FAILURE,
  EXIT_CODE_SUCCESS,
  type ExitCode,
} from "../../src/domain/exit-codes.js";
import { formatMigrationFilename } from "../../src/domain/migration-parser.js";
import { inferWorkerPatternFromCommand } from "../../src/domain/worker-pattern.js";
import { createNodeFileSystem } from "../../src/infrastructure/adapters/fs-file-system.js";
import { createNoopTraceWriter } from "../../src/infrastructure/adapters/noop-trace-writer.js";
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
    let secondMigrationWasPromotedBeforeFirstExplore = false;
    const runExplore = vi.fn<(source: string, cwd: string) => Promise<ExitCode>>(async (source) => {
      if (source.endsWith(formatMigrationFilename(2, "first-created-migration"))) {
        secondMigrationWasPromotedBeforeFirstExplore = fs.existsSync(
          path.join(workspace, "migrations", formatMigrationFilename(3, "second-created-migration")),
        );
      }
      return EXIT_CODE_SUCCESS;
    });

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
      traceWriter: createNoopTraceWriter(),
      templateLoader: {
        load: () => undefined,
      },
      sourceResolver,
      workerConfigPort: {
        load: () => undefined,
      },
      artifactStore,
      configDir: path.join(workspace, ".rundown"),
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
      expect(secondMigrationWasPromotedBeforeFirstExplore).toBe(true);
      expect(
        fs.existsSync(path.join(workspace, ".rundown", "runs", "run-test", "drafted-migrations", "rev.1")),
      ).toBe(true);

      const rev1Meta = JSON.parse(
        fs.readFileSync(path.join(workspace, "design", "rev.1.meta.json"), "utf-8"),
      ) as {
        plannedAt?: string | null;
        migrations?: string[];
      };
      expect(rev1Meta.plannedAt).toBeTypeOf("string");
      expect(rev1Meta.migrations ?? []).toEqual([
        path.posix.join("migrations", formatMigrationFilename(2, "first-created-migration")),
        path.posix.join("migrations", formatMigrationFilename(3, "second-created-migration")),
      ]);

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
      traceWriter: createNoopTraceWriter(),
      templateLoader: {
        load: () => undefined,
      },
      sourceResolver,
      workerConfigPort: {
        load: () => undefined,
      },
      artifactStore,
      configDir: path.join(workspace, ".rundown"),
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

  it("fails before promotion when staged drafts do not cover changed diff areas", async () => {
    const workspace = makeTempWorkspace();
    scaffoldReleasedDesignRevisions(workspace, "design");
    fs.mkdirSync(path.join(workspace, "migrations"), { recursive: true });
    fs.writeFileSync(
      path.join(workspace, "migrations", formatMigrationFilename(1, "initialize")),
      "# 1. Initialize\n\n- [x] bootstrap\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(workspace, "design", "rev.1", "BillingFlow.md"),
      "# Billing\n\nNew billing workflow requirements.\n",
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
            path.join(draftDir, formatMigrationFilename(position + 1, "api-migration")),
            "# 2. Api Migration\n\n- [ ] Update API handlers and request contracts for migrated endpoints.\n",
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
      traceWriter: createNoopTraceWriter(),
      templateLoader: {
        load: () => undefined,
      },
      sourceResolver,
      workerConfigPort: {
        load: () => undefined,
      },
      artifactStore,
      configDir: path.join(workspace, ".rundown"),
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
      expect(fs.existsSync(path.join(workspace, "migrations", formatMigrationFilename(2, "api-migration")))).toBe(false);

      const errorMessages = events
        .filter((event) => event.kind === "error")
        .map((event) => event.message)
        .join("\n");
      expect(errorMessages).toContain("Drafted migrations do not appear to cover all changed design areas");
      expect(errorMessages).toContain("BillingFlow.md");
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("repairs staged drafts and re-verifies before promotion", async () => {
    const workspace = makeTempWorkspace();
    scaffoldReleasedDesignRevisions(workspace, "design");
    fs.mkdirSync(path.join(workspace, "migrations"), { recursive: true });
    fs.writeFileSync(
      path.join(workspace, "migrations", formatMigrationFilename(1, "initialize")),
      "# 1. Initialize\n\n- [x] bootstrap\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(workspace, "design", "rev.1", "BillingFlow.md"),
      "# Billing\n\nNew billing workflow requirements.\n",
      "utf-8",
    );

    const runExplore = vi.fn<(source: string, cwd: string) => Promise<ExitCode>>(async () => EXIT_CODE_SUCCESS);

    let draftedFileName = "";
    const workerExecutor: WorkerExecutorPort = {
      runWorker: vi.fn(async ({ prompt }) => {
        if (prompt.includes("Inventory design changes not yet reflected in the current prediction tree.")) {
          const draftDirMatch = prompt.match(/staging directory:\s*(.+)/i);
          const positionMatch = prompt.match(/Current migration number:\s*(\d+)/i);
          const draftDir = draftDirMatch?.[1]?.trim() ?? "";
          const position = Number.parseInt(positionMatch?.[1] ?? "0", 10);
          draftedFileName = formatMigrationFilename(position + 1, "api-migration");
          fs.mkdirSync(draftDir, { recursive: true });
          fs.writeFileSync(
            path.join(draftDir, draftedFileName),
            "# 2. Api Migration\n\n- [ ] Update API handlers only.\n",
            "utf-8",
          );
          return {
            exitCode: 0,
            stdout: "drafted migration files",
            stderr: "",
          };
        }

        if (prompt.includes("Repair staged migration drafts")) {
          const draftDirMatch = prompt.match(/Edit only files inside this staging directory:\s*(.+)/i);
          const draftDir = draftDirMatch?.[1]?.trim() ?? "";
          fs.writeFileSync(
            path.join(draftDir, draftedFileName),
            "# 2. Api Migration\n\n- [ ] Cover BillingFlow.md changes and billing workflow updates.\n",
            "utf-8",
          );
          return {
            exitCode: 0,
            stdout: "repaired staged draft",
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
      traceWriter: createNoopTraceWriter(),
      templateLoader: {
        load: () => undefined,
      },
      sourceResolver,
      workerConfigPort: {
        load: () => undefined,
      },
      artifactStore,
      configDir: path.join(workspace, ".rundown"),
      interactiveInput,
      output: {
        emit: () => {},
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
      const promotedPath = path.join(workspace, "migrations", formatMigrationFilename(2, "api-migration"));
      expect(fs.existsSync(promotedPath)).toBe(true);
      expect(fs.readFileSync(promotedPath, "utf-8")).toContain("BillingFlow.md");
      expect(runExplore).toHaveBeenCalledTimes(1);
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("fails when repair mutates real migrations directory instead of staged drafts", async () => {
    const workspace = makeTempWorkspace();
    scaffoldReleasedDesignRevisions(workspace, "design");
    fs.mkdirSync(path.join(workspace, "migrations"), { recursive: true });
    fs.writeFileSync(
      path.join(workspace, "migrations", formatMigrationFilename(1, "initialize")),
      "# 1. Initialize\n\n- [x] bootstrap\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(workspace, "design", "rev.1", "BillingFlow.md"),
      "# Billing\n\nNew billing workflow requirements.\n",
      "utf-8",
    );

    const events: ApplicationOutputEvent[] = [];
    const runExplore = vi.fn<(source: string, cwd: string) => Promise<ExitCode>>(async () => EXIT_CODE_SUCCESS);
    let repairWriteCount = 0;

    const workerExecutor: WorkerExecutorPort = {
      runWorker: vi.fn(async ({ prompt }) => {
        if (prompt.includes("Inventory design changes not yet reflected in the current prediction tree.")) {
          const draftDirMatch = prompt.match(/staging directory:\s*(.+)/i);
          const positionMatch = prompt.match(/Current migration number:\s*(\d+)/i);
          const draftDir = draftDirMatch?.[1]?.trim() ?? "";
          const position = Number.parseInt(positionMatch?.[1] ?? "0", 10);
          fs.mkdirSync(draftDir, { recursive: true });
          fs.writeFileSync(
            path.join(draftDir, formatMigrationFilename(position + 1, "api-migration")),
            "# 2. Api Migration\n\n- [ ] Update API handlers only.\n",
            "utf-8",
          );
          return {
            exitCode: 0,
            stdout: "drafted migration files",
            stderr: "",
          };
        }

        if (prompt.includes("Repair staged migration drafts")) {
          repairWriteCount += 1;
          fs.writeFileSync(
            path.join(workspace, "migrations", formatMigrationFilename(900 + repairWriteCount, "bad-repair-write")),
            "# Bad Repair Write\n\n- [ ] should never be written during staged repair\n",
            "utf-8",
          );
          return {
            exitCode: 0,
            stdout: "repaired staged draft",
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
      traceWriter: createNoopTraceWriter(),
      templateLoader: {
        load: () => undefined,
      },
      sourceResolver,
      workerConfigPort: {
        load: () => undefined,
      },
      artifactStore,
      configDir: path.join(workspace, ".rundown"),
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
      const errorMessages = events
        .filter((event) => event.kind === "error")
        .map((event) => event.message)
        .join("\n");
      expect(errorMessages).toContain("Repair must mutate staged drafts only");
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("discovers thread markdown files and derives stable slugs from filenames", () => {
    const workspace = makeTempWorkspace();
    const threadsDir = path.join(workspace, ".rundown", "threads");
    fs.mkdirSync(threadsDir, { recursive: true });
    fs.writeFileSync(path.join(threadsDir, "API Review.md"), "# API Review\n", "utf-8");
    fs.writeFileSync(path.join(threadsDir, "a-b.md"), "# A B\n", "utf-8");
    fs.writeFileSync(path.join(threadsDir, "a b.md"), "# A B duplicate slug\n", "utf-8");
    fs.writeFileSync(path.join(threadsDir, "README.txt"), "not a thread\n", "utf-8");

    const threads = discoverMigrationThreads(createNodeFileSystem(), workspace);

    expect(threads.map((thread) => thread.fileName)).toEqual([
      "a b.md",
      "a-b.md",
      "API Review.md",
    ]);
    expect(threads.map((thread) => thread.threadSlug)).toEqual([
      "a-b",
      "a-b-2",
      "api-review",
    ]);
    expect(threads.map((thread) => thread.sourcePathFromWorkspace)).toEqual([
      ".rundown/threads/a b.md",
      ".rundown/threads/a-b.md",
      ".rundown/threads/API Review.md",
    ]);
  });

  it("returns no threads when .rundown/threads is missing or has no markdown files", () => {
    const workspace = makeTempWorkspace();

    const noneWhenMissing = discoverMigrationThreads(createNodeFileSystem(), workspace);
    expect(noneWhenMissing).toEqual([]);

    const threadsDir = path.join(workspace, ".rundown", "threads");
    fs.mkdirSync(threadsDir, { recursive: true });
    fs.writeFileSync(path.join(threadsDir, "notes.txt"), "no markdown\n", "utf-8");

    const noneWhenNoMarkdown = discoverMigrationThreads(createNodeFileSystem(), workspace);
    expect(noneWhenNoMarkdown).toEqual([]);
  });

  it("loads per-thread migration state from migrations/threads/<thread>", () => {
    const workspace = makeTempWorkspace();
    const fileSystem = createNodeFileSystem();
    const threadsDir = path.join(workspace, ".rundown", "threads");
    const migrationsDir = path.join(workspace, "migrations");
    const billingThreadDir = path.join(migrationsDir, "threads", "billing");
    const apiReviewThreadDir = path.join(migrationsDir, "threads", "api-review");

    fs.mkdirSync(threadsDir, { recursive: true });
    fs.writeFileSync(path.join(threadsDir, "billing.md"), "# Billing\n", "utf-8");
    fs.writeFileSync(path.join(threadsDir, "api review.md"), "# API Review\n", "utf-8");

    fs.mkdirSync(path.join(migrationsDir, "threads"), { recursive: true });
    fs.writeFileSync(path.join(migrationsDir, formatMigrationFilename(50, "root-only")), "# 50. Root Only\n", "utf-8");
    fs.mkdirSync(billingThreadDir, { recursive: true });
    fs.writeFileSync(path.join(billingThreadDir, formatMigrationFilename(2, "billing-seed")), "# 2. Billing Seed\n", "utf-8");
    fs.mkdirSync(apiReviewThreadDir, { recursive: true });
    fs.writeFileSync(path.join(apiReviewThreadDir, formatMigrationFilename(7, "api-review-seed")), "# 7. Api Review Seed\n", "utf-8");

    const discoveredThreads = discoverMigrationThreads(fileSystem, workspace);
    const loadedStates = loadMigrationThreadStates({
      fileSystem,
      migrationsDir,
      threads: discoveredThreads,
    });

    expect(loadedStates.map((entry) => entry.thread.threadSlug)).toEqual(["api-review", "billing"]);
    expect(loadedStates.map((entry) => entry.migrationsDir)).toEqual([
      apiReviewThreadDir,
      billingThreadDir,
    ]);
    expect(loadedStates.map((entry) => entry.state.currentPosition)).toEqual([7, 2]);
    expect(loadedStates[0]?.state.migrations.map((migration) => path.basename(migration.filePath))).toEqual([
      formatMigrationFilename(7, "api-review-seed"),
    ]);
    expect(loadedStates[1]?.state.migrations.map((migration) => path.basename(migration.filePath))).toEqual([
      formatMigrationFilename(2, "billing-seed"),
    ]);
  });

  it("loads empty state for a thread when its migrations directory does not exist", () => {
    const workspace = makeTempWorkspace();
    const fileSystem = createNodeFileSystem();
    const threadsDir = path.join(workspace, ".rundown", "threads");
    const migrationsDir = path.join(workspace, "migrations");

    fs.mkdirSync(threadsDir, { recursive: true });
    fs.writeFileSync(path.join(threadsDir, "ops.md"), "# Ops\n", "utf-8");
    fs.mkdirSync(migrationsDir, { recursive: true });

    const discoveredThreads = discoverMigrationThreads(fileSystem, workspace);
    const loadedStates = loadMigrationThreadStates({
      fileSystem,
      migrationsDir,
      threads: discoveredThreads,
    });

    expect(loadedStates).toHaveLength(1);
    expect(loadedStates[0]?.thread.threadSlug).toBe("ops");
    expect(loadedStates[0]?.migrationsDir).toBe(path.join(migrationsDir, "threads", "ops"));
    expect(loadedStates[0]?.state.currentPosition).toBe(0);
    expect(loadedStates[0]?.state.migrations).toEqual([]);
  });

  it("materializes translated briefs per thread into run artifacts", async () => {
    const workspace = makeTempWorkspace();
    const fileSystem = createNodeFileSystem();
    const threadsDir = path.join(workspace, ".rundown", "threads");
    const runRootDir = path.join(workspace, ".rundown", "runs", "run-test");
    const revisionName = "rev.1";

    fs.mkdirSync(threadsDir, { recursive: true });
    fs.writeFileSync(path.join(threadsDir, "billing.md"), "# Billing\n\nFocus on billing rollout.\n", "utf-8");
    fs.writeFileSync(path.join(threadsDir, "ops.md"), "# Ops\n\nFocus on ops rollout.\n", "utf-8");
    fs.mkdirSync(runRootDir, { recursive: true });

    const threads = discoverMigrationThreads(fileSystem, workspace);
    const workerExecutor: WorkerExecutorPort = {
      runWorker: vi.fn(async ({ artifactExtra }) => {
        const threadSlug = String(artifactExtra?.threadSlug ?? "unknown");
        return {
          exitCode: 0,
          stdout: "# translated " + threadSlug + "\n\nthread-specific brief\n",
          stderr: "",
        };
      }),
      executeInlineCli: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
      executeRundownTask: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
    };

    const revisionDiff = {
      fromRevision: null,
      toTarget: {
        name: revisionName,
        absolutePath: path.join(workspace, "design", revisionName),
        metadataPath: path.join(workspace, "design", revisionName + ".meta.json"),
        metadata: {
          revision: revisionName,
          index: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          label: "Revision 1",
          plannedAt: null,
          migrations: [],
        },
      },
      hasComparison: true,
      summary: "1 file changed",
      changes: [
        {
          kind: "modified",
          relativePath: "Target.md",
          fromPath: path.join(workspace, "design", "rev.0", "Target.md"),
          toPath: path.join(workspace, "design", revisionName, "Target.md"),
        },
      ],
      addedCount: 0,
      modifiedCount: 1,
      removedCount: 0,
      sourceReferences: [
        path.join(workspace, "design", "rev.0", "Target.md"),
        path.join(workspace, "design", revisionName, "Target.md"),
      ],
    };

    const outputEvents: ApplicationOutputEvent[] = [];
    const briefs = await materializeMigrationThreadBriefs({
      fileSystem,
      workerExecutor,
      output: {
        emit: (event) => {
          outputEvents.push(event);
        },
      },
      workerPattern: inferWorkerPatternFromCommand(["node", "-e", "void 0"]),
      workspaceRoot: workspace,
      artifactContext: {
        runId: "run-test",
        rootDir: runRootDir,
        cwd: workspace,
        keepArtifacts: false,
        commandName: "migrate",
      },
      revisionName,
      revisionDiff,
      threads,
      translateTemplate: "## Source\n\n{{what}}\n\n## Guide\n\n{{how}}\n",
      showAgentOutput: true,
    });

    expect(briefs.map((entry) => entry.thread.threadSlug)).toEqual(["billing", "ops"]);
    expect(briefs.map((entry) => entry.outputPathFromWorkspace)).toEqual([
      ".rundown/runs/run-test/thread-briefs/rev.1/billing.md",
      ".rundown/runs/run-test/thread-briefs/rev.1/ops.md",
    ]);
    expect(fs.readFileSync(path.join(runRootDir, "thread-briefs", revisionName, "billing.md"), "utf-8")).toContain("translated billing");
    expect(fs.readFileSync(path.join(runRootDir, "thread-briefs", revisionName, "ops.md"), "utf-8")).toContain("translated ops");

    const workerCalls = (workerExecutor.runWorker as ReturnType<typeof vi.fn>).mock.calls;
    expect(workerCalls).toHaveLength(2);
    expect(workerCalls[0]?.[0]).toMatchObject({
      artifactPhase: "translate",
      artifactPhaseLabel: "migrate-thread-translate",
      artifactExtra: expect.objectContaining({
        workflow: "migrate-thread-translate",
        revision: revisionName,
        threadSlug: "billing",
      }),
    });
    expect(workerCalls[1]?.[0]).toMatchObject({
      artifactPhase: "translate",
      artifactPhaseLabel: "migrate-thread-translate",
      artifactExtra: expect.objectContaining({
        workflow: "migrate-thread-translate",
        revision: revisionName,
        threadSlug: "ops",
      }),
    });
    expect(outputEvents).toEqual([]);
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
