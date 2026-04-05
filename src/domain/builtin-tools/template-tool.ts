import type { ToolHandlerFn } from "../ports/tool-handler-port.js";
import type { ProcessRunMode } from "../ports/process-runner.js";
import { buildTaskHierarchyTemplateVars, renderTemplate, type TemplateVars } from "../template.js";
import { parseUncheckedTodoLines } from "../todo-lines.js";

/**
 * Built-in handler for `.md` template tools (the default tool-expansion behavior).
 *
 * Renders the tool's Markdown template with task context variables, executes
 * the worker, parses stdout for child TODO lines, and returns them for insertion.
 */
export function createTemplateToolHandler(template: string): ToolHandlerFn {
  return async (context) => {
    const source = context.source;

    const vars: TemplateVars = {
      ...context.templateVars,
      task: context.task.text,
      payload: context.payload,
      file: context.task.file,
      context: context.contextBefore,
      taskIndex: context.task.index,
      taskLine: context.task.line,
      source,
      ...buildTaskHierarchyTemplateVars(context.task),
    };
    const renderedPrompt = renderTemplate(template, vars);

    const runResult = await context.workerExecutor.runWorker({
      workerPattern: context.workerPattern,
      prompt: renderedPrompt,
      mode: context.mode as ProcessRunMode,
      trace: context.trace,
      cwd: context.cwd,
      env: context.executionEnv,
      configDir: context.configDir,
      artifactContext: context.artifactContext,
      artifactPhase: "execute",
    });

    if (runResult.exitCode !== 0 && runResult.exitCode !== null) {
      return {
        exitCode: runResult.exitCode,
        failureMessage: "Tool expansion worker exited with code " + runResult.exitCode + ".",
        failureReason: "Tool expansion worker exited with a non-zero code.",
      };
    }

    if (context.showAgentOutput) {
      if (runResult.stdout) {
        context.emit({ kind: "text", text: runResult.stdout });
      }
      if (runResult.stderr) {
        context.emit({ kind: "stderr", text: runResult.stderr });
      }
    }

    const childTasks = parseUncheckedTodoLines(runResult.stdout);
    return {
      skipExecution: true,
      shouldVerify: false,
      childTasks,
    };
  };
}
