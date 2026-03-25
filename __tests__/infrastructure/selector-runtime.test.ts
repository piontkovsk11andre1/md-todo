import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { selectNextTask, selectTaskByLocation } from "../../src/infrastructure/selector.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("infrastructure selector", () => {
  it("supports old-first sorting when multiple files are provided", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rundown-selector-"));
    tempDirs.push(root);

    const a = path.join(root, "a.md");
    const b = path.join(root, "b.md");

    fs.writeFileSync(a, "- [ ] Task A\n", "utf-8");
    fs.writeFileSync(b, "- [ ] Task B\n", "utf-8");

    const result = selectNextTask([a, b], "old-first");

    expect(result).not.toBeNull();
    expect(["Task A", "Task B"]).toContain(result?.task.text);
  });

  it("selects first runnable task from sorted files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rundown-selector-"));
    tempDirs.push(root);

    const first = path.join(root, "1-first.md");
    const second = path.join(root, "2-second.md");

    fs.writeFileSync(first, "- [ ] Parent\n  - [ ] Child\n", "utf-8");
    fs.writeFileSync(second, "- [ ] Later task\n", "utf-8");

    const result = selectNextTask([second, first], "name-sort");

    expect(result).not.toBeNull();
    expect(result?.task.text).toBe("Child");
    expect(result?.task.file).toBe(first);
    expect(result?.contextBefore).toBe("- [ ] Parent");
  });

  it("returns null when no runnable tasks exist", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rundown-selector-"));
    tempDirs.push(root);

    const only = path.join(root, "tasks.md");
    fs.writeFileSync(only, "- [x] Done\n", "utf-8");

    expect(selectNextTask([only], "old-first")).toBeNull();
  });

  it("selects task by file and line", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rundown-selector-"));
    tempDirs.push(root);

    const file = path.join(root, "tasks.md");
    fs.writeFileSync(file, "# Tasks\n- [ ] Build\n- [ ] Ship\n", "utf-8");

    const selected = selectTaskByLocation(file, 3);

    expect(selected).not.toBeNull();
    expect(selected?.task.text).toBe("Ship");
    expect(selected?.contextBefore).toBe("# Tasks\n- [ ] Build");
  });

  it("returns null when line has no task", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rundown-selector-"));
    tempDirs.push(root);

    const file = path.join(root, "tasks.md");
    fs.writeFileSync(file, "# Tasks\n- [ ] Build\n", "utf-8");

    expect(selectTaskByLocation(file, 1)).toBeNull();
  });
});
