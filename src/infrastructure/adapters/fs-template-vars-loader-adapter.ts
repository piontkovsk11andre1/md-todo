import type { TemplateVarsLoaderPort } from "../../domain/ports/template-vars-loader-port.js";
import { loadTemplateVarsFile } from "../template-vars-io.js";

export function createFsTemplateVarsLoaderAdapter(): TemplateVarsLoaderPort {
  return {
    load(filePath, cwd, configDir) {
      return loadTemplateVarsFile(filePath, cwd, configDir);
    },
  };
}
