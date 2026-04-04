/**
 * Resolved tool definition loaded from `.rundown/tools/<name>.md`.
 */
export interface ToolDefinition {
  // Canonical tool name used as the task prefix.
  name: string;
  // Absolute path to the resolved tool template file.
  templatePath: string;
  // Raw Markdown template content used to render the worker prompt.
  template: string;
}

/**
 * Resolves tool definitions for dynamic task prefix expansion.
 */
export interface ToolResolverPort {
  // Returns the tool definition for a known tool name, or `undefined`.
  resolve(toolName: string): ToolDefinition | undefined;
}
