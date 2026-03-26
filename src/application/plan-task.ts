import { DEFAULT_PLAN_TEMPLATE, getTraceInstructions } from "../domain/defaults.js";
import { insertSubitems, parsePlannerOutput } from "../domain/planner.js";
import type { Task } from "../domain/parser.js";
import type { SortMode } from "../domain/sorting.js";
import { renderTemplate, type TemplateVars } from "../domain/template.js";
import {
  parseCliTemplateVars,
  resolveTemplateVarsFilePath,
  type ExtraTemplateVars,
} from "../domain/template-vars.js";
import {
  createOutputVolumeEvent,
  createPhaseCompletedEvent,
  createPhaseStartedEvent,
  createRunCompletedEvent,
  createRunStartedEvent,
  type TraceRunStatus,
} from "../domain/trace.js";
import type {
  ArtifactStoreStatus,
  ArtifactRunContext,
  ArtifactStore,
  FileSystem,
  PathOperationsPort,
  ProcessRunMode,
  SourceResolverPort,
  TaskSelectionResult as PortTaskSelectionResult,
  TaskSelectorPort,
  TemplateLoader,
  TemplateVarsLoaderPort,
  TraceWriterPort,
  WorkerExecutorPort,
  WorkingDirectoryPort,
} from "../domain/ports/index.js";
import type { ApplicationOutputPort } from "../domain/ports/output-port.js";

export type RunnerMode = ProcessRunMode;
export type PromptTransport = "file" | "arg";
type ArtifactContext = ArtifactRunContext;

export type TaskSelectionResult = PortTaskSelectionResult;

export interface PlanTaskDependencies {
  sourceResolver: SourceResolverPort;
  taskSelector: TaskSelectorPort;
  workerExecutor: WorkerExecutorPort;
  workingDirectory: WorkingDirectoryPort;
  fileSystem: FileSystem;
  pathOperations: PathOperationsPort;
  templateVarsLoader: TemplateVarsLoaderPort;
  templateLoader: TemplateLoader;
  artifactStore: ArtifactStore;
  traceWriter: TraceWriterPort;
  createTraceWriter: (trace: boolean, artifactContext: ArtifactContext) => TraceWriterPort;
  output: ApplicationOutputPort;
}

export interface PlanTaskOptions {
  source: string;
  at?: string;
  mode: RunnerMode;
  transport: PromptTransport;
  sortMode: SortMode;
  dryRun: boolean;
  printPrompt: boolean;
  keepArtifacts: boolean;
  varsFileOption: string | boolean | undefined;
  cliTemplateVarArgs: string[];
  workerCommand: string[];
  trace: boolean;
}

