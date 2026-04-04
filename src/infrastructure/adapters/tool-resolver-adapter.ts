import type { ConfigDirResult } from "../../domain/ports/config-dir-port.js";
import type { FileSystem } from "../../domain/ports/file-system.js";
import type { PathOperationsPort } from "../../domain/ports/path-operations-port.js";
import type { ToolResolverPort } from "../../domain/ports/tool-resolver-port.js";

const TOOLS_DIRECTORY_NAME = "tools";
const TOOL_TEMPLATE_EXTENSION = ".md";

/**
 * Dependencies required to resolve project tool templates.
 */
export interface ToolResolverAdapterDependencies {
  fileSystem: FileSystem;
  pathOperations: PathOperationsPort;
  configDir: ConfigDirResult | undefined;
}

/**
 * Creates a tool resolver adapter that loads `.rundown/tools/*.md` templates on demand.
 */
export function createToolResolverAdapter(
  dependencies: ToolResolverAdapterDependencies,
): ToolResolverPort {
  return {
    resolve(toolName) {
      const normalizedToolName = toolName.trim();
      if (normalizedToolName.length === 0) {
        return undefined;
      }

      const configDirPath = dependencies.configDir?.configDir;
      if (!configDirPath) {
        return undefined;
      }

      const toolsDir = dependencies.pathOperations.join(configDirPath, TOOLS_DIRECTORY_NAME);
      const toolFileName = `${normalizedToolName}${TOOL_TEMPLATE_EXTENSION}`;
      const matchingTemplateName = findTemplateFileName(toolsDir, toolFileName, dependencies.fileSystem);
      if (!matchingTemplateName) {
        return undefined;
      }

      const templatePath = dependencies.pathOperations.join(toolsDir, matchingTemplateName);
      const template = readTemplate(templatePath, dependencies.fileSystem);
      if (template === undefined) {
        return undefined;
      }

      return {
        name: normalizedToolName,
        templatePath,
        template,
      };
    },
  };
}

function findTemplateFileName(
  toolsDir: string,
  expectedFileName: string,
  fileSystem: FileSystem,
): string | undefined {
  try {
    for (const entry of fileSystem.readdir(toolsDir)) {
      if (entry.isFile && entry.name === expectedFileName) {
        return entry.name;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function readTemplate(templatePath: string, fileSystem: FileSystem): string | undefined {
  try {
    return fileSystem.readText(templatePath);
  } catch {
    return undefined;
  }
}
