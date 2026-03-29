/**
 * Template loader.
 *
 * Loads project-local templates from .rundown/ or falls back to built-in defaults.
 */

import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_DISCUSS_TEMPLATE,
  DEFAULT_TRACE_TEMPLATE,
  DEFAULT_REPAIR_TEMPLATE,
  DEFAULT_TASK_TEMPLATE,
  DEFAULT_VERIFY_TEMPLATE,
  DEFAULT_PLAN_TEMPLATE,
} from "../domain/defaults.js";

export interface ProjectTemplates {
  task: string;
  discuss: string;
  verify: string;
  repair: string;
  plan: string;
  trace: string;
}

/**
 * Load templates from the project directory, falling back to built-in defaults.
 *
 * Template names:
 *   .rundown/execute.md
 *   .rundown/discuss.md
 *   .rundown/verify.md
 *   .rundown/repair.md
 *   .rundown/plan.md
 *   .rundown/trace.md
 */
export function loadProjectTemplates(configDir?: string): ProjectTemplates {
  if (!configDir) {
    return {
      task: DEFAULT_TASK_TEMPLATE,
      discuss: DEFAULT_DISCUSS_TEMPLATE,
      verify: DEFAULT_VERIFY_TEMPLATE,
      repair: DEFAULT_REPAIR_TEMPLATE,
      plan: DEFAULT_PLAN_TEMPLATE,
      trace: DEFAULT_TRACE_TEMPLATE,
    };
  }

  return {
    task: loadFile(path.join(configDir, "execute.md")) ?? DEFAULT_TASK_TEMPLATE,
    discuss: loadFile(path.join(configDir, "discuss.md")) ?? DEFAULT_DISCUSS_TEMPLATE,
    verify: loadFile(path.join(configDir, "verify.md")) ?? DEFAULT_VERIFY_TEMPLATE,
    repair: loadFile(path.join(configDir, "repair.md")) ?? DEFAULT_REPAIR_TEMPLATE,
    plan: loadFile(path.join(configDir, "plan.md")) ?? DEFAULT_PLAN_TEMPLATE,
    trace: loadFile(path.join(configDir, "trace.md")) ?? DEFAULT_TRACE_TEMPLATE,
  };
}

function loadFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}
