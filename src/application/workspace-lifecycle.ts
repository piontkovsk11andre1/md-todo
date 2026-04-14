import path from "node:path";
import { EXIT_CODE_FAILURE, EXIT_CODE_NO_WORK, EXIT_CODE_SUCCESS } from "../domain/exit-codes.js";
import type { ApplicationOutputPort } from "../domain/ports/output-port.js";
import type { FileSystem } from "../domain/ports/file-system.js";
import type { PathOperationsPort } from "../domain/ports/path-operations-port.js";
import type { WorkingDirectoryPort } from "../domain/ports/working-directory-port.js";
import {
  parseWorkspaceLinkSchema,
  serializeWorkspaceLinkSchema,
  type CanonicalWorkspaceLinkRecord,
} from "../domain/workspace-link.js";

export interface WorkspaceUnlinkOptions {
  workspace?: string;
  all: boolean;
  dryRun: boolean;
}

export interface WorkspaceRemoveOptions {
  workspace?: string;
  all: boolean;
  deleteFiles: boolean;
  dryRun: boolean;
  force: boolean;
}

interface WorkspaceLifecycleDependencies {
  output: ApplicationOutputPort;
  fileSystem: FileSystem;
  pathOperations: PathOperationsPort;
  workingDirectory: WorkingDirectoryPort;
}

export function createWorkspaceUnlinkTask(
  dependencies: WorkspaceLifecycleDependencies,
): (options: WorkspaceUnlinkOptions) => Promise<number> {
  const emit = dependencies.output.emit.bind(dependencies.output);

  return async (options: WorkspaceUnlinkOptions): Promise<number> => {
    if (options.all && typeof options.workspace === "string") {
      emit({
        kind: "error",
        message: "Cannot combine --workspace with --all for workspace unlink.",
      });
      return EXIT_CODE_FAILURE;
    }

    const invocationDir = dependencies.pathOperations.resolve(dependencies.workingDirectory.cwd());
    const workspaceLinkPath = dependencies.pathOperations.join(invocationDir, ".rundown", "workspace.link");
    const workspaceLinkStats = dependencies.fileSystem.stat(workspaceLinkPath);
    if (workspaceLinkStats === null || !workspaceLinkStats.isFile) {
      emit({
        kind: "info",
        message: `No workspace.link found in invocation directory: ${invocationDir}`,
      });
      return EXIT_CODE_NO_WORK;
    }

    const parsedSchema = parseWorkspaceLinkSchema(dependencies.fileSystem.readText(workspaceLinkPath));
    if (parsedSchema.status !== "ok") {
      emit({
        kind: "error",
        message: `workspace.link is invalid: ${workspaceLinkPath}. ${parsedSchema.message}`,
      });
      return EXIT_CODE_FAILURE;
    }

    const selectedRecords = resolveRecordsToUnlink({
      invocationDir,
      workspaceLinkPath,
      records: parsedSchema.schema.records,
      workspaceOption: options.workspace,
      all: options.all,
    });
    if (selectedRecords.status === "error") {
      emit({ kind: "error", message: selectedRecords.message });
      return EXIT_CODE_FAILURE;
    }

    const selectedRecordIds = new Set(selectedRecords.records.map((record) => record.id));
    const remainingRecords = parsedSchema.schema.records.filter((record) => !selectedRecordIds.has(record.id));

    emit({ kind: "text", text: `Invocation directory: ${invocationDir}` });
    emit({ kind: "text", text: `Workspace link file: ${workspaceLinkPath}` });
    emit({ kind: "text", text: "Selected workspace record(s):" });
    for (const record of selectedRecords.records) {
      emit({
        kind: "text",
        text: `  - ${record.id}: ${dependencies.pathOperations.resolve(invocationDir, record.workspacePath)}`,
      });
    }

    if (options.dryRun) {
      emit({
        kind: "info",
        message: `Dry run: ${selectedRecords.records.length} workspace record(s) would be unlinked (metadata only).`,
      });
      emit({
        kind: "info",
        message: "Linked workspace files/directories are not deleted by workspace unlink.",
      });
      return EXIT_CODE_SUCCESS;
    }

    if (remainingRecords.length === 0) {
      dependencies.fileSystem.rm(workspaceLinkPath, { force: true });
      emit({
        kind: "success",
        message: `Unlinked ${selectedRecords.records.length} workspace record(s) and removed empty workspace.link metadata file.`,
      });
      emit({
        kind: "info",
        message: "Linked workspace files/directories were preserved.",
      });
      return EXIT_CODE_SUCCESS;
    }

    const remainingRecordIds = new Set(remainingRecords.map((record) => record.id));
    const nextDefaultRecordId = parsedSchema.schema.defaultRecordId !== undefined
      && remainingRecordIds.has(parsedSchema.schema.defaultRecordId)
      ? parsedSchema.schema.defaultRecordId
      : undefined;
    const serialized = serializeWorkspaceLinkSchema({
      sourceFormat: "multi-record-v1",
      records: remainingRecords.map((record) => ({
        id: record.id,
        workspacePath: record.workspacePath,
        isDefault: nextDefaultRecordId !== undefined && record.id === nextDefaultRecordId,
      })),
      defaultRecordId: nextDefaultRecordId,
    });
    dependencies.fileSystem.writeText(workspaceLinkPath, serialized);

    emit({
      kind: "success",
      message: `Unlinked ${selectedRecords.records.length} workspace record(s). ${remainingRecords.length} record(s) remain in workspace.link.`,
    });
    emit({
      kind: "info",
      message: "Linked workspace files/directories were preserved.",
    });
    return EXIT_CODE_SUCCESS;
  };
}

