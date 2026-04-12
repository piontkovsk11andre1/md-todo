import path from "node:path";
import type { FileSystem } from "../domain/ports/index.js";

export interface DesignContextResolution {
  design: string;
  sourcePaths: string[];
}

export interface DesignRevisionDirectory {
  index: number;
  name: string;
  absolutePath: string;
}

export function resolveDesignContext(fileSystem: FileSystem, projectRoot: string): DesignContextResolution {
  const docsCurrentDir = path.join(projectRoot, "docs", "current");
  const docsCurrentFiles = collectDesignFiles(fileSystem, docsCurrentDir);

  if (docsCurrentFiles.length > 0) {
    return {
      design: formatDesignWorkspaceContext(fileSystem, docsCurrentDir, docsCurrentFiles),
      sourcePaths: docsCurrentFiles,
    };
  }

  const legacyDesignPath = path.join(projectRoot, "Design.md");
  if (!isFile(fileSystem, legacyDesignPath)) {
    return {
      design: "",
      sourcePaths: [],
    };
  }

  return {
    design: fileSystem.readText(legacyDesignPath),
    sourcePaths: [legacyDesignPath],
  };
}

export function discoverDesignRevisionDirectories(
  fileSystem: FileSystem,
  projectRoot: string,
): DesignRevisionDirectory[] {
  const docsDir = path.join(projectRoot, "docs");
  if (!isDirectory(fileSystem, docsDir)) {
    return [];
  }

  const revisions: DesignRevisionDirectory[] = [];
  const entries = fileSystem.readdir(docsDir)
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));

  for (const entry of entries) {
    if (!entry.isDirectory) {
      continue;
    }

    const parsed = parseDesignRevisionDirectoryName(entry.name);
    if (!parsed) {
      continue;
    }

    revisions.push({
      index: parsed.index,
      name: entry.name,
      absolutePath: path.join(docsDir, entry.name),
    });
  }

  return revisions.sort((left, right) => {
    if (left.index !== right.index) {
      return left.index - right.index;
    }

    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
}

export function parseDesignRevisionDirectoryName(name: string): { index: number } | null {
  const match = /^rev\.(\d+)$/i.exec(name.trim());
  if (!match) {
    return null;
  }

  const indexText = match[1];
  if (!indexText) {
    return null;
  }

  const parsedIndex = Number.parseInt(indexText, 10);
  if (!Number.isSafeInteger(parsedIndex) || parsedIndex < 1) {
    return null;
  }

  return { index: parsedIndex };
}

function collectDesignFiles(fileSystem: FileSystem, directoryPath: string): string[] {
  if (!isDirectory(fileSystem, directoryPath)) {
    return [];
  }

  const collected: string[] = [];
  const queue: string[] = [directoryPath];

  while (queue.length > 0) {
    const currentDir = queue.shift();
    if (!currentDir) {
      continue;
    }

    const entries = fileSystem.readdir(currentDir)
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory) {
        queue.push(absolutePath);
      } else if (entry.isFile) {
        collected.push(absolutePath);
      }
    }
  }

  return collected.sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
}

function formatDesignWorkspaceContext(fileSystem: FileSystem, docsCurrentDir: string, filePaths: string[]): string {
  const primaryDesignPath = findPrimaryDesignPath(filePaths);
  const orderedPaths = primaryDesignPath
    ? [primaryDesignPath, ...filePaths.filter((candidate) => candidate !== primaryDesignPath)]
    : filePaths;

  const sections: string[] = [];
  for (const filePath of orderedPaths) {
    const content = fileSystem.readText(filePath);
    const relativePath = path.relative(docsCurrentDir, filePath).replace(/\\/g, "/");

    if (sections.length === 0 && primaryDesignPath === filePath) {
      sections.push(content);
      continue;
    }

    sections.push(["", "---", "", `### ${relativePath}`, "", content].join("\n"));
  }

  return sections.join("\n").trim();
}

function findPrimaryDesignPath(filePaths: string[]): string | null {
  for (const filePath of filePaths) {
    if (path.basename(filePath).toLowerCase() === "design.md") {
      return filePath;
    }
  }

  return null;
}

function isDirectory(fileSystem: FileSystem, absolutePath: string): boolean {
  const stat = fileSystem.stat(absolutePath);
  return stat?.isDirectory === true;
}

function isFile(fileSystem: FileSystem, absolutePath: string): boolean {
  const stat = fileSystem.stat(absolutePath);
  return stat?.isFile === true;
}
