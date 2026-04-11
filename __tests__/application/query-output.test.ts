import { describe, expect, it } from "vitest";
import {
  aggregateQueryOutput,
  formatQueryOutput,
  resolveQueryExitCode,
  writeQueryOutput,
} from "../../src/application/query-output.ts";
import type { FileSystem } from "../../src/domain/ports/file-system.ts";

class InMemoryFileSystem implements FileSystem {
  private readonly files = new Map<string, string>();
  private readonly directories = new Set<string>();

  public constructor(initialFiles: Record<string, string> = {}) {
    this.directories.add("/");
    for (const [filePath, content] of Object.entries(initialFiles)) {
      const normalized = normalizePath(filePath);
      this.files.set(normalized, content);
      this.directories.add(parentDir(normalized));
    }
  }

  public exists(path: string): boolean {
    const normalized = normalizePath(path);
    return this.files.has(normalized) || this.directories.has(normalized);
  }

  public readText(filePath: string): string {
    const normalized = normalizePath(filePath);
    const value = this.files.get(normalized);
    if (value === undefined) {
      throw new Error(`File not found: ${normalized}`);
    }
    return value;
  }

  public writeText(filePath: string, content: string): void {
    const normalized = normalizePath(filePath);
    this.files.set(normalized, content);
    this.directories.add(parentDir(normalized));
  }

  public mkdir(dirPath: string): void {
    this.directories.add(normalizePath(dirPath));
  }

  public readdir(dirPath: string) {
    const normalizedDir = normalizePath(dirPath);
    const names = new Set<string>();

    for (const filePath of this.files.keys()) {
      if (!filePath.startsWith(`${normalizedDir}/`)) {
        continue;
      }
      const rest = filePath.slice(normalizedDir.length + 1);
      if (rest.length === 0 || rest.includes("/")) {
        continue;
      }
      names.add(rest);
    }

    return [...names]
      .sort((left, right) => left.localeCompare(right))
      .map((name) => ({
        name,
        isFile: true,
        isDirectory: false,
      }));
  }

  public stat() {
    return null;
  }

  public unlink(filePath: string): void {
    this.files.delete(normalizePath(filePath));
  }

  public rm(path: string): void {
    const normalized = normalizePath(path);
    this.files.delete(normalized);
    this.directories.delete(normalized);
  }
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function parentDir(filePath: string): string {
  const index = filePath.lastIndexOf("/");
  return index > 0 ? filePath.slice(0, index) : "/";
}

describe("query-output", () => {
  it("aggregates markdown step files in numeric step order", async () => {
    const fileSystem = new InMemoryFileSystem({
      "/work/step-10.md": "# Tenth\n\nBody 10",
      "/work/step-2.md": "# Second\n\nBody 2",
      "/work/step-01.md": "# First\n\nBody 1",
    });

    const aggregated = await aggregateQueryOutput("/work", { fileSystem });

    expect(aggregated).toContain("## Step 1: First");
    expect(aggregated).toContain("## Step 2: Second");
    expect(aggregated).toContain("## Step 3: Tenth");
  });

  it("formats query output as json with parsed steps", () => {
    const markdown = [
      "## Step 1: Discover",
      "",
      "Found A",
      "",
      "## Step 2: Confirm",
      "",
      "Found B",
    ].join("\n");

    const formatted = formatQueryOutput(markdown, "json", "what is happening?");
    const parsed = JSON.parse(formatted) as {
      query: string;
      steps: Array<{ title: string; content: string }>;
      output: string;
    };

    expect(parsed.query).toBe("what is happening?");
    expect(parsed.steps).toHaveLength(2);
    expect(parsed.steps[0].title).toBe("Discover");
    expect(parsed.steps[1].title).toBe("Confirm");
    expect(parsed.output).toBe(markdown);
  });

  it("extracts yn and success-error verdict formats", () => {
    expect(formatQueryOutput("notes\n\nverdict: Y", "yn", "q")).toBe("Y");
    expect(formatQueryOutput("analysis\n\nfailure: missing coverage", "success-error", "q")).toBe("failure: missing coverage");
    expect(formatQueryOutput("conclusion\n\nY", "success-error", "q")).toBe("success");
  });

  it("resolves format-driven exit codes", () => {
    expect(resolveQueryExitCode("yn", "Y")).toBe(0);
    expect(resolveQueryExitCode("yn", "N")).toBe(1);
    expect(resolveQueryExitCode("success-error", "success")).toBe(0);
    expect(resolveQueryExitCode("success-error", "failure: nope")).toBe(1);
    expect(resolveQueryExitCode("markdown", "anything")).toBe(0);
    expect(resolveQueryExitCode("json", "{}")).toBe(0);
  });

  it("writes output file through provided file-system dependency", async () => {
    const fileSystem = new InMemoryFileSystem();

    await writeQueryOutput("hello", "/tmp/result.md", { fileSystem });

    expect(fileSystem.readText("/tmp/result.md")).toBe("hello");
  });
});
