import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Task } from "../../src/domain/parser.js";

import {
  createRunTaskExecution,
  getAutomationWorkerCommand,
  isOpenCodeWorkerCommand,
  toRuntimeTaskMetadata,
} from "../../src/application/run-task-execution.js";
import {
  createDependencies,
  createGitClientMock,
  createInMemoryFileSystem,
  createInlineTask,
  createOptions,
  createTask,
} from "./run-task-test-helpers.js";

describe("run-task-execution helpers", () => {
  it("normalizes opencode tui worker commands", () => {
    expect(getAutomationWorkerCommand(["opencode"], "tui")).toEqual(["opencode", "run"]);
    expect(getAutomationWorkerCommand(["opencode", "run"], "tui")).toEqual(["opencode", "run"]);
    expect(getAutomationWorkerCommand(["agent"], "tui")).toEqual(["agent"]);
    expect(getAutomationWorkerCommand(["opencode"], "wait")).toEqual(["opencode"]);
  });

  it("detects supported opencode executable names", () => {
    expect(isOpenCodeWorkerCommand([])).toBe(false);
    expect(isOpenCodeWorkerCommand(["opencode"])).toBe(true);
    expect(isOpenCodeWorkerCommand([String.raw`C:\tools\opencode.cmd`])).toBe(true);
    expect(isOpenCodeWorkerCommand(["/usr/local/bin/opencode.exe"])).toBe(true);
    expect(isOpenCodeWorkerCommand(["node"])).toBe(false);
  });

  it("maps a task into runtime metadata", () => {
    const task: Task = {
      text: "cli: echo hello",
      checked: false,
      index: 0,
      line: 1,
      column: 1,
      offsetStart: 0,
      offsetEnd: 17,
      file: "/workspace/tasks.md",
      isInlineCli: true,
      depth: 0,
      children: [],
      subItems: [],
    };

    expect(toRuntimeTaskMetadata(task, "tasks.md")).toEqual({
      text: "cli: echo hello",
      file: "/workspace/tasks.md",
      line: 1,
      index: 0,
      source: "tasks.md",
    });
  });

  it("builds RUNDOWN_VAR_* env from merged vars and threads it to cli blocks and workers", async () => {
    const cwd = "/workspace";
    const taskFile = `${cwd}/tasks.md`;
    const cliBlockExecutor = {
      execute: vi.fn(async () => ({
        exitCode: 0,
        stdout: "ok",
        stderr: "",
      })),
    };
    const { dependencies } = createDependencies({
      cwd,
      task: createTask(taskFile, "build release"),
      fileSystem: createInMemoryFileSystem({ [taskFile]: "- [ ] build release\n" }),
      gitClient: createGitClientMock(),
      cliBlockExecutor,
    });
    dependencies.templateVarsLoader.load = () => ({
      api_token: "from-file",
      channel: "stable",
    });
    dependencies.templateLoader.load = (templatePath: string) => {
      if (templatePath.endsWith("execute.md")) {
        return "```cli\necho from-template\n```";
      }
      return null;
    };

    const runTask = createRunTaskExecution(dependencies);
    const code = await runTask(createOptions({
      verify: false,
      varsFileOption: ".rundown/vars.json",
      cliTemplateVarArgs: ["api_token=from-cli", "db_Host=localhost"],
      workerCommand: ["opencode", "run"],
    }));

    expect(code).toBe(0);
    expect(dependencies.cliBlockExecutor?.execute).toHaveBeenCalledWith(
      "echo from-template",
      cwd,
      expect.objectContaining({
        env: {
          RUNDOWN_VAR_API_TOKEN: "from-cli",
          RUNDOWN_VAR_CHANNEL: "stable",
          RUNDOWN_VAR_DB_HOST: "localhost",
        },
      }),
    );
    expect(dependencies.workerExecutor.runWorker).toHaveBeenCalledWith(expect.objectContaining({
      env: {
        RUNDOWN_VAR_API_TOKEN: "from-cli",
        RUNDOWN_VAR_CHANNEL: "stable",
        RUNDOWN_VAR_DB_HOST: "localhost",
      },
    }));
  });

  it("threads merged RUNDOWN_VAR_* env to inline cli execution", async () => {
    const cwd = "/workspace";
    const taskFile = `${cwd}/tasks.md`;
    const { dependencies } = createDependencies({
      cwd,
      task: createInlineTask(taskFile, "cli: echo hello"),
      fileSystem: createInMemoryFileSystem({ [taskFile]: "- [ ] cli: echo hello\n" }),
      gitClient: createGitClientMock(),
    });
    dependencies.templateVarsLoader.load = () => ({ region: "us-east" });

    const runTask = createRunTaskExecution(dependencies);
    const code = await runTask(createOptions({
      verify: false,
      varsFileOption: ".rundown/vars.json",
      cliTemplateVarArgs: ["region=eu-west", "release=v1"],
    }));

    expect(code).toBe(0);
    const expectedInlineCwd = path.dirname(path.resolve(taskFile));
    expect(dependencies.workerExecutor.executeInlineCli).toHaveBeenCalledWith(
      "echo hello",
      expectedInlineCwd,
      expect.objectContaining({
        env: {
          RUNDOWN_VAR_REGION: "eu-west",
          RUNDOWN_VAR_RELEASE: "v1",
        },
      }),
    );
  });
});
