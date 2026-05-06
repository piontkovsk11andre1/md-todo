import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSnapshotTask } from "../../src/application/snapshot-task.js";
import {
  EXIT_CODE_FAILURE,
  EXIT_CODE_NO_WORK,
  EXIT_CODE_SUCCESS,
} from "../../src/domain/exit-codes.js";
import { createNodeFileSystem } from "../../src/infrastructure/adapters/fs-file-system.js";
import type { ApplicationOutputEvent } from "../../src/domain/ports/index.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("snapshot-task", () => {
  it("creates lane-aware implementation snapshots from completed migration boundaries", async () => {
    const workspace = makeTempWorkspace();
    const migrationsDir = path.join(workspace, "migrations");
    const threadMigrationsDir = path.join(migrationsDir, "threads", "checkout");
    const implementationDir = path.join(workspace, "implementation");
    const threadBriefsDir = path.join(workspace, ".rundown", "threads");

    fs.mkdirSync(threadBriefsDir, { recursive: true });
    fs.writeFileSync(path.join(threadBriefsDir, "checkout.md"), "# Checkout\n", "utf-8");

    fs.mkdirSync(threadMigrationsDir, { recursive: true });
    fs.writeFileSync(
      path.join(migrationsDir, "1. Root Done.md"),
      "# 1. Root Done\n\n- [x] done\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(migrationsDir, "2. Root Done Again.md"),
      "# 2. Root Done Again\n\n- [x] done\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(threadMigrationsDir, "1. Checkout Done.md"),
      "# 1. Checkout Done\n\n- [x] done\n",
      "utf-8",
    );

    fs.mkdirSync(path.join(implementationDir, "nested"), { recursive: true });
    fs.writeFileSync(path.join(implementationDir, "README.md"), "implementation head\n", "utf-8");
    fs.writeFileSync(path.join(implementationDir, "nested", "state.txt"), "v2\n", "utf-8");

    const events: ApplicationOutputEvent[] = [];
    const snapshotTask = createSnapshotTask({
      fileSystem: createNodeFileSystem(),
      output: { emit: (event) => events.push(event) },
    });

    const previousCwd = process.cwd();
    process.chdir(workspace);
    try {
      const code = await snapshotTask({});
      expect(code).toBe(EXIT_CODE_SUCCESS);

      expect(fs.readFileSync(path.join(implementationDir, "snapshots", "root", "2", "README.md"), "utf-8")).toBe("implementation head\n");
      expect(fs.readFileSync(path.join(implementationDir, "snapshots", "root", "2", "nested", "state.txt"), "utf-8")).toBe("v2\n");

      expect(fs.readFileSync(path.join(implementationDir, "snapshots", "threads", "checkout", "1", "README.md"), "utf-8")).toBe("implementation head\n");
      expect(fs.readFileSync(path.join(implementationDir, "snapshots", "threads", "checkout", "1", "nested", "state.txt"), "utf-8")).toBe("v2\n");

      const successMessages = events
        .filter((event) => event.kind === "success")
        .map((event) => event.message);
      expect(successMessages.some((message) => message.includes("root migration 2"))).toBe(true);
      expect(successMessages.some((message) => message.includes("thread checkout migration 1"))).toBe(true);
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("rejects snapshot creation when any lane is between migration boundaries", async () => {
    const workspace = makeTempWorkspace();
    const migrationsDir = path.join(workspace, "migrations");
    const implementationDir = path.join(workspace, "implementation");
    fs.mkdirSync(migrationsDir, { recursive: true });
    fs.mkdirSync(implementationDir, { recursive: true });

    fs.writeFileSync(
      path.join(migrationsDir, "1. Root Done.md"),
      "# 1. Root Done\n\n- [x] done\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(migrationsDir, "2. Root In Progress.md"),
      "# 2. Root In Progress\n\n- [ ] pending\n",
      "utf-8",
    );

    const events: ApplicationOutputEvent[] = [];
    const snapshotTask = createSnapshotTask({
      fileSystem: createNodeFileSystem(),
      output: { emit: (event) => events.push(event) },
    });

    const previousCwd = process.cwd();
    process.chdir(workspace);
    try {
      const code = await snapshotTask({});
      expect(code).toBe(EXIT_CODE_FAILURE);
      expect(fs.existsSync(path.join(implementationDir, "snapshots", "root", "1"))).toBe(false);
      expect(events.some((event) => event.kind === "error" && event.message.includes("between migration boundaries"))).toBe(true);
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("does not recurse into implementation/snapshots while copying", async () => {
    const workspace = makeTempWorkspace();
    const migrationsDir = path.join(workspace, "migrations");
    const implementationDir = path.join(workspace, "implementation");
    fs.mkdirSync(migrationsDir, { recursive: true });
    fs.mkdirSync(path.join(implementationDir, "snapshots", "stale"), { recursive: true });

    fs.writeFileSync(path.join(migrationsDir, "1. Root Done.md"), "# 1. Root Done\n\n- [x] done\n", "utf-8");
    fs.writeFileSync(path.join(implementationDir, "app.txt"), "head\n", "utf-8");
    fs.writeFileSync(path.join(implementationDir, "snapshots", "stale", "old.txt"), "old\n", "utf-8");

    const snapshotTask = createSnapshotTask({
      fileSystem: createNodeFileSystem(),
      output: { emit: () => undefined },
    });

    const previousCwd = process.cwd();
    process.chdir(workspace);
    try {
      const code = await snapshotTask({});
      expect(code).toBe(EXIT_CODE_SUCCESS);
      const snapshotRoot = path.join(implementationDir, "snapshots", "root", "1");
      expect(fs.readFileSync(path.join(snapshotRoot, "app.txt"), "utf-8")).toBe("head\n");
      expect(fs.existsSync(path.join(snapshotRoot, "snapshots"))).toBe(false);
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("returns no-work when all eligible snapshots already exist", async () => {
    const workspace = makeTempWorkspace();
    const migrationsDir = path.join(workspace, "migrations");
    const implementationDir = path.join(workspace, "implementation");
    fs.mkdirSync(migrationsDir, { recursive: true });
    fs.mkdirSync(path.join(implementationDir, "snapshots", "root", "1"), { recursive: true });

    fs.writeFileSync(path.join(migrationsDir, "1. Root Done.md"), "# 1. Root Done\n\n- [x] done\n", "utf-8");
    fs.writeFileSync(path.join(implementationDir, "file.txt"), "head\n", "utf-8");
    fs.writeFileSync(path.join(implementationDir, "snapshots", "root", "1", "kept.txt"), "kept\n", "utf-8");

    const snapshotTask = createSnapshotTask({
      fileSystem: createNodeFileSystem(),
      output: { emit: () => undefined },
    });

    const previousCwd = process.cwd();
    process.chdir(workspace);
    try {
      const code = await snapshotTask({});
      expect(code).toBe(EXIT_CODE_NO_WORK);
      expect(fs.readFileSync(path.join(implementationDir, "snapshots", "root", "1", "kept.txt"), "utf-8")).toBe("kept\n");
    } finally {
      process.chdir(previousCwd);
    }
  });
});

function makeTempWorkspace(): string {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "rundown-snapshot-task-"));
  tempDirs.push(workspace);
  fs.mkdirSync(path.join(workspace, ".rundown"), { recursive: true });
  return workspace;
}
