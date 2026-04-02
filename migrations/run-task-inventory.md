# run-task.ts inventory and extraction map

This inventory maps each function/type from the original `src/application/run-task.ts` monolith to its extracted destination module, with dependency notes and extraction order.

## Public exports

| Symbol | Kind | Destination module | Dependency note | Order |
|---|---|---|---|---|
| `createRunTask` (now `createRunTaskExecution` re-export) | factory function | `src/application/run-task-execution.ts` | Application orchestrator; depends on all injected ports and shared helpers | 12 |
| `RunTaskDependencies` | interface | `src/application/run-task-execution.ts` | Port bundle type used by orchestrator | 12 |
| `RunTaskOptions` | interface | `src/application/run-task-execution.ts` | CLI/runtime option contract for orchestrator | 12 |
| `RuntimeTaskMetadata` | type | `src/application/run-task-execution.ts` (plus shared usage in `task-context-resolution.ts`) | Serialized task metadata used in runtime artifacts and context resolution | 5 |
| `TaskSelectionResult` | type re-export | `src/application/run-task-execution.ts` | Alias from task selection port types | 12 |
| `RunnerMode` | type re-export | `src/application/run-task-execution.ts` | Runner transport mode alias from ports | 12 |
| `PromptTransport` | type re-export | `src/application/run-task-execution.ts` | Prompt transport alias from ports | 12 |
| `getAutomationWorkerCommand` | pure function | `src/application/run-task-execution.ts` | Worker command normalization helper used by orchestration paths | 12 |
| `isOpenCodeWorkerCommand` | pure function | `src/application/run-task-execution.ts` | Detects OpenCode command shape; used by run/plan flows | 12 |
| `toRuntimeTaskMetadata` | pure function | `src/application/run-task-execution.ts` | Converts `Task` to artifact metadata shape | 5 |
| `finalizeRunArtifacts` | side-effectful function | `src/application/run-lifecycle.ts` (re-exported by `run-task.ts`) | Depends on `ArtifactStore`, run IDs, and artifact payload composition | 10 |

## Extracted internals from original monolith

