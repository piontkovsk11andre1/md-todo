import { describe, expect, it, vi } from "vitest";
import { createLocalizeProject } from "../../src/application/localize-project.js";
import { EXIT_CODE_FAILURE } from "../../src/domain/exit-codes.js";
import type {
  ConfigDirResult,
  FileSystem,
  TemplateLoader,
  WorkerConfigPort,
  WorkerExecutorPort,
} from "../../src/domain/ports/index.js";
import type { ApplicationOutputPort } from "../../src/domain/ports/output-port.js";

function createFileSystemMock(): FileSystem {
  return {
    exists: vi.fn(() => false),
    readText: vi.fn(() => ""),
    writeText: vi.fn(),
    mkdir: vi.fn(),
    readdir: vi.fn(() => []),
    stat: vi.fn(() => null),
    unlink: vi.fn(),
    rm: vi.fn(),
  };
}

function createWorkerExecutorMock(): WorkerExecutorPort {
  return {
    runWorker: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
    executeInlineCli: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
    executeRundownTask: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
  };
}

describe("localize-project", () => {
  it("fails gracefully before translation work when no worker is configured", async () => {
    const fileSystem = createFileSystemMock();
    const workerExecutor = createWorkerExecutorMock();
    const workerConfigPort: WorkerConfigPort = {
      load: vi.fn(() => undefined),
    };
    const output: ApplicationOutputPort = {
      emit: vi.fn(),
    };
    const templateLoader: TemplateLoader = {
      load: vi.fn(() => null),
    };
    const configDir: ConfigDirResult = {
      configDir: "/repo/.rundown",
      isExplicit: false,
    };

    const localizeProject = createLocalizeProject({
      fileSystem,
      workerExecutor,
      workerConfigPort,
      configDir,
      output,
      templateLoader,
    });

    const exitCode = await localizeProject({ language: "Chinese" });

    expect(exitCode).toBe(EXIT_CODE_FAILURE);
    expect(output.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "error",
        message: expect.stringContaining("No worker command available"),
      }),
    );
    expect(fileSystem.mkdir).not.toHaveBeenCalled();
    expect(fileSystem.writeText).not.toHaveBeenCalled();
    expect(workerExecutor.runWorker).not.toHaveBeenCalled();
  });
});