export function createPlanTask(
  dependencies: PlanTaskDependencies,
): (options: PlanTaskOptions) => Promise<number> {
  const emit = dependencies.output.emit.bind(dependencies.output);

  return async function planTask(options: PlanTaskOptions): Promise<number> {
    const {
      source,
      at,
      mode,
      transport,
      sortMode,
      dryRun,
      printPrompt,
      keepArtifacts,
      varsFileOption,
      cliTemplateVarArgs,
      workerCommand,
      trace,
    } = options;

    const varsFilePath = resolveTemplateVarsFilePath(varsFileOption);
    const cwd = dependencies.workingDirectory.cwd();
    const fileTemplateVars = varsFilePath
      ? dependencies.templateVarsLoader.load(varsFilePath, cwd)
      : {};
    const cliTemplateVars = parseCliTemplateVars(cliTemplateVarArgs);
    const extraTemplateVars: ExtraTemplateVars = {
      ...fileTemplateVars,
      ...cliTemplateVars,
    };

    const selection = await selectPlanTask(source, at, sortMode, dependencies, emit);
    if (!selection.result) {
      return selection.exitCode;
    }

    const { task, source: fileSource, contextBefore } = selection.result;
    emit({
      kind: "info",
      message: "Planning task: " + formatTaskLabel(task),
    });

    if (workerCommand.length === 0) {
      emit({
        kind: "error",
        message: "No worker command specified. Use --worker <command...> or -- <command>.",
      });
      return 1;
    }

    const planTemplate = loadPlanTemplateFromPorts(cwd, dependencies.templateLoader, dependencies.pathOperations);

    const vars: TemplateVars = {
      ...extraTemplateVars,
      traceInstructions: getTraceInstructions(trace),
      task: task.text,
      file: task.file,
      context: contextBefore,
      taskIndex: task.index,
      taskLine: task.line,
      source: fileSource,
    };

    const prompt = renderTemplate(planTemplate, vars);

    if (printPrompt) {
      emit({ kind: "text", text: prompt });
      return 0;
    }

    if (dryRun) {
      emit({ kind: "info", message: "Dry run — would plan: " + workerCommand.join(" ") });
      emit({ kind: "info", message: "Prompt length: " + prompt.length + " chars" });
      return 0;
    }

    const artifactContext = dependencies.artifactStore.createContext({
      cwd,
      commandName: "plan",
      workerCommand,
      mode,
      transport,
      source,
      task: {
        text: task.text,
        file: task.file,
        line: task.line,
        index: task.index,
        source: fileSource,
      },
      keepArtifacts,
    });
    const traceWriter = dependencies.createTraceWriter(trace, artifactContext);
    let artifactsFinalized = false;
    let artifactStatus: ArtifactStoreStatus = "running";
    let tracePhaseCount = 0;
    let traceCompleted = false;
    const traceStartedAtMs = Date.now();

    const nowIso = (): string => new Date().toISOString();
    const toTraceStatus = (status: ArtifactStoreStatus): TraceRunStatus => status;

    traceWriter.write(createRunStartedEvent({
      timestamp: nowIso(),
      run_id: artifactContext.runId,
      payload: {
        command: "plan",
        source,
        worker: workerCommand,
        mode,
        transport,
        task_text: task.text,
        task_file: task.file,
        task_line: task.line,
      },
    }));

    const beginPlanPhaseTrace = (command: string[]): { sequence: number; startedAtMs: number } => {
      const sequence = tracePhaseCount + 1;
      tracePhaseCount = sequence;
      traceWriter.write(createPhaseStartedEvent({
        timestamp: nowIso(),
        run_id: artifactContext.runId,
        payload: {
          phase: "plan",
          sequence,
          command,
        },
      }));

      return { sequence, startedAtMs: Date.now() };
    };

    const completePlanPhaseTrace = (
      phaseTrace: { sequence: number; startedAtMs: number },
      exitCode: number | null,
      stdout: string,
      stderr: string,
      outputCaptured: boolean,
    ): void => {
      const timestamp = nowIso();
      traceWriter.write(createPhaseCompletedEvent({
        timestamp,
        run_id: artifactContext.runId,
        payload: {
          phase: "plan",
          sequence: phaseTrace.sequence,
          exit_code: exitCode,
          duration_ms: Math.max(0, Date.now() - phaseTrace.startedAtMs),
          stdout_bytes: Buffer.byteLength(stdout, "utf8"),
          stderr_bytes: Buffer.byteLength(stderr, "utf8"),
          output_captured: outputCaptured,
        },
      }));
      traceWriter.write(createOutputVolumeEvent({
        timestamp,
        run_id: artifactContext.runId,
        payload: {
          phase: "plan",
          sequence: phaseTrace.sequence,
          stdout_bytes: Buffer.byteLength(stdout, "utf8"),
          stderr_bytes: Buffer.byteLength(stderr, "utf8"),
          stdout_lines: countTraceLines(stdout),
          stderr_lines: countTraceLines(stderr),
        },
      }));
    };

    const completeTraceRun = (status: ArtifactStoreStatus): void => {
      if (traceCompleted) {
        return;
      }

      traceWriter.write(createRunCompletedEvent({
        timestamp: nowIso(),
        run_id: artifactContext.runId,
        payload: {
          status: toTraceStatus(status),
          total_duration_ms: Math.max(0, Date.now() - traceStartedAtMs),
          total_phases: tracePhaseCount,
        },
      }));
      traceCompleted = true;
    };

    const finishPlan = (code: number, status: ArtifactStoreStatus): number => {
      artifactStatus = status;
      completeTraceRun(status);
      traceWriter.flush();
      finalizePlanArtifacts(dependencies.artifactStore, artifactContext, keepArtifacts, artifactStatus, emit);
      artifactsFinalized = true;
      return code;
    };

    try {
      emit({
        kind: "info",
        message: "Running planner: " + workerCommand.join(" ") + " [mode=" + mode + ", transport=" + transport + "]",
      });
      const planPhaseTrace = beginPlanPhaseTrace(workerCommand);
      const runResult = await dependencies.workerExecutor.runWorker({
        command: workerCommand,
        prompt,
        mode,
        transport,
        trace,
        cwd,
        artifactContext,
        artifactPhase: "plan",
      });
      completePlanPhaseTrace(
        planPhaseTrace,
        runResult.exitCode,
        runResult.stdout,
        runResult.stderr,
        mode === "wait",
      );

      if (mode === "wait" && runResult.stderr) {
        emit({ kind: "stderr", text: runResult.stderr });
      }

      if (runResult.exitCode !== 0 && runResult.exitCode !== null) {
        emit({ kind: "error", message: "Planner worker exited with code " + runResult.exitCode + "." });
        return finishPlan(1, "execution-failed");
      }

      if (!runResult.stdout || runResult.stdout.trim().length === 0) {
        emit({ kind: "warn", message: "Planner produced no output. No subtasks created." });
        return finishPlan(0, "completed");
      }

      const count = applyPlannerOutputWithFileSystem(task, runResult.stdout, dependencies.fileSystem);
      if (count === 0) {
        emit({ kind: "warn", message: "Planner output contained no valid task items. No subtasks created." });
        return finishPlan(0, "completed");
      }

      emit({
        kind: "success",
        message: "Inserted " + count + " subtask" + (count === 1 ? "" : "s") + " under: " + task.text,
      });
      return finishPlan(0, "completed");
    } finally {
      if (!artifactsFinalized) {
        const finalStatus = artifactStatus === "running" ? "failed" : artifactStatus;
        completeTraceRun(finalStatus);
        traceWriter.flush();
        finalizePlanArtifacts(dependencies.artifactStore, artifactContext, keepArtifacts, finalStatus, emit);
        artifactsFinalized = true;
      }
    }
  };
}