function resolveRecordsToUnlink(input: {
  invocationDir: string;
  workspaceLinkPath: string;
  records: CanonicalWorkspaceLinkRecord[];
  workspaceOption?: string;
  all: boolean;
}):
  | { status: "ok"; records: CanonicalWorkspaceLinkRecord[] }
  | { status: "error"; message: string } {
  if (input.all) {
    return {
      status: "ok",
      records: input.records,
    };
  }

  const workspaceOption = normalizeOptionalString(input.workspaceOption);
  if (workspaceOption !== undefined) {
    const selectedRecord = pickWorkspaceRecordDeterministically({
      invocationDir: input.invocationDir,
      records: input.records,
      workspaceOption,
    });
    if (!selectedRecord) {
      return {
        status: "error",
        message: buildMissingSelectorMessage({
          invocationDir: input.invocationDir,
          workspaceLinkPath: input.workspaceLinkPath,
          workspaceOption,
          records: input.records,
        }),
      };
    }

    return {
      status: "ok",
      records: [selectedRecord],
    };
  }

  if (input.records.length > 1) {
    return {
      status: "error",
      message: buildAmbiguousSelectionMessage({
        invocationDir: input.invocationDir,
        workspaceLinkPath: input.workspaceLinkPath,
        records: input.records,
      }),
    };
  }

  return {
    status: "ok",
    records: input.records,
  };
}

function pickWorkspaceRecordDeterministically(input: {
  invocationDir: string;
  records: CanonicalWorkspaceLinkRecord[];
  workspaceOption: string;
}): CanonicalWorkspaceLinkRecord | undefined {
  const recordById = input.records.find((record) => record.id === input.workspaceOption);
  if (recordById) {
    return recordById;
  }

  const selectedWorkspacePath = path.resolve(input.invocationDir, input.workspaceOption);
  return input.records.find((record) => path.resolve(input.invocationDir, record.workspacePath) === selectedWorkspacePath);
}

function buildAmbiguousSelectionMessage(input: {
  invocationDir: string;
  workspaceLinkPath: string;
  records: CanonicalWorkspaceLinkRecord[];
}): string {
  return [
    `Workspace unlink selection is ambiguous for ${input.invocationDir}.`,
    `Multiple workspace records are configured in ${input.workspaceLinkPath}.`,
    "Re-run with --workspace <dir|id> to select a specific record, or use --all to unlink every record.",
    "Candidates:",
    ...input.records.map((record) => `- ${record.id}: ${path.resolve(input.invocationDir, record.workspacePath)} (use --workspace ${record.workspacePath})`),
  ].join("\n");
}

function buildMissingSelectorMessage(input: {
  invocationDir: string;
  workspaceLinkPath: string;
  workspaceOption: string;
  records: CanonicalWorkspaceLinkRecord[];
}): string {
  return [
    `No workspace record matches selector "${input.workspaceOption}" in ${input.workspaceLinkPath}.`,
    "Selection is deterministic: record id is matched first, then workspace path.",
    "Candidates:",
    ...input.records.map((record) => `- ${record.id}: ${path.resolve(input.invocationDir, record.workspacePath)} (use --workspace ${record.workspacePath})`),
  ].join("\n");
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function createWorkspaceRemoveTask(
  dependencies: WorkspaceLifecycleDependencies,
): (options: WorkspaceRemoveOptions) => Promise<number> {
  const emit = dependencies.output.emit.bind(dependencies.output);

  return async (options: WorkspaceRemoveOptions): Promise<number> => {
    emit({
      kind: "info",
      message: "Workspace remove command surface is available; remove execution will be implemented in a follow-up migration task.",
    });
    emit({
      kind: "text",
      text: [
        "Requested options:",
        `  workspace: ${options.workspace ?? "(auto)"}`,
        `  all: ${String(options.all)}`,
        `  deleteFiles: ${String(options.deleteFiles)}`,
        `  dryRun: ${String(options.dryRun)}`,
        `  force: ${String(options.force)}`,
      ].join("\n"),
    });
    return EXIT_CODE_NO_WORK;
  };
}
