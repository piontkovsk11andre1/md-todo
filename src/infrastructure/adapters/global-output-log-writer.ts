import nodeFs from "node:fs";
import path from "node:path";
import {
  serializeGlobalOutputLogEntry,
  type GlobalOutputLogEntry,
} from "../../domain/global-output-log.js";
import type { FileSystem } from "../../domain/ports/file-system.js";

export interface GlobalOutputLogWriter {
  write(entry: GlobalOutputLogEntry): void;
  flush(): void;
}

export function createGlobalOutputLogWriter(filePath: string, fs: FileSystem): GlobalOutputLogWriter {
  let parentDirectoryEnsured = false;

  return {
    write(entry) {
      try {
        if (!parentDirectoryEnsured) {
          fs.mkdir(path.dirname(filePath), { recursive: true });
          parentDirectoryEnsured = true;
        }

        nodeFs.appendFileSync(filePath, serializeGlobalOutputLogEntry(entry), {
          encoding: "utf-8",
          flag: "a",
        });
      } catch {
        // best-effort logging: never interrupt command flow on log write failures
      }
    },
    flush() {},
  };
}
