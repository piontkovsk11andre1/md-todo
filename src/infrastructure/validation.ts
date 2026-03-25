/**
 * Validation system.
 *
 * Manages task-specific validation sidecar files and evaluates results.
 */

import fs from "node:fs";
import type { Task } from "../domain/parser.js";
import { renderTemplate, type TemplateVars } from "../domain/template.js";
import type { ExtraTemplateVars } from "../domain/template-vars.js";
import { runWorker, type RunnerMode, type PromptTransport } from "./runner.js";
import type { RuntimeArtifactsContext } from "./runtime-artifacts.js";

/**
 * Build the validation sidecar file path for a given task.
 *
 * Format: <source-file>.<task-index>.validation
 * Example: Tasks.md.3.validation
 */
export function validationFilePath(task: Task): string {
  return `${task.file}.${task.index}.validation`;
}

/**
 * Read the validation sidecar file content.
 * Returns null if the file does not exist.
 */
export function readValidationFile(task: Task): string | null {
  const p = validationFilePath(task);
  try {
    return fs.readFileSync(p, "utf-8").trim();
  } catch {
    return null;
  }
}

/**
 * Persist validation content for a task.
 */
export function writeValidationFile(task: Task, content: string): void {
  const p = validationFilePath(task);
  const normalized = content.trim() === ""
    ? "Validation failed (no details)."
    : content.trim();
  fs.writeFileSync(p, normalized, "utf-8");
}

/**
 * Remove the validation sidecar file.
 */
export function removeValidationFile(task: Task): void {
  const p = validationFilePath(task);
  try {
    fs.unlinkSync(p);
  } catch {
    // Ignore if already gone
  }
}

/**
 * Check whether the validation file indicates success.
 */
export function isValidationOk(task: Task): boolean {
  const content = readValidationFile(task);
  return content !== null && content.toUpperCase() === "OK";
}

interface ValidationResult {
  ok: boolean;
  sidecarContent: string;
}

function parseValidationResult(output: { exitCode: number | null; stdout: string; stderr: string }): ValidationResult {
  const stdout = output.stdout.trim();
  const stderr = output.stderr.trim();

  if (output.exitCode !== 0) {
    const reason = stdout || stderr || `Validation worker exited with code ${String(output.exitCode)}.`;
    return { ok: false, sidecarContent: reason };
  }

  if (stdout.toUpperCase() === "OK") {
    return { ok: true, sidecarContent: "OK" };
  }

  if (stdout !== "") {
    const notOkPrefix = /^NOT_OK\s*:\s*/i;
    const normalizedReason = stdout.replace(notOkPrefix, "").trim();
    return {
      ok: false,
      sidecarContent: normalizedReason === ""
        ? "Validation failed (no details)."
        : normalizedReason,
    };
  }

  if (stderr !== "") {
    return { ok: false, sidecarContent: stderr };
  }

  return {
    ok: false,
    sidecarContent: "Validation worker returned empty output. Expected OK or a short failure reason.",
  };
}

export interface ValidateOptions {
  task: Task;
  source: string;
  contextBefore: string;
  template: string;
  command: string[];
  mode?: RunnerMode;
  transport?: PromptTransport;
  cwd?: string;
  templateVars?: ExtraTemplateVars;
  artifactContext?: RuntimeArtifactsContext;
}

/**
 * Run the validation step:
 * render the validate template, execute the validator command,
 * parse worker output, and persist a deterministic sidecar result.
 */
export async function validate(options: ValidateOptions): Promise<boolean> {
  const vars: TemplateVars = {
    ...options.templateVars,
    task: options.task.text,
    file: options.task.file,
    context: options.contextBefore,
    taskIndex: options.task.index,
    taskLine: options.task.line,
    source: options.source,
  };

  const prompt = renderTemplate(options.template, vars);

  removeValidationFile(options.task);

  const runResult = await runWorker({
    command: options.command,
    prompt,
    mode: options.mode ?? "wait",
    transport: options.transport ?? "file",
    cwd: options.cwd,
    artifactContext: options.artifactContext,
    artifactPhase: "verify",
  });

  const result = parseValidationResult(runResult);
  writeValidationFile(options.task, result.sidecarContent);
  return result.ok;
}
