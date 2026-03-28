import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileSystem } from "../../../src/domain/ports/file-system.js";
import { createGlobalOutputLogWriter } from "../../../src/infrastructure/adapters/global-output-log-writer.js";

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("createGlobalOutputLogWriter", () => {
  it("creates the parent directory before the first append", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rundown-global-output-"));
    tempDirs.push(root);

    const filePath = path.join(root, ".rundown", "logs", "output.jsonl");
    const parentDirectory = path.dirname(filePath);
    const mkdirCalls: string[] = [];

    const fileSystem: FileSystem = {
      exists(fileOrDirPath) {
        return fs.existsSync(fileOrDirPath);
      },
      readText(fileOrDirPath) {
        return fs.readFileSync(fileOrDirPath, "utf-8");
      },
      writeText(fileOrDirPath, content) {
        fs.writeFileSync(fileOrDirPath, content, "utf-8");
      },
      mkdir(dirPath, options) {
        mkdirCalls.push(dirPath);
        fs.mkdirSync(dirPath, options);
      },
      readdir(dirPath) {
        return fs.readdirSync(dirPath, { withFileTypes: true }).map((entry) => ({
          name: entry.name,
          isFile: entry.isFile(),
          isDirectory: entry.isDirectory(),
        }));
      },
      stat(fileOrDirPath) {
        try {
          const stats = fs.statSync(fileOrDirPath);
          return {
            isFile: stats.isFile(),
            isDirectory: stats.isDirectory(),
            birthtimeMs: stats.birthtimeMs,
            mtimeMs: stats.mtimeMs,
          };
        } catch {
          return null;
        }
      },
      unlink(fileOrDirPath) {
        fs.unlinkSync(fileOrDirPath);
      },
      rm(fileOrDirPath, options) {
        fs.rmSync(fileOrDirPath, options);
      },
    };

    const writer = createGlobalOutputLogWriter(filePath, fileSystem);

    expect(fs.existsSync(parentDirectory)).toBe(false);

    writer.write({
      ts: "2026-03-27T00:00:00.000Z",
      level: "info",
      stream: "stdout",
      kind: "info",
      message: "first",
      command: "run",
      argv: ["run", "TODO.md"],
      cwd: root,
      pid: 123,
      version: "1.0.0",
      session_id: "session-1",
    });

    writer.write({
      ts: "2026-03-27T00:00:01.000Z",
      level: "error",
      stream: "stderr",
      kind: "error",
      message: "second",
      command: "run",
      argv: ["run", "TODO.md"],
      cwd: root,
      pid: 124,
      version: "1.0.0",
      session_id: "session-1",
    });

    expect(mkdirCalls).toEqual([parentDirectory]);
    expect(fs.existsSync(parentDirectory)).toBe(true);

    const lines = fs
      .readFileSync(filePath, "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { message: string });
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.message)).toEqual(["first", "second"]);
  });

  it("is best-effort when append fails", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rundown-global-output-"));
    tempDirs.push(root);

    const filePath = path.join(root, ".rundown", "logs", "output.jsonl");
    const appendSpy = vi.spyOn(fs, "appendFileSync").mockImplementation(() => {
      throw new Error("disk full");
    });

    const fileSystem: FileSystem = {
      exists(fileOrDirPath) {
        return fs.existsSync(fileOrDirPath);
      },
      readText(fileOrDirPath) {
        return fs.readFileSync(fileOrDirPath, "utf-8");
      },
      writeText(fileOrDirPath, content) {
        fs.writeFileSync(fileOrDirPath, content, "utf-8");
      },
      mkdir(dirPath, options) {
        fs.mkdirSync(dirPath, options);
      },
      readdir(dirPath) {
        return fs.readdirSync(dirPath, { withFileTypes: true }).map((entry) => ({
          name: entry.name,
          isFile: entry.isFile(),
          isDirectory: entry.isDirectory(),
        }));
      },
      stat(fileOrDirPath) {
        try {
          const stats = fs.statSync(fileOrDirPath);
          return {
            isFile: stats.isFile(),
            isDirectory: stats.isDirectory(),
            birthtimeMs: stats.birthtimeMs,
            mtimeMs: stats.mtimeMs,
          };
        } catch {
          return null;
        }
      },
      unlink(fileOrDirPath) {
        fs.unlinkSync(fileOrDirPath);
      },
      rm(fileOrDirPath, options) {
        fs.rmSync(fileOrDirPath, options);
      },
    };

    const writer = createGlobalOutputLogWriter(filePath, fileSystem);

    expect(() => {
      writer.write({
        ts: "2026-03-27T00:00:00.000Z",
        level: "error",
        stream: "stderr",
        kind: "error",
        message: "failed write",
        command: "run",
        argv: ["run", "TODO.md"],
        cwd: root,
        pid: 999,
        version: "1.0.0",
        session_id: "session-1",
      });
    }).not.toThrow();

    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.dirname(filePath))).toBe(true);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("is best-effort when ensuring parent directory fails", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rundown-global-output-"));
    tempDirs.push(root);

    const filePath = path.join(root, ".rundown", "logs", "output.jsonl");

    const fileSystem: FileSystem = {
      exists() {
        return false;
      },
      readText(fileOrDirPath) {
        return fs.readFileSync(fileOrDirPath, "utf-8");
      },
      writeText(fileOrDirPath, content) {
        fs.writeFileSync(fileOrDirPath, content, "utf-8");
      },
      mkdir() {
        throw new Error("permission denied");
      },
      readdir(dirPath) {
        return fs.readdirSync(dirPath, { withFileTypes: true }).map((entry) => ({
          name: entry.name,
          isFile: entry.isFile(),
          isDirectory: entry.isDirectory(),
        }));
      },
      stat(fileOrDirPath) {
        try {
          const stats = fs.statSync(fileOrDirPath);
          return {
            isFile: stats.isFile(),
            isDirectory: stats.isDirectory(),
            birthtimeMs: stats.birthtimeMs,
            mtimeMs: stats.mtimeMs,
          };
        } catch {
          return null;
        }
      },
      unlink(fileOrDirPath) {
        fs.unlinkSync(fileOrDirPath);
      },
      rm(fileOrDirPath, options) {
        fs.rmSync(fileOrDirPath, options);
      },
    };

    const writer = createGlobalOutputLogWriter(filePath, fileSystem);

    expect(() => {
      writer.write({
        ts: "2026-03-27T00:00:00.000Z",
        level: "error",
        stream: "stderr",
        kind: "error",
        message: "mkdir failed",
        command: "run",
        argv: ["run", "TODO.md"],
        cwd: root,
        pid: 999,
        version: "1.0.0",
        session_id: "session-1",
      });
    }).not.toThrow();

    expect(fs.existsSync(filePath)).toBe(false);
  });
});
