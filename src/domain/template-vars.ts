import path from "node:path";
import { CONFIG_DIR_NAME } from "./ports/config-dir-port.js";

export type ExtraTemplateVars = Record<string, string>;
const DEFAULT_TEMPLATE_VARS_FILE_NAME = "vars.json";
export const DEFAULT_TEMPLATE_VARS_FILE = path.join(CONFIG_DIR_NAME, DEFAULT_TEMPLATE_VARS_FILE_NAME);

const TEMPLATE_VAR_KEY = /^[A-Za-z_]\w*$/;

export function parseCliTemplateVars(entries: string[]): ExtraTemplateVars {
  const vars: ExtraTemplateVars = {};

  for (const entry of entries) {
    const equalsIndex = entry.indexOf("=");
    if (equalsIndex <= 0) {
      throw new Error(`Invalid template variable \"${entry}\". Use key=value.`);
    }

    const key = entry.slice(0, equalsIndex).trim();
    const value = entry.slice(equalsIndex + 1);

    if (!TEMPLATE_VAR_KEY.test(key)) {
      throw new Error(`Invalid template variable name \"${key}\". Use letters, numbers, and underscores only.`);
    }

    vars[key] = value;
  }

  return vars;
}

export function resolveTemplateVarsFilePath(
  option: string | boolean | undefined,
  configDir?: string,
): string | undefined {
  if (option === true) {
    return configDir
      ? path.join(configDir, DEFAULT_TEMPLATE_VARS_FILE_NAME)
      : DEFAULT_TEMPLATE_VARS_FILE;
  }

  return typeof option === "string" ? option : undefined;
}
