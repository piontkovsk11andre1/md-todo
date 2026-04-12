import { describe, expect, it } from "vitest";
import {
  discoverDesignRevisionDirectories,
  parseDesignRevisionDirectoryName,
} from "../../application/design-context.ts";
import type {
  FileSystem,
  FileSystemDirent,
  FileSystemStat,
} from "../../domain/ports/file-system.ts";

class InMemoryFileSystem implements FileSystem {
  private readonly directories = new Map<string, FileSystemDirent[]>();

  private readonly files = new Map<string, string>();

  private readonly stats = new Map<string, FileSystemStat>();

  public constructor(seed: {
    directories?: Record<string, FileSystemDirent[]>;
    files?: Record<string, string>;
    stats?: Record<string, FileSystemStat>;
  }) {
    for (const [dirPath, entries] of Object.entries(seed.directories ?? {})) {
      this.directories.set(dirPath, entries.slice());
      this.stats.set(dirPath, { isDirectory: true, isFile: false });
    }

    for (const [filePath, content] of Object.entries(seed.files ?? {})) {
      this.files.set(filePath, content);
      this.stats.set(filePath, { isDirectory: false, isFile: true });
    }

    for (const [entryPath, stat] of Object.entries(seed.stats ?? {})) {
      this.stats.set(entryPath, stat);
    }
  }

  public exists(targetPath: string): boolean {
    return this.stats.has(targetPath);
  }

  public readText(filePath: string): string {
    const value = this.files.get(filePath);
    if (value === undefined) {
      throw new Error("File not found: " + filePath);
    }

    return value;
  }

  public writeText(filePath: string, content: string): void {
    this.files.set(filePath, content);
    this.stats.set(filePath, { isDirectory: false, isFile: true });
  }

  public mkdir(dirPath: string): void {
    if (!this.directories.has(dirPath)) {
      this.directories.set(dirPath, []);
    }
    this.stats.set(dirPath, { isDirectory: true, isFile: false });
  }

  public readdir(dirPath: string): FileSystemDirent[] {
    return (this.directories.get(dirPath) ?? []).slice();
  }

  public stat(targetPath: string): FileSystemStat | null {
    return this.stats.get(targetPath) ?? null;
  }

  public unlink(filePath: string): void {
    this.files.delete(filePath);
    this.stats.delete(filePath);
  }

  public rm(targetPath: string): void {
    this.files.delete(targetPath);
    this.directories.delete(targetPath);
    this.stats.delete(targetPath);
  }
}

describe("parseDesignRevisionDirectoryName", () => {
  it("parses valid revision directory names", () => {
    expect(parseDesignRevisionDirectoryName("rev.1")).toEqual({ index: 1 });
    expect(parseDesignRevisionDirectoryName("REV.42")).toEqual({ index: 42 });
    expect(parseDesignRevisionDirectoryName(" rev.7 ")).toEqual({ index: 7 });
  });

  it("returns null for malformed revision directory names", () => {
    expect(parseDesignRevisionDirectoryName("rev.0")).toBeNull();
    expect(parseDesignRevisionDirectoryName("rev.-1")).toBeNull();
    expect(parseDesignRevisionDirectoryName("rev.1-draft")).toBeNull();
    expect(parseDesignRevisionDirectoryName("rev.one")).toBeNull();
    expect(parseDesignRevisionDirectoryName("current")).toBeNull();
  });
});

describe("discoverDesignRevisionDirectories", () => {
  it("returns deterministic ascending order and ignores malformed entries", () => {
    const projectRoot = "/repo";
    const docsDir = "/repo/docs";
    const fileSystem = new InMemoryFileSystem({
      directories: {
        [docsDir]: [
          { name: "rev.10", isDirectory: true, isFile: false },
          { name: "current", isDirectory: true, isFile: false },
          { name: "rev.2", isDirectory: true, isFile: false },
          { name: "REV.2", isDirectory: true, isFile: false },
          { name: "rev.x", isDirectory: true, isFile: false },
          { name: "rev.0", isDirectory: true, isFile: false },
          { name: "rev.3.md", isDirectory: false, isFile: true },
          { name: "rev.001", isDirectory: true, isFile: false },
        ],
      },
      stats: {
        [docsDir]: { isDirectory: true, isFile: false },
      },
    });

    const revisions = discoverDesignRevisionDirectories(fileSystem, projectRoot);

    expect(revisions).toEqual([
      { index: 1, name: "rev.001", absolutePath: "/repo/docs/rev.001" },
      { index: 2, name: "REV.2", absolutePath: "/repo/docs/REV.2" },
      { index: 2, name: "rev.2", absolutePath: "/repo/docs/rev.2" },
      { index: 10, name: "rev.10", absolutePath: "/repo/docs/rev.10" },
    ]);
  });

  it("returns empty list when docs directory is missing", () => {
    const fileSystem = new InMemoryFileSystem({});
    expect(discoverDesignRevisionDirectories(fileSystem, "/repo")).toEqual([]);
  });
});
