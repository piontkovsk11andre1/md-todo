import { beforeEach, afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  discoverCustomTools,
  resolveToolDirectories,
} from "../../../src/presentation/tui/scenes/tools.js";

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("tools scene custom tool discovery", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = makeTempDir("tools-scene-");
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("defaults to <config-dir>/tools when toolDirs is missing", () => {
    const configDir = path.join(workspaceRoot, ".rundown");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "config.json"), JSON.stringify({}));

    const directories = resolveToolDirectories(configDir);
    expect(directories).toEqual([path.join(configDir, "tools")]);
  });

  it("resolves relative entries against config dir and preserves listed order", () => {
    const configDir = path.join(workspaceRoot, ".rundown");
    fs.mkdirSync(configDir, { recursive: true });
    const config = { toolDirs: ["tools", "shared-tools"] };

    const directories = resolveToolDirectories(configDir, config);
    expect(directories).toEqual([
      path.join(configDir, "tools"),
      path.join(configDir, "shared-tools"),
    ]);
  });

  it("keeps absolute entries verbatim", () => {
    const configDir = path.join(workspaceRoot, ".rundown");
    fs.mkdirSync(configDir, { recursive: true });
    const absolute = path.join(workspaceRoot, "absolute-tools");
    const directories = resolveToolDirectories(configDir, { toolDirs: [absolute, "relative"] });
    expect(directories[0]).toBe(absolute);
    expect(directories[1]).toBe(path.join(configDir, "relative"));
  });

  it("returns no entries when no tool directories exist", () => {
    const configDir = path.join(workspaceRoot, ".rundown");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "config.json"), JSON.stringify({}));

    const result = discoverCustomTools({ configDirPath: configDir });
    expect(result.entries).toEqual([]);
    expect(result.directories).toEqual([path.join(configDir, "tools")]);
  });

  it("scans .md and .js files and derives names from basename without extension", () => {
    const configDir = path.join(workspaceRoot, ".rundown");
    const toolsDir = path.join(configDir, "tools");
    fs.mkdirSync(toolsDir, { recursive: true });
    fs.writeFileSync(path.join(toolsDir, "summarize.md"), "summary template");
    fs.writeFileSync(path.join(toolsDir, "triage-issue.js"), "module.exports = {}\n");
    fs.writeFileSync(path.join(toolsDir, "ignored.txt"), "nope");
    fs.writeFileSync(path.join(configDir, "config.json"), JSON.stringify({ toolDirs: ["tools"] }));

    const result = discoverCustomTools({ configDirPath: configDir });
    const byName = result.entries.map((entry) => ({
      name: entry.name,
      extension: entry.extension,
      filePath: entry.filePath,
    }));
    expect(byName).toEqual([
      {
        name: "summarize",
        extension: ".md",
        filePath: path.join(toolsDir, "summarize.md"),
      },
      {
        name: "triage-issue",
        extension: ".js",
        filePath: path.join(toolsDir, "triage-issue.js"),
      },
    ]);
  });

  it("preserves directory order so first directory wins later precedence step", () => {
    const configDir = path.join(workspaceRoot, ".rundown");
    const primary = path.join(configDir, "tools");
    const secondary = path.join(configDir, "shared-tools");
    fs.mkdirSync(primary, { recursive: true });
    fs.mkdirSync(secondary, { recursive: true });
    fs.writeFileSync(path.join(primary, "post-on-gitea.md"), "primary");
    fs.writeFileSync(path.join(secondary, "post-on-gitea.md"), "secondary");
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({ toolDirs: ["tools", "shared-tools"] }),
    );

    const result = discoverCustomTools({ configDirPath: configDir });
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].directory).toBe(primary);
    expect(result.entries[1].directory).toBe(secondary);
  });

  it("ignores directories that do not exist without throwing", () => {
    const configDir = path.join(workspaceRoot, ".rundown");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({ toolDirs: ["does-not-exist"] }),
    );

    const result = discoverCustomTools({ configDirPath: configDir });
    expect(result.entries).toEqual([]);
    expect(result.directories).toEqual([path.join(configDir, "does-not-exist")]);
  });
});
