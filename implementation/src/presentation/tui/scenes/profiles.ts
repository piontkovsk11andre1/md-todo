// @ts-nocheck
import pc from "picocolors";

export function createProfilesSceneState() {
  return {
    config: {},
    configPath: ".rundown/config.json",
    references: [],
    banner: "",
    loading: false,
  };
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function withSectionGap(lines, sectionGap) {
  const gap = Number.isInteger(sectionGap) && sectionGap > 0 ? sectionGap : 0;
  for (let index = 0; index < gap; index += 1) {
    lines.push("");
  }
}

function formatCommandPreview(commandValue) {
  if (!Array.isArray(commandValue)) {
    return "(invalid command)";
  }
  const tokens = commandValue.filter((part) => typeof part === "string");
  if (tokens.length === 0) {
    return "(empty command)";
  }
  return tokens.join(" ");
}

function collectUsageByProfile(references) {
  const byProfile = new Map();
  const entries = Array.isArray(references) ? references : [];

  for (const reference of entries) {
    const profileName = typeof reference?.profile === "string" ? reference.profile : "";
    const kind = typeof reference?.kind === "string" ? reference.kind : "";
    if (profileName.length === 0) {
      continue;
    }
    if (kind !== "frontmatter" && kind !== "directive" && kind !== "prefix") {
      continue;
    }

    if (!byProfile.has(profileName)) {
      byProfile.set(profileName, {
        frontmatter: 0,
        directive: 0,
        prefix: 0,
      });
    }

    const aggregate = byProfile.get(profileName);
    aggregate[kind] += 1;
  }

  return byProfile;
}

export function renderProfilesSceneLines({ state, sectionGap = 1 } = {}) {
  const sceneState = state ?? createProfilesSceneState();
  const config = safeObject(sceneState.config);
  const profiles = safeObject(config.profiles);
  const usageByProfile = collectUsageByProfile(sceneState.references);
  const profileNames = Object.keys(profiles);

  const lines = [
    pc.bold("Profiles"),
    pc.dim(sceneState.configPath || ".rundown/config.json"),
  ];

  if (sceneState.loading) {
    withSectionGap(lines, sectionGap);
    lines.push(pc.dim("Loading profiles..."));
    lines.push(pc.dim("[Esc] Back to menu"));
    return lines;
  }

  if (typeof sceneState.banner === "string" && sceneState.banner.length > 0) {
    withSectionGap(lines, sectionGap);
    const bannerLines = sceneState.banner.split(/\r?\n/);
    for (let index = 0; index < bannerLines.length; index += 1) {
      const prefix = index === 0 ? "! " : "  ";
      lines.push(pc.red(`${prefix}${bannerLines[index]}`));
    }
  }

  withSectionGap(lines, sectionGap);

  if (profileNames.length === 0) {
    lines.push(pc.dim("No profiles defined."));
    withSectionGap(lines, sectionGap);
    lines.push(pc.dim("[Esc] Back to menu"));
    return lines;
  }

  const nameColumnWidth = Math.max(
    8,
    profileNames.reduce((max, name) => Math.max(max, name.length), 0),
  );

  for (const profileName of profileNames) {
    const preview = formatCommandPreview(profiles[profileName]);
    lines.push(`  ${profileName.padEnd(nameColumnWidth, " ")}  ${preview}`);

    const usage = usageByProfile.get(profileName);
    if (!usage) {
      lines.push(pc.dim("            used by: (no references found)"));
      continue;
    }

    lines.push(pc.dim(
      `            used by: ${usage.frontmatter} frontmatter · ${usage.directive} directives · ${usage.prefix} prefix`,
    ));
  }

  withSectionGap(lines, sectionGap);
  lines.push(pc.dim("[Esc] Back to menu"));
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