async function selectPlanTask(
  source: string,
  at: string | undefined,
  sortMode: SortMode,
  dependencies: PlanTaskDependencies,
  emit: ApplicationOutputPort["emit"],
): Promise<{ result: TaskSelectionResult | null; exitCode: number }> {
  if (at) {
    const parsed = parseTaskLocation(at);
    if (parsed.kind === "invalid-format") {
      emit({ kind: "error", message: "Invalid --at format. Expected file:line (e.g. roadmap.md:12)." });
      return { result: null, exitCode: 1 };
    }

    if (parsed.kind === "invalid-line") {
      emit({ kind: "error", message: "Invalid line number in --at: " + parsed.lineRaw });
      return { result: null, exitCode: 1 };
    }

    const { filePath, lineNum } = parsed;
    const selected = dependencies.taskSelector.selectTaskByLocation(filePath, lineNum);
    if (!selected) {
      emit({ kind: "error", message: "No task found at " + filePath + ":" + lineNum });
      return { result: null, exitCode: 3 };
    }

    return { result: selected, exitCode: 0 };
  }

  const files = await dependencies.sourceResolver.resolveSources(source);
  if (files.length === 0) {
    emit({ kind: "warn", message: "No Markdown files found matching: " + source });
    return { result: null, exitCode: 3 };
  }

  const selected = dependencies.taskSelector.selectNextTask(files, sortMode);
  if (!selected) {
    emit({ kind: "info", message: "No unchecked tasks found." });
    return { result: null, exitCode: 3 };
  }

  return { result: selected, exitCode: 0 };
}

function formatTaskLabel(task: Task): string {
  return `${task.file}:${task.line} [#${task.index}] ${task.text}`;
}

function parseTaskLocation(
  value: string,
):
  | { kind: "ok"; filePath: string; lineNum: number }
  | { kind: "invalid-format" }
  | { kind: "invalid-line"; lineRaw: string } {
  const colonIdx = value.lastIndexOf(":");
  if (colonIdx === -1) {
    return { kind: "invalid-format" };
  }

  const filePath = value.slice(0, colonIdx);
  const lineRaw = value.slice(colonIdx + 1);
  const lineNum = Number.parseInt(lineRaw, 10);
  if (!Number.isFinite(lineNum) || lineNum < 1) {
    return { kind: "invalid-line", lineRaw };
  }

  return { kind: "ok", filePath, lineNum };
}

export const planTask = createPlanTask;

function countTraceLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  return text.split(/\r?\n/).length;
}

function finalizePlanArtifacts(
  artifactStore: ArtifactStore,
  artifactContext: ArtifactContext,
  preserve: boolean,
  status: ArtifactStoreStatus,
  emit: ApplicationOutputPort["emit"],
): void {
  artifactStore.finalize(artifactContext, {
    status,
    preserve,
  });

  if (preserve) {
    emit({
      kind: "info",
      message: "Runtime artifacts saved at "
        + artifactStore.displayPath(artifactContext)
        + ".",
    });
  }
}

function loadPlanTemplateFromPorts(
  cwd: string,
  templateLoader: TemplateLoader,
  pathOperations: PathOperationsPort,
): string {
  return templateLoader.load(pathOperations.join(cwd, ".rundown", "plan.md")) ?? DEFAULT_PLAN_TEMPLATE;
}

function applyPlannerOutputWithFileSystem(
  task: Task,
  plannerOutput: string,
  fileSystem: FileSystem,
): number {
  const subitemLines = parsePlannerOutput(plannerOutput);
  if (subitemLines.length === 0) {
    return 0;
  }

  const source = fileSystem.readText(task.file);
  const updated = insertSubitems(source, task, subitemLines);
  fileSystem.writeText(task.file, updated);

  return subitemLines.length;
}
