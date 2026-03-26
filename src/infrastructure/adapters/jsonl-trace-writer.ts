import nodeFs from "node:fs";
import path from "node:path";
import type { TraceWriterPort } from "../../domain/ports/trace-writer-port.js";
import type { FileSystem } from "../../domain/ports/file-system.js";

export function createJsonlTraceWriter(filePath: string, fs: FileSystem): TraceWriterPort {
  let parentDirectoryEnsured = false;

  return {
    write(event) {
      if (!parentDirectoryEnsured) {
        const parentDirectory = path.dirname(filePath);
        fs.mkdir(parentDirectory, { recursive: true });
        parentDirectoryEnsured = true;
      }

      nodeFs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, "utf-8");
    },
    flush() {},
  };
}
