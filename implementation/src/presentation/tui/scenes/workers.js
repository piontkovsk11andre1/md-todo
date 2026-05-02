import pc from "picocolors";

export function createWorkersSceneState() {
  return {};
}

export function renderWorkersSceneLines({ sectionGap = 1 } = {}) {
  const lines = [
    pc.bold("Workers"),
    pc.dim("Coming in migration 162 - press Esc to go back"),
  ];
  for (let index = 0; index < sectionGap; index += 1) {
    lines.push("");
  }
  lines.push(pc.dim("Placeholder scene only in this migration."));
  return lines;
}

export function handleWorkersInput({ rawInput, state } = {}) {
  const isEscape = rawInput === "\u001b";
  const isBackspace = rawInput === "\b" || rawInput === "\u007f";
  if (isEscape || isBackspace) {
    return {
      handled: true,
      state: state ?? createWorkersSceneState(),
      backToParent: true,
    };
  }
  return {
    handled: false,
    state: state ?? createWorkersSceneState(),
    backToParent: false,
  };
}
