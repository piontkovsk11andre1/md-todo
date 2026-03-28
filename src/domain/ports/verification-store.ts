import type { Task } from "../parser.js";

export interface VerificationStore {
  write(task: Task, content: string): void;
  read(task: Task): string | null;
  remove(task: Task): void;
}
