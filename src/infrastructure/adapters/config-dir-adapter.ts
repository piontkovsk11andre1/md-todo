import fs from "node:fs";
import path from "node:path";
import {
  CONFIG_DIR_NAME,
  type ConfigDirPort,
  type ConfigDirResult,
} from "../../domain/ports/config-dir-port.js";

export function createConfigDirAdapter(): ConfigDirPort {
  return {
    resolve(startDir) {
      let currentDir = path.resolve(startDir);

      while (true) {
        const configDir = path.join(currentDir, CONFIG_DIR_NAME);
        if (fs.existsSync(configDir)) {
          const result: ConfigDirResult = {
            configDir,
            isExplicit: false,
          };
          return result;
        }

        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
          return undefined;
        }
        currentDir = parentDir;
      }
    },
  };
}
