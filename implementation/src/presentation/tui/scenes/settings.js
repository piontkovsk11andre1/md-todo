import pc from "picocolors";

export function createSettingsSceneState() {
  return {};
}

export function renderSettingsSceneLines({ sectionGap = 1 } = {}) {
  const lines = [
    pc.bold("Settings"),
    pc.dim("Coming in migration 166 - press Esc to go back"),
  ];
  for (let index = 0; index < sectionGap; index += 1) {
    lines.push("");
  }
  lines.push(pc.dim("Placeholder scene only in this migration."));
  return lines;
}

export function handleSettingsInput({ rawInput, state } = {}) {
  const isEscape = rawInput === "\u001b";
  const isBackspace = rawInput === "\b" || rawInput === "\u007f";
  if (isEscape || isBackspace) {
    return {
      handled: true,
      state: state ?? createSettingsSceneState(),
      backToParent: true,
    };
  }
  return {
    handled: false,
    state: state ?? createSettingsSceneState(),
    backToParent: false,
  };
}
