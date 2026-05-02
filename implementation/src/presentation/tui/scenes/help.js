import pc from "picocolors";

export function createHelpSceneState() {
  return {};
}

export function renderHelpSceneLines({ sectionGap = 1 } = {}) {
  const lines = [
    pc.bold("Help"),
    pc.dim("Coming in migration 167 - press Esc to go back"),
  ];
  for (let index = 0; index < sectionGap; index += 1) {
    lines.push("");
  }
  lines.push(pc.dim("Placeholder scene only in this migration."));
  return lines;
}

export function handleHelpInput({ rawInput, state } = {}) {
  const isEscape = rawInput === "\u001b";
  const isBackspace = rawInput === "\b" || rawInput === "\u007f";
  if (isEscape || isBackspace) {
    return {
      handled: true,
      state: state ?? createHelpSceneState(),
      backToParent: true,
    };
  }
  return {
    handled: false,
    state: state ?? createHelpSceneState(),
    backToParent: false,
  };
}
