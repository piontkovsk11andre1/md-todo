import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createNodeFileSystem } from "../../src/infrastructure/adapters/fs-file-system.js";
import { createNodePathOperationsAdapter } from "../../src/infrastructure/adapters/node-path-operations-adapter.js";
import {
  resolveWorkspaceLink,
  WORKSPACE_LINK_RELATIVE_PATH,
} from "../../src/domain/workspace-link.js";

describe("resolveWorkspaceLink", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("resolves a valid relative workspace link from current directory", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rundown-workspace-link-"));
    tempDirs.push(tempDir);

    const sourceWorkspaceRoot = path.join(tempDir, "source-root");
    const linkedInvocationDir = path.join(tempDir, "linked", "project");
    const linkedConfigDir = path.join(linkedInvocationDir, ".rundown");
    fs.mkdirSync(sourceWorkspaceRoot, { recursive: true });
    fs.mkdirSync(linkedConfigDir, { recursive: true });

    const relativeTarget = path.relative(linkedInvocationDir, sourceWorkspaceRoot).replace(/\\/g, "/");
    fs.writeFileSync(path.join(linkedConfigDir, "workspace.link"), relativeTarget, "utf-8");

    const result = resolveWorkspaceLink({
      currentDir: linkedInvocationDir,
      fileSystem: createNodeFileSystem(),
      pathOperations: createNodePathOperationsAdapter(),
    });

    expect(result).toEqual({
      status: "resolved",
      linkPath: path.join(linkedInvocationDir, WORKSPACE_LINK_RELATIVE_PATH),
      relativeTarget,
      workspaceRoot: sourceWorkspaceRoot,
    });
  });

  it("returns absent when workspace link file does not exist", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rundown-workspace-link-"));
    tempDirs.push(tempDir);

    const invocationDir = path.join(tempDir, "project");
    fs.mkdirSync(path.join(invocationDir, ".rundown"), { recursive: true });

    const result = resolveWorkspaceLink({
      currentDir: invocationDir,
      fileSystem: createNodeFileSystem(),
      pathOperations: createNodePathOperationsAdapter(),
    });

    expect(result).toEqual({
      status: "absent",
      linkPath: path.join(invocationDir, WORKSPACE_LINK_RELATIVE_PATH),
    });
  });

  it("returns invalid when workspace link target does not exist", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rundown-workspace-link-"));
    tempDirs.push(tempDir);

    const invocationDir = path.join(tempDir, "project");
    const configDir = path.join(invocationDir, ".rundown");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "workspace.link"), "../missing-root", "utf-8");

    const result = resolveWorkspaceLink({
      currentDir: invocationDir,
      fileSystem: createNodeFileSystem(),
      pathOperations: createNodePathOperationsAdapter(),
    });

    expect(result).toEqual({
      status: "invalid",
      linkPath: path.join(invocationDir, WORKSPACE_LINK_RELATIVE_PATH),
      relativeTarget: "../missing-root",
      reason: "target-missing",
    });
  });

  it("returns invalid when workspace link target is not a directory", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rundown-workspace-link-"));
    tempDirs.push(tempDir);

    const invocationDir = path.join(tempDir, "project");
    const configDir = path.join(invocationDir, ".rundown");
    const staleTargetFile = path.join(tempDir, "stale-root.txt");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(staleTargetFile, "stale", "utf-8");

    const relativeTarget = path.relative(invocationDir, staleTargetFile).replace(/\\/g, "/");
    fs.writeFileSync(path.join(configDir, "workspace.link"), relativeTarget, "utf-8");

    const result = resolveWorkspaceLink({
      currentDir: invocationDir,
      fileSystem: createNodeFileSystem(),
      pathOperations: createNodePathOperationsAdapter(),
    });

    expect(result).toEqual({
      status: "invalid",
      linkPath: path.join(invocationDir, WORKSPACE_LINK_RELATIVE_PATH),
      relativeTarget,
      reason: "target-not-directory",
    });
  });
});
