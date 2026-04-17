import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createAddCommandAction, createMakeCommandAction } from "../../../src/presentation/cli-command-actions.js";
import type { CliApp } from "../../../src/presentation/cli-app-init.js";

type CliOpts = Record<string, string | string[] | boolean>;

describe("createMakeCommandAction", () => {
  it("runs research and plan by default", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rundown-make-default-"));
    const targetFile = path.join(tempRoot, "migrations", "seed.md");
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });

    const researchTask = vi.fn(async () => 0);
    const planTask = vi.fn(async () => 0);
    const app = { researchTask, planTask } as unknown as CliApp;
    const action = createMakeCommandAction({
      getApp: () => app,
      getWorkerFromSeparator: () => undefined,
      makeModes: ["wait"],
    });

    try {
      const exitCode = await action("seed", targetFile, {});

      expect(exitCode).toBe(0);
      expect(researchTask).toHaveBeenCalledTimes(1);
      expect(planTask).toHaveBeenCalledTimes(1);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("forwards --skip-research as normalized skip mode and bypasses research", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rundown-make-skip-research-"));
    const targetFile = path.join(tempRoot, "migrations", "seed.md");
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });

    const researchTask = vi.fn(async () => 0);
    const planTask = vi.fn(async () => 0);
    const app = { researchTask, planTask } as unknown as CliApp;
    const action = createMakeCommandAction({
      getApp: () => app,
      getWorkerFromSeparator: () => undefined,
      makeModes: ["wait"],
    });

    try {
      const exitCode = await action("seed", targetFile, { skipResearch: true });

      expect(exitCode).toBe(0);
      expect(researchTask).not.toHaveBeenCalled();
      expect(planTask).toHaveBeenCalledTimes(1);
      expect(planTask).toHaveBeenCalledWith(expect.objectContaining({
        source: targetFile,
      }));
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("normalizes --raw alias to the same skip mode and bypasses research", async () => {
    const scenarios: Array<{ label: string; opts: CliOpts }> = [
      { label: "raw alias", opts: { raw: true } },
      { label: "both flags", opts: { raw: true, skipResearch: true } },
    ];

    for (const scenario of scenarios) {
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `rundown-make-raw-${scenario.label.replace(/\s+/g, "-")}-`));
      const targetFile = path.join(tempRoot, "migrations", "seed.md");
      fs.mkdirSync(path.dirname(targetFile), { recursive: true });

      const researchTask = vi.fn(async () => 0);
      const planTask = vi.fn(async () => 0);
      const app = { researchTask, planTask } as unknown as CliApp;
      const action = createMakeCommandAction({
        getApp: () => app,
        getWorkerFromSeparator: () => undefined,
        makeModes: ["wait"],
      });

      try {
        const exitCode = await action("seed", targetFile, scenario.opts);

        expect(exitCode).toBe(0);
        expect(researchTask).not.toHaveBeenCalled();
        expect(planTask).toHaveBeenCalledTimes(1);
      } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });
});

