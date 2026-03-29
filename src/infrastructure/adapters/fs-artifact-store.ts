import type {
  ArtifactStore,
  ArtifactRunContext,
  ArtifactPhaseHandle,
  ArtifactRunMetadata,
  ArtifactStorePhase,
  ArtifactStoreStatus,
} from "../../domain/ports/artifact-store.js";
import {
  beginRuntimePhase,
  completeRuntimePhase,
  createRuntimeArtifactsContext,
  displayArtifactsPath,
  findSavedRuntimeArtifact,
  finalizeRuntimeArtifacts,
  isFailedRuntimeArtifactStatus,
  latestSavedRuntimeArtifact,
  listFailedRuntimeArtifacts,
  listSavedRuntimeArtifacts,
  removeFailedRuntimeArtifacts,
  removeSavedRuntimeArtifacts,
  runtimeArtifactsRootDir,
  type BeginRuntimePhaseOptions,
  type CompleteRuntimePhaseOptions,
  type RuntimeArtifactsContext,
  type RuntimePhaseHandle,
  type RuntimePhase,
} from "../runtime-artifacts.js";

const toRuntimePhase = (phase: ArtifactStorePhase): RuntimePhase => phase;

export function createFsArtifactStore(): ArtifactStore {
  return {
    createContext(options): ArtifactRunContext {
      return createRuntimeArtifactsContext(options);
    },
    beginPhase(context, options): ArtifactPhaseHandle {
      const runtimeOptions: BeginRuntimePhaseOptions = {
        ...options,
        phase: toRuntimePhase(options.phase),
      };
      return beginRuntimePhase(context as RuntimeArtifactsContext, runtimeOptions);
    },
    completePhase(handle, options): void {
      const runtimeOptions: CompleteRuntimePhaseOptions = options;
      completeRuntimePhase(handle as RuntimePhaseHandle, runtimeOptions);
    },
    finalize(context, options): void {
      finalizeRuntimeArtifacts(context as RuntimeArtifactsContext, {
        status: options.status,
        preserve: options.preserve,
        extra: options.extra,
      });
    },
    displayPath(context): string {
      return displayArtifactsPath(context as RuntimeArtifactsContext);
    },
    rootDir(configDir): string {
      return runtimeArtifactsRootDir(configDir);
    },
    listSaved(configDir): ArtifactRunMetadata[] {
      return listSavedRuntimeArtifacts(configDir);
    },
    listFailed(configDir): ArtifactRunMetadata[] {
      return listFailedRuntimeArtifacts(configDir);
    },
    latest(configDir): ArtifactRunMetadata | null {
      return latestSavedRuntimeArtifact(configDir);
    },
    find(runId, configDir): ArtifactRunMetadata | null {
      return findSavedRuntimeArtifact(runId, configDir);
    },
    removeSaved(configDir): number {
      return removeSavedRuntimeArtifacts(configDir);
    },
    removeFailed(configDir): number {
      return removeFailedRuntimeArtifacts(configDir);
    },
    isFailedStatus(status: ArtifactStoreStatus | undefined): boolean {
      return isFailedRuntimeArtifactStatus(status);
    },
  };
}
