import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import {
  createWorkspaceUnlinkTask,
  type WorkspaceUnlinkOptions,
} from "../../src/application/workspace-lifecycle.js";
import type {
  ApplicationOutputEvent,
  FileSystem,
  PathOperationsPort,
  WorkingDirectoryPort,
} from "../../src/domain/ports/index.js";
import { WORKSPACE_LINK_SCHEMA_VERSION } from "../../src/domain/workspace-link.js";

describe("workspace-lifecycle unlink", () => {
  it("returns no-work when workspace.link is missing", async () => {
    const invocationDir = path.resolve("/repo/project");
    const { unlinkTask } = createHarness(invocationDir);

    const code = await unlinkTask({ all: false, dryRun: false });

    expect(code).toBe(3);
  });

  it("fails safely with candidate guidance when multi-record selection is ambiguous", async () => {
    const invocationDir = path.resolve("/repo/project");
    const workspaceLinkPath = path.join(invocationDir, ".rundown", "workspace.link");
    const { unlinkTask, events } = createHarness(invocationDir, {
      [workspaceLinkPath]: JSON.stringify({
        schemaVersion: WORKSPACE_LINK_SCHEMA_VERSION,
        records: [
          { id: "alpha", workspacePath: "../workspace-a" },
          { id: "beta", workspacePath: "../workspace-b" },
        ],
      }),
    });

    const code = await unlinkTask({ all: false, dryRun: false });

    expect(code).toBe(1);
    const errorEvent = events.find((event) => event.kind === "error");
    expect(errorEvent?.kind).toBe("error");
    if (errorEvent?.kind === "error") {
      expect(errorEvent.message).toContain("ambiguous");
      expect(errorEvent.message).toContain("Candidates:");
      expect(errorEvent.message).toContain("alpha");
      expect(errorEvent.message).toContain("beta");
    }
  });

  it("supports dry-run unlink without mutating workspace.link", async () => {
    const invocationDir = path.resolve("/repo/project");
    const workspaceLinkPath = path.join(invocationDir, ".rundown", "workspace.link");
    const { unlinkTask, fileSystem, events } = createHarness(invocationDir, {
      [workspaceLinkPath]: "../source-workspace\n",
    });

    const code = await unlinkTask({ all: false, dryRun: true });

    expect(code).toBe(0);
    expect(vi.mocked(fileSystem.writeText)).not.toHaveBeenCalled();
    expect(vi.mocked(fileSystem.rm)).not.toHaveBeenCalled();
    expect(events.some((event) => event.kind === "info" && event.message.includes("Dry run"))).toBe(true);
  });

  it("unlinks selected record and preserves remaining records", async () => {
    const invocationDir = path.resolve("/repo/project");
    const workspaceLinkPath = path.join(invocationDir, ".rundown", "workspace.link");
    const { unlinkTask, fileSystem } = createHarness(invocationDir, {
      [workspaceLinkPath]: JSON.stringify({
        schemaVersion: WORKSPACE_LINK_SCHEMA_VERSION,
        records: [
          { id: "alpha", workspacePath: "../workspace-a", default: true },
          { id: "beta", workspacePath: "../workspace-b" },
        ],
      }),
    });

    const code = await unlinkTask({ workspace: "alpha", all: false, dryRun: false });

    expect(code).toBe(0);
    expect(vi.mocked(fileSystem.writeText)).toHaveBeenCalledTimes(1);
    const serialized = vi.mocked(fileSystem.writeText).mock.calls[0]?.[1] ?? "";
    expect(serialized).toContain('"id": "beta"');
    expect(serialized).not.toContain('"id": "alpha"');
    expect(vi.mocked(fileSystem.rm)).not.toHaveBeenCalled();
  });

  it("removes workspace.link when last record is unlinked", async () => {
    const invocationDir = path.resolve("/repo/project");
    const workspaceLinkPath = path.join(invocationDir, ".rundown", "workspace.link");
    const { unlinkTask, fileSystem } = createHarness(invocationDir, {
      [workspaceLinkPath]: "../source-workspace\n",
    });

    const code = await unlinkTask({ all: false, dryRun: false });

    expect(code).toBe(0);
    expect(vi.mocked(fileSystem.rm)).toHaveBeenCalledWith(workspaceLinkPath, { force: true });
    expect(vi.mocked(fileSystem.writeText)).not.toHaveBeenCalled();
  });
});

function createHarness(invocationDir: string, initialFiles: Record<string, string> = {}): {
  unlinkTask: (options: WorkspaceUnlinkOptions) => Promise<number>;
  fileSystem: FileSystem;
  events: ApplicationOutputEvent[];
} {
  const events: ApplicationOutputEvent[] = [];
  const files = new Map<string, string>(Object.entries(initialFiles));

  const fileSystem: FileSystem = {
    exists: vi.fn((filePath: string) => files.has(path.resolve(filePath))),
    readText: vi.fn((filePath: string) => {
      const content = files.get(path.resolve(filePath));
      if (content === undefined) {
        throw new Error("ENOENT: " + filePath);
      }
      return content;
    }),
    writeText: vi.fn((filePath: string, content: string) => {
      files.set(path.resolve(filePath), content);
    }),
    mkdir: vi.fn(),
    readdir: vi.fn(() => []),
    stat: vi.fn((filePath: string) => {
      if (files.has(path.resolve(filePath))) {
        return {
          isFile: true,
          isDirectory: false,
        };
      }
      return null;
    }),
    unlink: vi.fn((filePath: string) => {
      files.delete(path.resolve(filePath));
    }),
    rm: vi.fn((filePath: string) => {
      files.delete(path.resolve(filePath));
    }),
  };

  const pathOperations: PathOperationsPort = {
    join: (...parts) => path.join(...parts),
    resolve: (...parts) => path.resolve(...parts),
    dirname: (filePath) => path.dirname(filePath),
    relative: (from, to) => path.relative(from, to),
    isAbsolute: (filePath) => path.isAbsolute(filePath),
  };

  const workingDirectory: WorkingDirectoryPort = {
    cwd: () => invocationDir,
  };

  const dependencies = {
    output: {
      emit: (event: ApplicationOutputEvent) => {
        events.push(event);
      },
    },
    fileSystem,
    pathOperations,
    workingDirectory,
  };

  return {
    unlinkTask: createWorkspaceUnlinkTask(dependencies),
    fileSystem,
    events,
  };
}