describe("createAddCommandAction", () => {
  it("appends seed text with a blank-line boundary, then runs plan", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rundown-add-default-"));
    const targetFile = path.join(tempRoot, "migrations", "target.md");
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.writeFileSync(targetFile, "# Existing\nCurrent content", "utf8");

    const planTask = vi.fn(async () => 0);
    const app = { planTask } as unknown as CliApp;
    const action = createAddCommandAction({
      getApp: () => app,
      getWorkerFromSeparator: () => undefined,
      addModes: ["wait"],
    });

    try {
      const exitCode = await action("## New section", targetFile, {});

      expect(exitCode).toBe(0);
      expect(planTask).toHaveBeenCalledTimes(1);
      expect(planTask).toHaveBeenCalledWith(expect.objectContaining({
        source: targetFile,
        mode: "wait",
        deep: 0,
      }));
      expect(fs.readFileSync(targetFile, "utf8")).toBe("# Existing\nCurrent content\n\n## New section");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps exactly one blank-line separator when file already ends with one", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rundown-add-separator-"));
    const targetFile = path.join(tempRoot, "migrations", "target.md");
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.writeFileSync(targetFile, "# Existing\n\n", "utf8");

    const planTask = vi.fn(async () => 0);
    const app = { planTask } as unknown as CliApp;
    const action = createAddCommandAction({
      getApp: () => app,
      getWorkerFromSeparator: () => undefined,
      addModes: ["wait"],
    });

    try {
      await action("Seed text", targetFile, {});

      expect(fs.readFileSync(targetFile, "utf8")).toBe("# Existing\n\nSeed text");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("forwards worker and runtime options to planTask", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rundown-add-forwarding-"));
    const targetFile = path.join(tempRoot, "migrations", "target.md");
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.writeFileSync(targetFile, "# Existing", "utf8");

    const planTask = vi.fn(async () => 0);
    const app = { planTask } as unknown as CliApp;
    const action = createAddCommandAction({
      getApp: () => app,
      getWorkerFromSeparator: () => ["opencode", "run", "--model", "gpt-5"],
      addModes: ["wait"],
    });

    try {
      const exitCode = await action("Seed text", targetFile, {
        mode: "wait",
        scanCount: "2",
        maxItems: "7",
        deep: "3",
        dryRun: true,
        printPrompt: true,
        keepArtifacts: true,
        showAgentOutput: true,
        trace: true,
        forceUnlock: true,
        varsFile: "vars.json",
        var: ["env=prod", "owner=ops"],
        ignoreCliBlock: true,
        cliBlockTimeout: "1234",
        verbose: true,
      });

      expect(exitCode).toBe(0);
      expect(planTask).toHaveBeenCalledTimes(1);
      expect(planTask).toHaveBeenCalledWith(expect.objectContaining({
        source: targetFile,
        mode: "wait",
        scanCount: 2,
        maxItems: 7,
        deep: 3,
        dryRun: true,
        printPrompt: true,
        keepArtifacts: true,
        showAgentOutput: true,
        trace: true,
        forceUnlock: true,
        varsFileOption: "vars.json",
        cliTemplateVarArgs: ["env=prod", "owner=ops"],
        ignoreCliBlock: true,
        cliBlockTimeoutMs: 1234,
        verbose: true,
        workerPattern: {
          command: ["opencode", "run", "--model", "gpt-5"],
          usesBootstrap: false,
          usesFile: false,
          appendFile: true,
        },
      }));
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects unsupported add mode values", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rundown-add-mode-"));
    const targetFile = path.join(tempRoot, "migrations", "target.md");
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.writeFileSync(targetFile, "# Existing", "utf8");

    const planTask = vi.fn(async () => 0);
    const app = { planTask } as unknown as CliApp;
    const action = createAddCommandAction({
      getApp: () => app,
      getWorkerFromSeparator: () => undefined,
      addModes: ["wait"],
    });

    try {
      await expect(action("Seed text", targetFile, { mode: "tui" })).rejects.toThrow(
        "Invalid --mode value: tui. Allowed: wait.",
      );
      expect(planTask).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects invalid add target paths", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rundown-add-paths-"));
    const existingDirWithMdName = path.join(tempRoot, "directory.md");
    fs.mkdirSync(existingDirWithMdName, { recursive: true });

    const planTask = vi.fn(async () => 0);
    const app = { planTask } as unknown as CliApp;
    const action = createAddCommandAction({
      getApp: () => app,
      getWorkerFromSeparator: () => undefined,
      addModes: ["wait"],
    });

    try {
      await expect(action("Seed text", path.join(tempRoot, "missing.md"), {})).rejects.toThrow(
        "Invalid add document path: "
          + path.join(tempRoot, "missing.md")
          + ". The `add` command requires exactly one existing Markdown file; the provided path does not exist.",
      );

      await expect(action("Seed text", existingDirWithMdName, {})).rejects.toThrow(
        "Invalid add document path: "
          + existingDirWithMdName
          + ". The `add` command requires exactly one existing Markdown file and does not accept directory or glob inputs.",
      );

      await expect(action("Seed text", "*.md", {})).rejects.toThrow(
        "Invalid add document path: *.md. The `add` command requires exactly one existing Markdown file and does not accept directory or glob inputs.",
      );

      await expect(action("Seed text", path.join(tempRoot, "notes.txt"), {})).rejects.toThrow(
        "Invalid add document path: "
          + path.join(tempRoot, "notes.txt")
          + ". The `add` command only accepts Markdown files (.md or .markdown).",
      );

      expect(planTask).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("returns plan failure code and preserves appended content", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rundown-add-plan-failure-"));
    const targetFile = path.join(tempRoot, "migrations", "target.md");
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.writeFileSync(targetFile, "# Existing", "utf8");

    const planTask = vi.fn(async () => 7);
    const app = { planTask } as unknown as CliApp;
    const action = createAddCommandAction({
      getApp: () => app,
      getWorkerFromSeparator: () => undefined,
      addModes: ["wait"],
    });

    try {
      const exitCode = await action("Seed text", targetFile, {});

      expect(exitCode).toBe(7);
      expect(planTask).toHaveBeenCalledTimes(1);
      expect(fs.readFileSync(targetFile, "utf8")).toBe("# Existing\n\nSeed text");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("fails before plan when append operation errors", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rundown-add-append-failure-"));
    const targetFile = path.join(tempRoot, "migrations", "target.md");
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.writeFileSync(targetFile, "# Existing", "utf8");

    const planTask = vi.fn(async () => 0);
    const app = { planTask } as unknown as CliApp;
    const action = createAddCommandAction({
      getApp: () => app,
      getWorkerFromSeparator: () => undefined,
      addModes: ["wait"],
    });

    const appendError = new Error("Path is directory") as NodeJS.ErrnoException;
    appendError.code = "EISDIR";
    const appendSpy = vi.spyOn(fs, "appendFileSync").mockImplementation(() => {
      throw appendError;
    });

    try {
      await expect(action("Seed text", targetFile, {})).rejects.toThrow(
        `Cannot append add document: ${targetFile}. Path is a directory.`,
      );
      expect(planTask).not.toHaveBeenCalled();
    } finally {
      appendSpy.mockRestore();
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
