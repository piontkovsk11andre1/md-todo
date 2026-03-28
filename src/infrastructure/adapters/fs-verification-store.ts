import fs from "node:fs";
import type { Task } from "../../domain/parser.js";
import type { VerificationStore } from "../../domain/ports/verification-store.js";

export function createFsVerificationStore(): VerificationStore {
  return {
    write(task, content) {
      const filePath = validationFilePath(task);
      fs.writeFileSync(filePath, content, "utf-8");
    },
    read(task) {
      const filePath = validationFilePath(task);
      try {
        return fs.readFileSync(filePath, "utf-8").trim();
      } catch {
        return null;
      }
    },
    remove(task) {
      const filePath = validationFilePath(task);
      try {
        fs.unlinkSync(filePath);
      } catch {
        // Ignore missing sidecar files.
      }
    },
  };
}

function validationFilePath(task: Task): string {
  return `${task.file}.${task.index}.validation`;
}
