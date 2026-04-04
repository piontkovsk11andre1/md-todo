import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createNodeFileSystem } from "../../../src/infrastructure/adapters/fs-file-system.js";
import { createNodePathOperationsAdapter } from "../../../src/infrastructure/adapters/node-path-operations-adapter.js";
import { createToolResolverAdapter } from "../../../src/infrastructure/adapters/tool-resolver-adapter.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rundown-tool-resolver-"));
  tempDirs.push(dir);
  return dir;
}

describe("createToolResolverAdapter", () => {
  it("returns undefined when config directory is unavailable", () => {
    const resolver = createToolResolverAdapter({
      configDir: undefined,
      fileSystem: createNodeFileSystem(),
      pathOperations: createNodePathOperationsAdapter(),
    });

    expect(resolver.resolve("post-on-gitea")).toBeUndefined();
  });

  it("resolves and loads a matching tool template from .rundown/tools", () => {
    const rootDir = makeTempDir();
    const configDir = path.join(rootDir, ".rundown");
    const toolsDir = path.join(configDir, "tools");
    const templatePath = path.join(toolsDir, "post-on-gitea.md");
    const templateBody = "You are a helper.\n\nRequest: {{payload}}\n";

    fs.mkdirSync(toolsDir, { recursive: true });
    fs.writeFileSync(templatePath, templateBody, "utf-8");

    const resolver = createToolResolverAdapter({
      configDir: {
        configDir,
        isExplicit: false,
      },
      fileSystem: createNodeFileSystem(),
      pathOperations: createNodePathOperationsAdapter(),
    });

    expect(resolver.resolve("post-on-gitea")).toEqual({
      name: "post-on-gitea",
      templatePath,
      template: templateBody,
    });
  });

  it("does not resolve unknown tool names", () => {
    const rootDir = makeTempDir();
    const configDir = path.join(rootDir, ".rundown");
    const toolsDir = path.join(configDir, "tools");

    fs.mkdirSync(toolsDir, { recursive: true });
    fs.writeFileSync(path.join(toolsDir, "summarize.md"), "Summarize task", "utf-8");

    const resolver = createToolResolverAdapter({
      configDir: {
        configDir,
        isExplicit: false,
      },
      fileSystem: createNodeFileSystem(),
      pathOperations: createNodePathOperationsAdapter(),
    });

    expect(resolver.resolve("post-on-gitea")).toBeUndefined();
  });

  it("returns undefined when tools directory cannot be read", () => {
    const resolver = createToolResolverAdapter({
      configDir: {
        configDir: path.join(makeTempDir(), ".rundown"),
        isExplicit: false,
      },
      fileSystem: {
        exists() {
          throw new Error("not implemented");
        },
        readText() {
          throw new Error("not implemented");
        },
        writeText() {
          throw new Error("not implemented");
        },
        mkdir() {
          throw new Error("not implemented");
        },
        readdir() {
          throw new Error("filesystem unavailable");
        },
        stat() {
          throw new Error("not implemented");
        },
        unlink() {
          throw new Error("not implemented");
        },
        rm() {
          throw new Error("not implemented");
        },
      },
      pathOperations: createNodePathOperationsAdapter(),
    });

    expect(resolver.resolve("post-on-gitea")).toBeUndefined();
  });

  it("returns undefined when template file exists but cannot be read", () => {
    const rootDir = makeTempDir();
    const configDir = path.join(rootDir, ".rundown");
    const toolsDir = path.join(configDir, "tools");
    const templatePath = path.join(toolsDir, "post-on-gitea.md");

    fs.mkdirSync(toolsDir, { recursive: true });
    fs.writeFileSync(templatePath, "Task template", "utf-8");

    const resolver = createToolResolverAdapter({
      configDir: {
        configDir,
        isExplicit: false,
      },
      fileSystem: {
        exists() {
          throw new Error("not implemented");
        },
        readText() {
          throw new Error("permission denied");
        },
        writeText() {
          throw new Error("not implemented");
        },
        mkdir() {
          throw new Error("not implemented");
        },
        readdir() {
          return [{
            name: "post-on-gitea.md",
            isFile: true,
            isDirectory: false,
          }];
        },
        stat() {
          throw new Error("not implemented");
        },
        unlink() {
          throw new Error("not implemented");
        },
        rm() {
          throw new Error("not implemented");
        },
      },
      pathOperations: createNodePathOperationsAdapter(),
    });

    expect(resolver.resolve("post-on-gitea")).toBeUndefined();
  });

  it("trims incoming tool name before resolution", () => {
    const rootDir = makeTempDir();
    const configDir = path.join(rootDir, ".rundown");
    const toolsDir = path.join(configDir, "tools");
    const templatePath = path.join(toolsDir, "post-on-gitea.md");
    const templateBody = "Return TODOs\n";

    fs.mkdirSync(toolsDir, { recursive: true });
    fs.writeFileSync(templatePath, templateBody, "utf-8");

    const resolver = createToolResolverAdapter({
      configDir: {
        configDir,
        isExplicit: false,
      },
      fileSystem: createNodeFileSystem(),
      pathOperations: createNodePathOperationsAdapter(),
    });

    expect(resolver.resolve("  post-on-gitea  ")).toEqual({
      name: "post-on-gitea",
      templatePath,
      template: templateBody,
    });
  });
});
