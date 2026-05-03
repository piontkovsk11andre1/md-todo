import pc from "picocolors";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { getAgentsTemplate } from "../../../domain/agents-template.js";
import { createConfigBridge } from "../bridges/config-bridge.js";
import {
  createPagerState,
  handlePagerInput,
  renderPagerLines,
} from "../components/pager.js";

const FIXED_LOCAL_DOCS = Object.freeze(["README.md", "roadmap.md"]);

const EXTERNAL_LINKS = Object.freeze([
  { id: "website", label: "Project website", url: "https://github.com" },
  { id: "changelog", label: "Changelog", url: "https://github.com" },
  { id: "issues", label: "Issue tracker", url: "https://github.com/issues" },
]);

function getExternalLinkById(linkId) {
  if (typeof linkId !== "string" || linkId.length === 0) {
    return null;
  }
  for (const link of EXTERNAL_LINKS) {
    if (link.id === linkId) {
      return link;
    }
  }
  return null;
}

function openExternalUrl(url) {
  if (typeof url !== "string" || url.length === 0) {
    return false;
  }

  if (process.platform === "win32") {
    const child = spawn("cmd", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      shell: false,
    });
    child.unref();
    return true;
  }

  if (process.platform === "darwin") {
    const child = spawn("open", [url], {
      detached: true,
      stdio: "ignore",
      shell: false,
    });
    child.unref();
    return true;
  }

  if (process.platform === "linux") {
    const child = spawn("xdg-open", [url], {
      detached: true,
      stdio: "ignore",
      shell: false,
    });
    child.unref();
    return true;
  }

  return false;
}

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

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function flattenConfigEntries(config, prefix = "") {
  const entries = [];
  const source = safeObject(config);
  const keys = Object.keys(source);
  for (const key of keys) {
    const value = source[key];
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      const nested = flattenConfigEntries(value, fullKey);
      if (nested.length === 0) {
        entries.push({ key: fullKey, value });
      } else {
        entries.push(...nested);
      }
      continue;
    }
    entries.push({ key: fullKey, value });
  }
  return entries;
}

function formatValueOneLine(value) {
  try {
    const text = JSON.stringify(value);
    return typeof text === "string" ? text : String(value);
  } catch {
    return String(value);
  }
}

function formatEffectiveConfigDump({ config, sources }) {
  const entries = flattenConfigEntries(config);
  if (entries.length === 0) {
    return "No effective configuration values found.";
  }
  const sourceMap = safeObject(sources);
  return entries
    .map((entry) => {
      const valueText = formatValueOneLine(entry.value);
      const source = sourceMap[entry.key];
      const sourceSuffix = typeof source === "string" && source.length > 0 ? `  // ${source}` : "";
      return `${entry.key} = ${valueText}${sourceSuffix}`;
    })
    .join("\n");
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

function isExistingFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function existingFixedLocalDocs(workspaceRoot) {
  const rows = [];
  for (const fileName of FIXED_LOCAL_DOCS) {
    const absolutePath = path.join(workspaceRoot, fileName);
    if (isExistingFile(absolutePath)) {
      rows.push(fileName);
    }
  }
  return rows;
}

function buildHelpRows(workspaceRoot) {
  const rows = [];
  const localDocs = [];
  const seen = new Set();
  for (const docPath of [...existingFixedLocalDocs(workspaceRoot), ...listDocsMarkdownFiles(workspaceRoot)]) {
    if (seen.has(docPath)) {
      continue;
    }
    seen.add(docPath);
    localDocs.push(docPath);
  }

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
      target: link.id,
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
    pager: null,
  };
}

