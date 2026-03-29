import fs from "node:fs";
import path from "node:path";
import type { Task } from "../../domain/parser.js";
import type { VerificationStore } from "../../domain/ports/verification-store.js";

const DEFAULT_FAILURE = "Verification failed (no details).";

interface VerifyPhaseMetadata {
  phase?: string;
  task?: {
    file?: string;
    index?: number;
  };
  verificationResult?: string;
}

interface RunMetadata {
  completedAt?: string;
  status?: string;
}

export function createArtifactVerificationStore(configDir?: string): VerificationStore {
  const inMemoryResults = new Map<string, string>();

  return {
    write(task, content) {
      const key = taskStoreKey(task);
      const normalized = normalizeVerificationResult(content);
      const metadataPath = findLatestVerifyPhaseMetadataPath(task, configDir, { activeOnly: true });
      if (!metadataPath) {
        inMemoryResults.set(key, normalized);
        return;
      }

      const metadata = readJson<VerifyPhaseMetadata>(metadataPath);
      if (!metadata) {
        inMemoryResults.set(key, normalized);
        return;
      }

      metadata.verificationResult = normalized;
      writeJson(metadataPath, metadata);
      inMemoryResults.delete(key);
    },
    read(task) {
      const key = taskStoreKey(task);
      const inMemory = inMemoryResults.get(key);
      if (inMemory) {
        return inMemory;
      }

      const metadataPath = findLatestVerifyPhaseMetadataPath(task, configDir);
      if (!metadataPath) {
        return null;
      }

      const metadata = readJson<VerifyPhaseMetadata>(metadataPath);
      const value = typeof metadata?.verificationResult === "string"
        ? metadata.verificationResult.trim()
        : "";

      if (value === "") {
        return null;
      }

      return value;
    },
    remove(task) {
      const key = taskStoreKey(task);
      inMemoryResults.delete(key);
    },
  };
}

function findLatestVerifyPhaseMetadataPath(
  task: Task,
  configDir: string | undefined,
  options: { activeOnly?: boolean } = {},
): string | null {
  if (!configDir) {
    return null;
  }

  const runsDir = path.join(configDir, "runs");
  if (!fs.existsSync(runsDir)) {
    return null;
  }

  const runDirs = fs.readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));

  for (const runDirName of runDirs) {
    const runDir = path.join(runsDir, runDirName);
    if (options.activeOnly) {
      const runMetadata = readJson<RunMetadata>(path.join(runDir, "run.json"));
      if (runMetadata && (runMetadata.completedAt !== undefined || runMetadata.status !== undefined)) {
        continue;
      }
    }

    const phaseDirs = fs.readdirSync(runDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a));

    for (const phaseDirName of phaseDirs) {
      const metadataPath = path.join(runDir, phaseDirName, "metadata.json");
      const metadata = readJson<VerifyPhaseMetadata>(metadataPath);
      if (!metadata || metadata.phase !== "verify") {
        continue;
      }

      if (isTaskMatch(metadata.task, task)) {
        return metadataPath;
      }
    }
  }

  return null;
}

function taskStoreKey(task: Task): string {
  return `${path.resolve(task.file)}::${String(task.index)}`;
}

function isTaskMatch(
  metadataTask: VerifyPhaseMetadata["task"],
  task: Task,
): boolean {
  if (!metadataTask || typeof metadataTask.file !== "string" || typeof metadataTask.index !== "number") {
    return false;
  }

  const metadataPath = path.resolve(metadataTask.file);
  const taskPath = path.resolve(task.file);

  return metadataPath === taskPath && metadataTask.index === task.index;
}

function normalizeVerificationResult(content: string): string {
  const trimmed = content.trim();
  return trimmed === "" ? DEFAULT_FAILURE : trimmed;
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}
