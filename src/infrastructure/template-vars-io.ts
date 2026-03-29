import fs from "node:fs";
import path from "node:path";
import { type ExtraTemplateVars } from "../domain/template-vars.js";
import { CONFIG_DIR_NAME } from "../domain/ports/config-dir-port.js";

const TEMPLATE_VAR_KEY = /^[A-Za-z_]\w*$/;
const DEFAULT_VARS_FILE_NAME = "vars.json";

function resolveTemplateVarsPath(filePath: string, cwd: string, configDir?: string): string {
  const defaultRelativePath = path.join(CONFIG_DIR_NAME, DEFAULT_VARS_FILE_NAME);
  const defaultPathFromCwd = path.resolve(cwd, defaultRelativePath);
  const resolvedRequestedPath = path.resolve(cwd, filePath);
  if (configDir && resolvedRequestedPath === defaultPathFromCwd) {
    return path.join(configDir, DEFAULT_VARS_FILE_NAME);
  }

  return resolvedRequestedPath;
}

export function loadTemplateVarsFile(
  filePath: string,
  cwd: string = process.cwd(),
  configDir?: string,
): ExtraTemplateVars {
  const resolvedPath = resolveTemplateVarsPath(filePath, cwd, configDir);

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf-8"));
  } catch (error) {
    throw new Error(`Failed to read template vars file \"${filePath}\": ${String(error)}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Template vars file \"${filePath}\" must contain a JSON object.`);
  }

  const vars: ExtraTemplateVars = {};

  for (const [key, value] of Object.entries(parsed)) {
    if (!TEMPLATE_VAR_KEY.test(key)) {
      throw new Error(`Invalid template variable name \"${key}\" in \"${filePath}\". Use letters, numbers, and underscores only.`);
    }

    if (value === null || value === undefined) {
      vars[key] = "";
      continue;
    }

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      vars[key] = String(value);
      continue;
    }

    throw new Error(`Template variable \"${key}\" in \"${filePath}\" must be a string, number, boolean, or null.`);
  }

  return vars;
}
