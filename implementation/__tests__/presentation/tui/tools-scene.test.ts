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

  it("marks duplicate tool names as shadowed and groups them under the winner", () => {
    const configDir = path.join(workspaceRoot, ".rundown");
    const primary = path.join(configDir, "tools");
    const secondary = path.join(configDir, "shared-tools");
    const tertiary = path.join(configDir, "extra-tools");
    fs.mkdirSync(primary, { recursive: true });
    fs.mkdirSync(secondary, { recursive: true });
    fs.mkdirSync(tertiary, { recursive: true });
    fs.writeFileSync(path.join(primary, "post-on-gitea.md"), "primary");
    fs.writeFileSync(path.join(primary, "summarize.md"), "summary");
    fs.writeFileSync(path.join(secondary, "post-on-gitea.md"), "secondary");
    fs.writeFileSync(path.join(tertiary, "post-on-gitea.md"), "tertiary");
    fs.writeFileSync(path.join(tertiary, "triage.js"), "module.exports = {}\n");
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({ toolDirs: ["tools", "shared-tools", "extra-tools"] }),
    );

    const result = discoverCustomTools({ configDirPath: configDir });

    // tools array contains only winners in discovery order
    expect(result.tools.map((tool: any) => ({ name: tool.name, directory: tool.directory }))).toEqual([
      { name: "post-on-gitea", directory: primary },
      { name: "summarize", directory: primary },
      { name: "triage", directory: tertiary },
    ]);

    const winner = result.tools.find((tool: any) => tool.name === "post-on-gitea");
    expect(winner).toBeDefined();
    expect(winner.shadowed).toBe(false);
    expect(winner.shadows).toHaveLength(2);
    expect(winner.shadows.map((entry: any) => entry.directory)).toEqual([secondary, tertiary]);
    for (const shadow of winner.shadows) {
      expect(shadow.shadowed).toBe(true);
      expect(shadow.shadowedBy.filePath).toBe(winner.filePath);
    }

    const summarize = result.tools.find((tool: any) => tool.name === "summarize");
    expect(summarize.shadows).toEqual([]);

    // flat entries still contains every discovered file in discovery order
    expect(result.entries.map((entry: any) => ({ name: entry.name, directory: entry.directory, shadowed: entry.shadowed }))).toEqual([
      { name: "post-on-gitea", directory: primary, shadowed: false },
      { name: "summarize", directory: primary, shadowed: false },
      { name: "post-on-gitea", directory: secondary, shadowed: true },
      { name: "post-on-gitea", directory: tertiary, shadowed: true },
      { name: "triage", directory: tertiary, shadowed: false },
    ]);
  });

  it("annotates winning tools with commands.tools.<name> worker override summary", () => {
    const configDir = path.join(workspaceRoot, ".rundown");
    const toolsDir = path.join(configDir, "tools");
    fs.mkdirSync(toolsDir, { recursive: true });
    fs.writeFileSync(path.join(toolsDir, "post-on-gitea.md"), "primary");
    fs.writeFileSync(path.join(toolsDir, "summarize.md"), "summary");
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({
        toolDirs: ["tools"],
        commands: {
          tools: {
            "post-on-gitea": ["opencode", "run", "--model", "gpt-5.3-mini", "--no-approval"],
          },
        },
      }),
    );

    const result = discoverCustomTools({ configDirPath: configDir });

    const winner = result.tools.find((tool: any) => tool.name === "post-on-gitea");
    expect(winner).toBeDefined();
    expect(winner.override).toBeDefined();
    expect(winner.override.key).toBe("commands.tools.post-on-gitea");
    expect(winner.override.configuredName).toBe("post-on-gitea");
    expect(winner.override.worker).toEqual([
      "opencode",
      "run",
      "--model",
      "gpt-5.3-mini",
      "--no-approval",
    ]);
    expect(winner.override.workerSummary).toBe(
      "opencode run --model gpt-5.3-mini --no-approval",
    );
    expect(winner.override.description).toBe(
      "commands.tools.post-on-gitea overrides worker for this prefix",
    );

    const summarize = result.tools.find((tool: any) => tool.name === "summarize");
    expect(summarize).toBeDefined();
    expect(summarize.override).toBeUndefined();
  });

  it("annotates override even when worker tokens are empty", () => {
    const configDir = path.join(workspaceRoot, ".rundown");
    const toolsDir = path.join(configDir, "tools");
    fs.mkdirSync(toolsDir, { recursive: true });
    fs.writeFileSync(path.join(toolsDir, "triage.md"), "triage");
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({
        toolDirs: ["tools"],
        commands: { tools: { triage: [] } },
      }),
    );

    const result = discoverCustomTools({ configDirPath: configDir });
    const winner = result.tools.find((tool: any) => tool.name === "triage");
    expect(winner.override).toBeDefined();
    expect(winner.override.worker).toEqual([]);
    expect(winner.override.workerSummary).toBe("");
    expect(winner.override.description).toBe(
      "commands.tools.triage overrides worker for this prefix",
    );
  });

  it("matches override key case-insensitively against discovered tool names", () => {
    const configDir = path.join(workspaceRoot, ".rundown");
    const toolsDir = path.join(configDir, "tools");
    fs.mkdirSync(toolsDir, { recursive: true });
    fs.writeFileSync(path.join(toolsDir, "Summarize.md"), "summary");
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({
        toolDirs: ["tools"],
        commands: { tools: { Summarize: ["opencode"] } },
      }),
    );

    const result = discoverCustomTools({ configDirPath: configDir });
    const winner = result.tools.find((tool: any) => tool.name === "summarize");
    expect(winner).toBeDefined();
    expect(winner.override).toBeDefined();
    expect(winner.override.configuredName).toBe("Summarize");
    expect(winner.override.key).toBe("commands.tools.Summarize");
  });
});
