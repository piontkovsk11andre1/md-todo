import pc from "picocolors";

export function createProfilesSceneState() {
  return {};
}

export function renderProfilesSceneLines({ sectionGap = 1 } = {}) {
  const lines = [
    pc.bold("Profiles"),
    pc.dim("Coming in migration 163 - press Esc to go back"),
  ];
  for (let index = 0; index < sectionGap; index += 1) {
    lines.push("");
  }
  lines.push(pc.dim("Placeholder scene only in this migration."));
  return lines;
}

export function handleProfilesInput({ rawInput, state } = {}) {
  const isEscape = rawInput === "\u001b";
  const isBackspace = rawInput === "\b" || rawInput === "\u007f";
  if (isEscape || isBackspace) {
    return {
      handled: true,
      state: state ?? createProfilesSceneState(),
      backToParent: true,
    };
  }
  return {
    handled: false,
    state: state ?? createProfilesSceneState(),
    backToParent: false,
  };
}
