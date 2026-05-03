import { expandCliBlocks } from "../domain/cli-block.js";
import type {
  ArtifactRunContext,
  CommandExecutionOptions,
  CommandExecutor,
  TraceWriterPort,
} from "../domain/ports/index.js";
import { withCliTrace } from "./cli-block-handlers.js";

export type ExpandCliBlocksWithOptionsResult =
  | { expandedContent: string }
  | { earlyExitCode: number };

/**
 * Expands CLI blocks for a prompt/source payload while consistently applying
 * trace and artifact options and optionally mapping expansion failures to
 * an early exit code.
 */
export async function expandCliBlocksWithOptions(params: {
  content: string;
  cliExpansionEnabled: boolean;
  cliBlockExecutor: CommandExecutor;
  cwd: string;
  baseCliExpansionOptions: CommandExecutionOptions | undefined;
  artifactContext: ArtifactRunContext | null;
  traceWriter: TraceWriterPort;
  cliTraceRunId: string | undefined;
  nowIso: () => string;
  artifactPhaseLabel:
    | "cli-source"
    | "cli-task-template"
    | "cli-verify-template"
    | "cli-tool-template";
  artifactPromptType:
    | "source"
    | "task-template"
    | "verify-template"
    | "tool-template";
  wrapExecutionOptions: (
    options: CommandExecutionOptions | undefined,
  ) => CommandExecutionOptions | undefined;
  onCliExpansionFailure?: (error: unknown) => Promise<number | null>;
}): Promise<ExpandCliBlocksWithOptionsResult> {
  const {
    content,
    cliExpansionEnabled,
    cliBlockExecutor,
    cwd,
    baseCliExpansionOptions,
    artifactContext,
    traceWriter,
    cliTraceRunId,
    nowIso,
    artifactPhaseLabel,
    artifactPromptType,
    wrapExecutionOptions,
    onCliExpansionFailure,
  } = params;

  if (!cliExpansionEnabled) {
    // Skip expansion entirely when CLI blocks are disabled.
    return { expandedContent: content };
  }

  // Attach artifact metadata so CLI block outputs are grouped by phase and prompt type.
  const optionsWithArtifactContext = artifactContext?.keepArtifacts
    ? {
      ...baseCliExpansionOptions,
      artifactContext,
      artifactPhase: "worker" as const,
      artifactPhaseLabel,
      artifactExtra: {
        ...(baseCliExpansionOptions?.artifactExtra ?? {}),
        promptType: artifactPromptType,
      },
    }
    : baseCliExpansionOptions;
  const optionsWithTrace = withCliTrace(
    optionsWithArtifactContext,
    traceWriter,
    cliTraceRunId,
    nowIso,
  );

  try {
    // Expand all embedded CLI blocks before templates are consumed downstream.
    const expandedContent = await expandCliBlocks(
      content,
      cliBlockExecutor,
      cwd,
      wrapExecutionOptions(optionsWithTrace),
    );
    return { expandedContent };
  } catch (error) {
    if (onCliExpansionFailure) {
      // Allow callers to convert template/source expansion failures into controlled exits.
      const failureCode = await onCliExpansionFailure(error);
      if (failureCode !== null) {
        return { earlyExitCode: failureCode };
      }
    }
    throw error;
  }
}
