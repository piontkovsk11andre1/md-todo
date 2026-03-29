import type { ApplicationOutputPort } from "../domain/ports/output-port.js";
import type {
  FileSystem,
  FileLock,
  PathOperationsPort,
} from "../domain/ports/index.js";
import { CONFIG_DIR_NAME } from "../domain/ports/config-dir-port.js";

export interface UnlockTaskDependencies {
  fileLock: FileLock;
  fileSystem: FileSystem;
  pathOperations: PathOperationsPort;
  output: ApplicationOutputPort;
}

export interface UnlockTaskOptions {
  source: string;
}

export function createUnlockTask(
  dependencies: UnlockTaskDependencies,
): (options: UnlockTaskOptions) => Promise<number> {
  const emit = dependencies.output.emit.bind(dependencies.output);

  return async function unlockTask(options: UnlockTaskOptions): Promise<number> {
    const sourcePath = dependencies.pathOperations.resolve(options.source);
    const sourceDirectory = dependencies.pathOperations.dirname(sourcePath);
    const sourceName = basenameFromPath(sourcePath);
    const lockPath = dependencies.pathOperations.join(sourceDirectory, CONFIG_DIR_NAME, `${sourceName}.lock`);

    if (!dependencies.fileSystem.exists(lockPath)) {
      emit({ kind: "info", message: "No lockfile found for source: " + sourcePath });
      return 3;
    }

    if (dependencies.fileLock.isLocked(sourcePath)) {
      emit({
        kind: "error",
        message: "Source lock is currently held by a running process and cannot be manually released: " + sourcePath,
      });
      return 1;
    }

    dependencies.fileLock.forceRelease(sourcePath);
    emit({ kind: "success", message: "Released stale source lock: " + sourcePath });
    return 0;
  };
}

function basenameFromPath(filePath: string): string {
  const parts = filePath.split(/[/\\]+/);
  return parts[parts.length - 1] ?? filePath;
}