export async function runHelpSceneAction({ action, state } = {}) {
  const sceneState = state ?? createHelpSceneState();
  if (!action || typeof action !== "object") {
    return sceneState;
  }

  if (action.type === "open-synthesized-effective-config") {
    const bridge = createConfigBridge({ cwd: sceneState.workspaceRoot });
    try {
      const listed = await bridge.listEffective();
      const content = formatEffectiveConfigDump({
        config: listed?.config,
        sources: listed?.sources,
      });
      return {
        ...sceneState,
        pager: createPagerState({
          title: "Help",
          filePath: "Effective config dump",
          content,
        }),
      };
    } catch (error) {
      const message = error instanceof Error && error.message
        ? error.message
        : String(error ?? "Unknown error");
      return {
        ...sceneState,
        pager: createPagerState({
          title: "Help",
          filePath: "Effective config dump",
          content: `Unable to load effective config.\n\n${message}`,
        }),
      };
    }
  }

  if (action.type === "open-external-link") {
    const link = getExternalLinkById(action.linkId);
    if (!link) {
      return sceneState;
    }

    try {
      const opened = openExternalUrl(link.url);
      return {
        ...sceneState,
        banner: opened ? `Opened ${link.label} in your browser.` : `Open this URL manually: ${link.url}`,
      };
    } catch {
      return {
        ...sceneState,
        banner: `Open this URL manually: ${link.url}`,
      };
    }
  }

  return sceneState;
}

export function renderHelpSceneLines({ state, sectionGap = 1 } = {}) {
  const sceneState = state ?? createHelpSceneState();
  if (sceneState.pager) {
    return renderPagerLines({ state: sceneState.pager });
  }
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
  if (typeof sceneState.banner === "string" && sceneState.banner.length > 0) {
    lines.push(pc.dim(sceneState.banner));
    withSectionGap(lines, sectionGap);
  }
  lines.push(pc.dim("[↵] view in pager   [o] open in browser   [Esc] back"));
  return lines;
}

export function handleHelpInput({ rawInput, state } = {}) {
  const sceneState = state ?? createHelpSceneState();

  if (sceneState.pager) {
    const pagerResult = handlePagerInput({ rawInput, state: sceneState.pager });
    if (pagerResult.backToParent) {
      return {
        handled: true,
        state: {
          ...sceneState,
          pager: null,
        },
        backToParent: false,
      };
    }
    return {
      handled: pagerResult.handled,
      state: {
        ...sceneState,
        pager: pagerResult.state,
      },
      backToParent: false,
    };
  }

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

  if (input === "\r" || input === "\n") {
    const selectedRow = rows[selectedIndex];
    if (selectedRow?.kind === "local-doc" && typeof selectedRow.target === "string") {
      const absolutePath = path.join(sceneState.workspaceRoot, selectedRow.target);
      let content = "";
      try {
        content = fs.readFileSync(absolutePath, "utf8");
      } catch {
        content = "Unable to read this file.";
      }

      return {
        handled: true,
        state: {
          ...sceneState,
          pager: createPagerState({
            title: "Help",
            filePath: selectedRow.target,
            content,
          }),
        },
        backToParent: false,
      };
    }

    if (selectedRow?.kind === "synthetic-agents-template") {
      return {
        handled: true,
        state: {
          ...sceneState,
          pager: createPagerState({
            title: "Help",
            filePath: "AGENTS.md template",
            content: getAgentsTemplate(),
          }),
        },
        backToParent: false,
      };
    }

    if (selectedRow?.kind === "synthetic-effective-config") {
      return {
        handled: true,
        state: sceneState,
        backToParent: false,
        action: { type: "open-synthesized-effective-config" },
      };
    }

    return {
      handled: false,
      state: sceneState,
      backToParent: false,
    };
  }

  if (input === "o" || input === "O") {
    const selectedRow = rows[selectedIndex];
    if (selectedRow?.kind === "external-link" && typeof selectedRow.target === "string") {
      return {
        handled: true,
        state: {
          ...sceneState,
          banner: "",
        },
        backToParent: false,
        action: {
          type: "open-external-link",
          linkId: selectedRow.target,
        },
      };
    }
    return {
      handled: true,
      state: {
        ...sceneState,
        banner: "",
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