| Symbol/group | Kind | Destination module | Dependency note | Order |
|---|---|---|---|---|
| `parseJson` | pure utility | `src/application/run-task-utils.ts` | Generic JSON parse with fallback semantics | 1 |
| `asStringArray` | pure utility | `src/application/run-task-utils.ts` | Runtime value normalization helper | 1 |
| `asNonNegativeInt` | pure utility | `src/application/run-task-utils.ts` | Numeric coercion/validation helper | 1 |
| `asEnum` | pure utility | `src/application/run-task-utils.ts` | Enum-like value narrowing helper | 1 |
| `countTraceLines` | pure utility | `src/application/run-task-utils.ts` | Counts output lines for trace metrics | 1 |
| `computeDurationMs` | pure utility | `src/application/run-task-utils.ts` | Timing delta calculator | 1 |
| `formatTaskLabel` | pure utility | `src/application/run-task-utils.ts` | User-facing task label formatter | 1 |
| `isSameFilePath` | pure utility | `src/application/run-task-utils.ts` | Path equality helper for delegation checks | 1 |
| `hasLongOption` | pure utility | `src/application/run-task-utils.ts` | CLI arg inspection helper | 1 |
| `hasLongOptionVariant` | pure utility | `src/application/run-task-utils.ts` | CLI arg inspection helper for `--opt=value` forms | 1 |
| `parseRundownTaskArgs` | helper | `src/application/rundown-delegation.ts` | Depends on delegated arg parsing contract and path ops | 2 |
| `buildDelegatedRundownArgs` | helper | `src/application/rundown-delegation.ts` | Depends on parsed args and worker mode options | 2 |
| `resolveDelegatedRundownTargetArg` | helper | `src/application/rundown-delegation.ts` | Resolves source target path from args | 2 |
| `delegatedTargetExists` | helper | `src/application/rundown-delegation.ts` | Depends on `FileSystem` and `PathOperationsPort` | 2 |
| `normalizeLegacyRetryArgs` | helper | `src/application/rundown-delegation.ts` | Backward-compatible arg normalization | 2 |
| `isGitRepoWithGitClient` | helper | `src/application/git-operations.ts` | Depends on `GitClient` repository introspection | 3 |
| `isWorkingDirectoryClean` | helper | `src/application/git-operations.ts` | Depends on `GitClient.statusPorcelain()` semantics | 3 |
| `commitCheckedTaskWithGitClient` | helper | `src/application/git-operations.ts` | Depends on git add/commit flow and commit message builder | 3 |
| `resolveGitArtifactAndLockExcludes` | helper | `src/application/git-operations.ts` | Depends on config-dir and artifact/lock path policy | 3 |
| `isPathInsideRepo` | helper | `src/application/git-operations.ts` | Depends on path normalization and repo root comparisons | 3 |
| `buildCommitMessage` | helper | `src/application/git-operations.ts` | Pure-ish formatter with task metadata inputs | 3 |
| `loadProjectTemplatesFromPorts` | helper | `src/application/project-templates.ts` | Depends on template loader + defaults for task/discuss/verify/repair/plan/trace | 4 |
| `ProjectTemplates` | interface | `src/application/project-templates.ts` | Template bundle type used across use-cases | 4 |
| `resolveTaskContextFromRuntimeMetadata` | helper | `src/application/task-context-resolution.ts` | Depends on task metadata + source tree lookup | 5 |
| `findTaskByFallback` | helper | `src/application/task-context-resolution.ts` | Depends on traversal/lookup over parsed markdown tasks | 5 |
| `validateRuntimeTaskMetadata` | helper | `src/application/task-context-resolution.ts` | Validation gate for trace/reverify metadata | 5 |
| `resolveLatestCompletedRun` | helper | `src/application/task-context-resolution.ts` | Depends on artifact history filtering | 5 |
| `hasReverifiableTask` | helper | `src/application/task-context-resolution.ts` (internal usage) | Predicate used by completed-run resolution | 5 |
| `isCompletedArtifactRun` / `isCompletedRun` | helper | `src/application/task-context-resolution.ts` (internal usage) | Completion-state predicate for artifact runs | 5 |
| `computeTaskContextMetrics` | helper | `src/application/task-context-resolution.ts` | Computes task subtree metrics for trace enrichment | 5 |
| `hasDescendantTasks` | helper | `src/application/task-context-resolution.ts` (internal usage) | Tree-shape predicate used by metrics | 5 |
| `ResolvedTaskContext` | interface | `src/application/task-context-resolution.ts` | Returned by metadata-to-task resolution flow | 5 |
| `TaskContextMetrics` | interface | `src/application/task-context-resolution.ts` | Structured metrics for context summaries | 5 |
| `checkTaskUsingFileSystem` | helper | `src/application/checkbox-operations.ts` | Depends on `FileSystem` + domain checkbox mutation | 6 |
| `resetFileCheckboxes` | helper | `src/application/checkbox-operations.ts` (internal) | Depends on markdown reset operations on file contents | 6 |
| `maybeResetFileCheckboxes` | helper | `src/application/checkbox-operations.ts` | Conditional reset based on options/state | 6 |
| `countCheckedTasks` | helper | `src/application/checkbox-operations.ts` (internal) | Counter utility over task lists for reset flow | 6 |
| `TemplateCliBlockExecutionError` | class | `src/application/cli-block-handlers.ts` | Specialized error for fenced CLI expansion failures | 7 |
| `withCommandExecutionHandler` | higher-order helper | `src/application/cli-block-handlers.ts` | Composes command execution callbacks around template expansion | 7 |
| `withCliTrace` | higher-order helper | `src/application/cli-block-handlers.ts` | Emits trace events around CLI expansion | 7 |
| `withSourceCliFailureWarning` | higher-order helper | `src/application/cli-block-handlers.ts` | Adds source-specific warning behavior | 7 |
| `withTemplateCliFailureAbort` | higher-order helper | `src/application/cli-block-handlers.ts` | Converts failures to abort behavior where required | 7 |
| `handleTemplateCliFailure` | helper | `src/application/cli-block-handlers.ts` | Shared terminal error handling branch | 7 |
| `activeTraceRun` | state | `src/application/trace-run-session.ts` | Mutable run-session state encapsulated behind lifecycle methods | 8 |
| `startTraceRun` | method/helper | `src/application/trace-run-session.ts` | Initializes trace session state and headers | 8 |
| `beginPhaseTrace` | method/helper | `src/application/trace-run-session.ts` | Opens phase timing/output capture | 8 |
| `completePhaseTrace` | method/helper | `src/application/trace-run-session.ts` | Closes phase and records metrics/artifacts | 8 |
| `emitPromptMetrics` | method/helper | `src/application/trace-run-session.ts` | Emits prompt token/size metrics | 8 |
| `emitTraceTaskOutcome` | method/helper | `src/application/trace-run-session.ts` | Emits task completion/failure outcome events | 8 |
| `emitTraceTimingWaterfall` | method/helper | `src/application/trace-run-session.ts` | Emits phase timing report | 8 |
| `emitTraceRunCompleted` | method/helper | `src/application/trace-run-session.ts` | Emits run completion event and summary | 8 |
| `emitResetPhaseTrace` | method/helper | `src/application/trace-run-session.ts` | Emits reset/repair phase diagnostics | 8 |
| `runTraceEnrichment` | method/helper | `src/application/trace-run-session.ts` | Coordinates post-run enrichment with artifact summaries | 8 |
| `emitDeferredTraceEvents` | method/helper | `src/application/trace-run-session.ts` | Flushes queued/deferred trace records | 8 |
| `collectTracePhaseArtifacts` | helper | `src/application/trace-artifacts.ts` | Reads artifacts and composes per-phase trace payloads | 9 |
| `summarizePhaseAnalyses` | helper | `src/application/trace-artifacts.ts` | Aggregates analysis summaries across phases | 9 |
| `formatPhaseTimingsForTrace` | helper | `src/application/trace-artifacts.ts` | Trace formatter for timing sections | 9 |
| `formatPhaseOutputsForTrace` | helper | `src/application/trace-artifacts.ts` | Trace formatter for output/capture sections | 9 |
| `formatAgentSignalsForTrace` | helper | `src/application/trace-artifacts.ts` | Trace formatter for agent/tool signal data | 9 |
| `formatThinkingBlocksForTrace` | helper | `src/application/trace-artifacts.ts` | Trace formatter for reasoning block summaries | 9 |
| `formatToolUsageForTrace` | helper | `src/application/trace-artifacts.ts` | Trace formatter for tool-usage counters | 9 |
| `parseAnalysisSummaryFromWorkerOutput` | helper | `src/application/trace-artifacts.ts` | Parses structured analysis summaries from worker output | 9 |
| `TracePhaseMetadata` | interface | `src/application/trace-artifacts.ts` | Per-phase metadata type for trace collection | 9 |
| `TracePhaseArtifact` | interface | `src/application/trace-artifacts.ts` | Trace artifact payload type | 9 |
| `PhaseAnalysisSummary` | interface | `src/application/trace-artifacts.ts` | Analysis summary type for reporting | 9 |
| `afterTaskComplete` | lifecycle helper | `src/application/run-lifecycle.ts` | Depends on artifact finalization, git commit option, and hooks | 10 |
| `afterTaskFailed` | lifecycle helper | `src/application/run-lifecycle.ts` | Depends on failure artifact writes and hook dispatch | 10 |
| `runOnCompleteHookWithProcessRunner` | lifecycle helper | `src/application/run-lifecycle.ts` (internal/shared) | Depends on process runner, env wiring, and hook command execution | 10 |
| `failRun` | lifecycle helper | `src/application/run-lifecycle.ts` (internal orchestration) | Failure finalization path used by orchestrator | 10 |
| `finishRun` | lifecycle helper | `src/application/run-lifecycle.ts` (internal orchestration) | Success finalization path used by orchestrator | 10 |
| `resetArtifacts` | lifecycle helper | `src/application/run-lifecycle.ts` (internal orchestration) | Clears transient artifacts for retries/repair loops | 10 |
| `finalizeArtifacts` | lifecycle helper | `src/application/run-lifecycle.ts` (internal orchestration) | Shared artifact write finalizer | 10 |
| `runTraceOnlyEnrichment` | sub-flow | `src/application/trace-only-enrichment.ts` | Depends on task-context resolution + trace-artifact modules + artifact store | 11 |

## Extraction order reference

1. `run-task-utils.ts` (pure utilities)
2. `rundown-delegation.ts`
3. `git-operations.ts`
4. `project-templates.ts`
5. `task-context-resolution.ts`
6. `checkbox-operations.ts`
7. `cli-block-handlers.ts`
8. `trace-run-session.ts`
9. `trace-artifacts.ts`
10. `run-lifecycle.ts`
11. `trace-only-enrichment.ts`
12. `run-task-execution.ts` + thin `run-task.ts` re-export barrel
