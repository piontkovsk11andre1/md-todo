import pc from "picocolors";
import fs from "node:fs";
import path from "node:path";

const FIXED_LOCAL_DOCS = Object.freeze(["README.md", "roadmap.md"]);

const EXTERNAL_LINKS = Object.freeze([
  { id: "website", label: "Project website", url: "https://github.com" },
  { id: "changelog", label: "Changelog", url: "https://github.com" },
  { id: "issues", label: "Issue tracker", url: "https://github.com/issues" },
]);

function withSectionGap(lines, sectionGap) {
  const gap = Number.isInteger(sectionGap) && sectionGap > 0 ? sectionGap : 0;
  for (let index = 0; index < gap; index += 1) {
    lines.push("");
  }
}

function clampSelectedIndex(index, length) {
  if (!Number.isInteger(length) || length <= 0) {
    return 0;
  }
  if (!Number.isInteger(index) || index < 0) {
    return 0;
  }
  if (index >= length) {
    return length - 1;
  }
  return index;
}

function listDocsMarkdownFiles(workspaceRoot) {
  const docsDir = path.join(workspaceRoot, "docs");
  let entries;
  try {
    entries = fs.readdirSync(docsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => `docs/${entry.name}`)
    .sort((left, right) => left.localeCompare(right));
}

function existingFixedLocalDocs(workspaceRoot) {
  const rows = [];
  for (const fileName of FIXED_LOCAL_DOCS) {
    const absolutePath = path.join(workspaceRoot, fileName);
    if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
      rows.push(fileName);
    }
  }
  return rows;
}

function buildHelpRows(workspaceRoot) {
  const rows = [];
  const localDocs = [...existingFixedLocalDocs(workspaceRoot), ...listDocsMarkdownFiles(workspaceRoot)];

  for (const docPath of localDocs) {
    rows.push({
      id: `local:${docPath}`,
      section: "Documentation (local)",
      keyHint: "[↵]",
      label: docPath,
      kind: "local-doc",
      target: docPath,
    });
  }

  rows.push({
    id: "synthetic:agents-template",
    section: "Synthesized references",
    keyHint: "[↵]",
    label: "AGENTS.md template (live, via getAgentsTemplate())",
    kind: "synthetic-agents-template",
  });
  rows.push({
    id: "synthetic:effective-config",
    section: "Synthesized references",
    keyHint: "[↵]",
    label: "Effective config dump (current workspace)",
    kind: "synthetic-effective-config",
  });

  for (const link of EXTERNAL_LINKS) {
    rows.push({
      id: `external:${link.id}`,
      section: "External",
      keyHint: "[o]",
      label: link.label,
      kind: "external-link",
      target: link.url,
    });
  }

  rows.push({
    id: "keybindings",
    section: "",
    keyHint: "[k]",
    label: "Keybindings cheatsheet",
    kind: "keybindings",
  });

  return rows;
}

export function createHelpSceneState() {
  const workspaceRoot = process.cwd();
  return {
    workspaceRoot,
    selectedIndex: 0,
    rows: buildHelpRows(workspaceRoot),
  };
}

export function renderHelpSceneLines({ state, sectionGap = 1 } = {}) {
  const sceneState = state ?? createHelpSceneState();
  const workspaceRoot = typeof sceneState.workspaceRoot === "string" && sceneState.workspaceRoot.length > 0
    ? sceneState.workspaceRoot
    : process.cwd();
  const rows = Array.isArray(sceneState.rows) ? sceneState.rows : buildHelpRows(workspaceRoot);
  const selectedIndex = clampSelectedIndex(sceneState.selectedIndex, rows.length);

  const lines = [pc.bold("Help")];
  withSectionGap(lines, sectionGap);

  if (rows.length === 0) {
    lines.push(pc.dim("No help resources found."));
  } else {
    let previousSection = null;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (row.section && row.section !== previousSection) {
        if (previousSection !== null) {
          withSectionGap(lines, sectionGap);
        }
        lines.push(row.section);
        previousSection = row.section;
      }
      const prefix = index === selectedIndex ? "> " : "  ";
      lines.push(`${prefix}${row.keyHint} ${row.label}`);
    }
  }

  withSectionGap(lines, sectionGap);
  lines.push(pc.dim("[↵] view in pager   [o] open in browser   [Esc] back"));
  return lines;
}

export function handleHelpInput({ rawInput, state } = {}) {
  const sceneState = state ?? createHelpSceneState();

  const isEscape = rawInput === "\u001b";
  const isBackspace = rawInput === "\b" || rawInput === "\u007f";
  if (isEscape || isBackspace) {
    return {
      handled: true,
      state: sceneState,
      backToParent: true,
    };
  }

  const input = typeof rawInput === "string" ? rawInput : "";
  const rows = Array.isArray(sceneState.rows) ? sceneState.rows : [];
  const selectedIndex = clampSelectedIndex(sceneState.selectedIndex, rows.length);

  if (input === "\u001b[A" || input === "k") {
    return {
      handled: true,
      state: {
        ...sceneState,
        selectedIndex: clampSelectedIndex(selectedIndex - 1, rows.length),
      },
      backToParent: false,
    };
  }

  if (input === "\u001b[B" || input === "j") {
    return {
      handled: true,
      state: {
        ...sceneState,
        selectedIndex: clampSelectedIndex(selectedIndex + 1, rows.length),
      },
      backToParent: false,
    };
  }

  return {
    handled: false,
    state: sceneState,
    backToParent: false,
  };
}
