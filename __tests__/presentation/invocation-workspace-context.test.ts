import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveInvocationWorkspaceContext } from "../../src/presentation/invocation-workspace-context.js";

describe("resolveInvocationWorkspaceContext", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const tempDir = tempDirs.pop();
      if (tempDir) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });

  it("returns linked workspace context when workspace.link resolves", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rundown-invocation-workspace-"));
    tempDirs.push(root);

    const invocationDir = path.join(root, "linked");
    const workspaceDir = path.join(root, "source");
    fs.mkdirSync(path.join(invocationDir, ".rundown"), { recursive: true });
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(
      path.join(invocationDir, ".rundown", "workspace.link"),
      path.relative(invocationDir, workspaceDir).replace(/\\/g, "/"),
      "utf-8",
    );

    const context = resolveInvocationWorkspaceContext(invocationDir);

    expect(context).toEqual({
      invocationDir: path.resolve(invocationDir),
      workspaceDir: path.resolve(workspaceDir),
      workspaceLinkPath: path.join(path.resolve(invocationDir), ".rundown", "workspace.link"),
      isLinkedWorkspace: true,
    });
  });

  it("falls back to invocation dir for invalid or absent links", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rundown-invocation-workspace-"));
    tempDirs.push(root);

    const invocationDir = path.join(root, "plain");
    fs.mkdirSync(path.join(invocationDir, ".rundown"), { recursive: true });
    fs.writeFileSync(path.join(invocationDir, ".rundown", "workspace.link"), "../missing", "utf-8");

    const context = resolveInvocationWorkspaceContext(invocationDir);

    expect(context).toEqual({
      invocationDir: path.resolve(invocationDir),
      workspaceDir: path.resolve(invocationDir),
      workspaceLinkPath: "",
      isLinkedWorkspace: false,
    });
  });
});
