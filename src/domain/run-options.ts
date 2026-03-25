export interface RunBehaviorInput {
  validate: boolean;
  onlyValidate: boolean;
  noCorrect: boolean;
  repairAttempts: number;
}

export interface RunBehavior {
  shouldValidate: boolean;
  onlyValidate: boolean;
  allowCorrection: boolean;
  maxRepairAttempts: number;
}

export interface WorkerRequirementInput {
  workerCommand: string[];
  isInlineCli: boolean;
  shouldValidate: boolean;
  onlyValidate: boolean;
}

export function resolveRunBehavior(input: RunBehaviorInput): RunBehavior {
  const maxRepairAttempts = Number.isFinite(input.repairAttempts) && input.repairAttempts > 0
    ? Math.floor(input.repairAttempts)
    : 0;
  const onlyValidate = input.onlyValidate;
  const shouldValidate = input.validate || onlyValidate;
  const allowCorrection = !input.noCorrect && maxRepairAttempts > 0;

  return {
    shouldValidate,
    onlyValidate,
    allowCorrection,
    maxRepairAttempts,
  };
}

export function requiresWorkerCommand(input: WorkerRequirementInput): boolean {
  if (input.workerCommand.length > 0) {
    return false;
  }

  if (input.onlyValidate) {
    return true;
  }

  if (!input.isInlineCli) {
    return true;
  }

  return input.shouldValidate;
}
