import { describe, expect, it, vi } from "vitest";
import { createListTasks, type ListTasksDependencies, type ListTasksOptions } from "../../src/application/list-tasks.js";
import type { ApplicationOutputEvent, FileSystem } from "../../src/domain/ports/index.js";

describe("list-tasks", () => {
  it("returns 3 when no markdown files match source", async () => {
    const { dependencies, events } = createDependencies({ files: [], fileContentByPath: {} });

    const listTasks = createListTasks(dependencies);
    const code = await listTasks(createOptions());

    expect(code).toBe(3);
    expect(events.some((event) => event.kind === "warn" && event.message.includes("No Markdown files found"))).toBe(true);
  });

  it("emits unchecked tasks and computes blocked state", async () => {
    const markdown = [
      "- [ ] Parent task",
      "  - [ ] Child task",
      "- [x] Done task",
      "",
    ].join("\n");
    const { dependencies, events } = createDependencies({
      files: ["tasks.md"],
      fileContentByPath: { "tasks.md": markdown },
    });

    const listTasks = createListTasks(dependencies);
    const code = await listTasks(createOptions({ includeAll: false }));

    expect(code).toBe(0);
    const taskEvents = events.filter((event): event is Extract<ApplicationOutputEvent, { kind: "task" }> => event.kind === "task");
    expect(taskEvents).toHaveLength(2);
    expect(taskEvents[0]?.task.text).toBe("Parent task");
    expect(taskEvents[0]?.blocked).toBe(true);
    expect(taskEvents[1]?.task.text).toBe("Child task");
    expect(taskEvents[1]?.blocked).toBe(false);
  });

  it("includes checked tasks when includeAll is enabled", async () => {
    const markdown = [
      "- [ ] Todo task",
      "- [x] Done task",
      "",
    ].join("\n");
    const { dependencies, events } = createDependencies({
      files: ["tasks.md"],
      fileContentByPath: { "tasks.md": markdown },
    });

    const listTasks = createListTasks(dependencies);
    const code = await listTasks(createOptions({ includeAll: true }));

    expect(code).toBe(0);
    const taskEvents = events.filter((event): event is Extract<ApplicationOutputEvent, { kind: "task" }> => event.kind === "task");
    expect(taskEvents).toHaveLength(2);
    expect(taskEvents[1]?.task.checked).toBe(true);
  });

  it("emits no tasks found when parsed result is empty", async () => {
    const { dependencies, events } = createDependencies({
      files: ["notes.md"],
      fileContentByPath: { "notes.md": "# Notes\nNo tasks here." },
    });

    const listTasks = createListTasks(dependencies);
    const code = await listTasks(createOptions());

    expect(code).toBe(0);
    expect(events.some((event) => event.kind === "info" && event.message === "No tasks found.")).toBe(true);
  });

  it("uses mtime when birthtime is unavailable for created sorting", async () => {
    const { dependencies, sourceResolver, fileSystem } = createDependencies({
      files: ["b.md", "a.md"],
      fileContentByPath: {
        "a.md": "- [ ] A\n",
        "b.md": "- [ ] B\n",
      },
      statsByPath: {
        "a.md": { isFile: true, isDirectory: false, birthtimeMs: Number.NaN, mtimeMs: 10 },
        "b.md": { isFile: true, isDirectory: false, birthtimeMs: Number.NaN, mtimeMs: 20 },
      },
    });

    const listTasks = createListTasks(dependencies);
    const code = await listTasks(createOptions({ sortMode: "old-first" }));

    expect(code).toBe(0);
    expect(vi.mocked(sourceResolver.resolveSources)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fileSystem.stat)).toHaveBeenCalledWith("a.md");
    expect(vi.mocked(fileSystem.stat)).toHaveBeenCalledWith("b.md");
  });
});

function createDependencies(options: {
  files: string[];
  fileContentByPath: Record<string, string>;
  statsByPath?: Record<string, { isFile: boolean; isDirectory: boolean; birthtimeMs: number; mtimeMs: number } | null>;
}): {
  dependencies: ListTasksDependencies;
  events: ApplicationOutputEvent[];
  sourceResolver: ListTasksDependencies["sourceResolver"];
  fileSystem: FileSystem;
} {
  const events: ApplicationOutputEvent[] = [];

  const sourceResolver: ListTasksDependencies["sourceResolver"] = {
    resolveSources: vi.fn(async () => options.files),
  };

  const fileSystem: FileSystem = {
    exists: vi.fn(() => true),
    readText: vi.fn((filePath: string) => options.fileContentByPath[filePath] ?? ""),
    writeText: vi.fn(),
    mkdir: vi.fn(),
    readdir: vi.fn(() => []),
    stat: vi.fn((filePath: string) => {
      if (options.statsByPath) {
        return options.statsByPath[filePath] ?? null;
      }

      return { isFile: true, isDirectory: false, birthtimeMs: 0, mtimeMs: 0 };
    }),
    unlink: vi.fn(),
    rm: vi.fn(),
  };

  const dependencies: ListTasksDependencies = {
    fileSystem,
    sourceResolver,
    output: {
      emit: (event) => events.push(event),
    },
  };

  return {
    dependencies,
    events,
    sourceResolver,
    fileSystem,
  };
}

function createOptions(overrides: Partial<ListTasksOptions> = {}): ListTasksOptions {
  return {
    source: "*.md",
    sortMode: "none",
    includeAll: false,
    ...overrides,
  };
}
