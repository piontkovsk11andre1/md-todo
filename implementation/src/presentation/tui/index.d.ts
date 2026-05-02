import type { ParsedWorkerPattern } from "../../domain/worker-pattern.js";
import type { CliApp } from "../cli-app-init.js";

export interface RunRootTuiOptions {
  app?: CliApp;
  workerPattern?: ParsedWorkerPattern;
  cliVersion?: string;
  argv?: string[];
}

export function runRootTui(options?: RunRootTuiOptions): Promise<number>;
