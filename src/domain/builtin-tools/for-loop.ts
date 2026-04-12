import type { ToolHandlerFn } from "../ports/tool-handler-port.js";
import { getForItemValues, getForCurrentValue } from "../for-loop.js";

/**
 * Built-in for-each loop handler.
 *
 * The full loop orchestration is handled by the application layer. The
 * built-in handler remains a control-flow marker that skips direct worker
 * execution and verification.
 */
export const forLoopHandler: ToolHandlerFn = async (context) => {
  const payload = context.payload.trim();
  if (payload.length === 0) {
    return {
      exitCode: 1,
      failureMessage: "For loop tool requires a non-empty payload.",
      failureReason: "For loop payload is empty.",
    };
  }

  if (context.task.children.length === 0) {
    return {
      exitCode: 1,
      failureMessage: "For loop task requires nested checkbox child tasks.",
      failureReason: "For loop task has no nested checkbox children.",
    };
  }

  const existingItems = getForItemValues(context.task.subItems)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const bakedItems = existingItems.length > 0
    ? existingItems
    : payload
      .split(/[\r\n,]+/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

  if (bakedItems.length === 0) {
    context.emit({ kind: "warn", message: "For loop resolved zero items; completing without iteration." });
    return {
      skipExecution: true,
      shouldVerify: false,
    };
  }

  const existingCurrent = getForCurrentValue(context.task.subItems);
  const metadataLines = bakedItems.map((item) => `for-item: ${item}`);

  context.emit({
    kind: "info",
    message: "For loop baked " + bakedItems.length + " items: " + bakedItems.join(", "),
  });
  context.emit({ kind: "info", message: "For loop current item: " + (existingCurrent ?? bakedItems[0] ?? "") });

  return {
    skipExecution: true,
    shouldVerify: false,
    childTasks: metadataLines,
  };
};
