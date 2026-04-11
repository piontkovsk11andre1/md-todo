import { initGitRepo } from "./git-operations.js";
import type {
  GitClient,
  PathOperationsPort,
  WorkingDirectoryPort,
} from "../domain/ports/index.js";

export interface StartProjectOptions {
  dir?: string;
}

export interface StartProjectDependencies {
  gitClient: GitClient;
  pathOperations: PathOperationsPort;
  workingDirectory: WorkingDirectoryPort;
}

/**
 * Creates the start-project use case.
 *
 * This flow ensures the target directory is inside a Git repository by
 * initializing one when needed.
 */
export function createStartProject(
  dependencies: StartProjectDependencies,
): (options?: StartProjectOptions) => Promise<number> {
  return async function startProject(options: StartProjectOptions = {}): Promise<number> {
    const dirOption = options.dir?.trim();
    const targetDirectory = dirOption
      ? dependencies.pathOperations.resolve(dirOption)
      : dependencies.workingDirectory.cwd();

    await initGitRepo(dependencies.gitClient, targetDirectory);
    return 0;
  };
}
