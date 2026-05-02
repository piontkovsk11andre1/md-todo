import pc from "picocolors";
import readline from "node:readline";

export const SPINNER_FRAMES = ["-", "\\", "|", "/"];

function orange(text) {
  return "\u001B[38;5;208m" + text + "\u001B[39m";
}

function truncatePlain(text, maxLength) {
  const value = String(text);
  if (maxLength <= 0) {
    return "";
  }
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength === 1) {
    return ".";
  }
  return `${value.slice(0, maxLength - 1)}...`;
}

function formatMainMenuLine(row, viewportColumns) {
  const width = Math.max(40, Number.isFinite(viewportColumns) ? viewportColumns - 4 : 76);
  const marker = row.isActive ? ">" : " ";
  const leftRaw = `${marker} ${row.index + 1}. ${row.label}`;
  const rightRaw = row.statusText || "...";
  const minGap = 2;
  const maxLeft = Math.max(12, width - rightRaw.length - minGap);
  const left = truncatePlain(leftRaw, maxLeft);
  const gap = Math.max(minGap, width - left.length - rightRaw.length);
  const line = `${left}${" ".repeat(gap)}${rightRaw}`;
  return row.isActive ? pc.yellow(pc.bold(line)) : pc.white(line);
}

function pushGap(lines, count) {
  for (let index = 0; index < count; index += 1) {
    lines.push("");
  }
}

function resolveLayoutSpacing(viewportRows) {
  if (Number.isFinite(viewportRows) && viewportRows > 0 && viewportRows < 34) {
    return {
      afterBanner: 1,
      afterStatus: 0,
      sectionGap: 1,
      hintGap: 1,
      beforeFooter: 1,
    };
  }
  return {
    afterBanner: 2,
    afterStatus: 1,
    sectionGap: 1,
    hintGap: 1,
    beforeFooter: 1,
  };
}

export function renderStatusBadge(sceneId, continueUiState, spinner, agentSessionPending) {
  if (sceneId === "continue") {
    if (continueUiState === "running") {
      return `${pc.black(pc.bgYellow(" RUNNING "))} ${pc.bold(spinner)}`;
    }
    if (continueUiState === "done") {
      return pc.black(pc.bgGreen(" DONE "));
    }
    if (continueUiState === "failed") {
      return pc.black(pc.bgRed(" FAILED "));
    }
    if (continueUiState === "materialize-form" || continueUiState === "materialize-confirm") {
      return pc.black(pc.bgCyan(" WAITING INPUT "));
    }
  }
  if (sceneId === "newWork" && agentSessionPending) {
    return `${pc.black(pc.bgYellow(" RUNNING "))} ${pc.bold(spinner)}`;
  }
  return pc.black(pc.bgBlue(" READY "));
}

function buildHelpOverlayLines() {
  return [
    pc.bold("Help"),
    pc.dim("Placeholder overlay for this migration."),
    pc.dim("Up/Down or j/k: navigate menu"),
    pc.dim("Enter: select"),
    pc.dim("Esc/Backspace: go back"),
    pc.dim("1-9: jump to item"),
    pc.dim("q or Ctrl-C: quit"),
    pc.dim("Press Esc, Backspace, ?, or h to close help."),
  ];
}

export function formatDuration(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(remainingSeconds).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function formatTimestamp(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "--";
  }
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function progressBar(width, ratio) {
  const safeRatio = Math.max(0, Math.min(1, ratio));
  const complete = Math.round(width * safeRatio);
  const done = "#".repeat(complete);
  const pending = "-".repeat(Math.max(0, width - complete));
  return `[${pc.green(done)}${pc.dim(pending)}]`;
}

export function formatTaskLines(kind, task, checked, tone) {
  const isMuted = tone === "muted";
  const label = isMuted ? pc.dim(kind.padEnd(8, " ")) : kind.padEnd(8, " ");
  const tokenStyle = (() => {
    if (kind === "previous") {
      return pc.green;
    }
    if (kind === "current") {
      return orange;
    }
    return pc.dim;
  })();
  const textStyle = isMuted ? pc.dim : pc.white;

  if (!task) {
    return [`${label} ${pc.dim("(none)")}`];
  }

  const checkbox = checked ? "[x]" : "[ ]";
  const textLines = task.textLines && task.textLines.length > 0 ? task.textLines : [""];
  const [firstLine, ...restLines] = textLines;
  const lines = [
    `${label} ${tokenStyle(String(task.line).padStart(3, "0"))} ${tokenStyle("-")} ${tokenStyle(checkbox)} ${textStyle(firstLine)}`,
  ];
  restLines.forEach((lineText, index) => {
    const lineNumber = task.line + index + 1;
    lines.push(`${" ".repeat(8)} ${tokenStyle(String(lineNumber).padStart(3, "0"))}     ${textStyle(lineText)}`);
  });
  return lines;
}

export function formatMaterializeModeLine(mode, activeMode) {
  const isActive = mode.id === activeMode;
  const keyToken = isActive ? pc.black(pc.bgYellow(` ${mode.key} `)) : pc.cyan(`[${mode.key}]`);
  const label = isActive ? pc.bold(pc.yellow(mode.label)) : pc.white(mode.label);
  return `${keyToken} ${label}`;
}

export function getSceneSpacing(viewportRows) {
  const spacing = resolveLayoutSpacing(viewportRows);
  return {
    sectionGap: spacing.sectionGap,
    hintGap: spacing.hintGap,
    errorGap: spacing.hintGap,
  };
}

export function buildFrame({
  sceneId,
  statusToken,
  viewportRows,
  viewportColumns,
  mainMenuRows,
  mainMenuHint,
  showHelpOverlay,
  sceneLines,
}) {
  const spacing = resolveLayoutSpacing(viewportRows);
  const banner = [
    "██████  ██   ██ ███    ██ ██████   ██████  ██     ██ ███    ██",
    "██   ██ ██   ██ ████   ██ ██   ██ ██    ██ ██     ██ ████   ██",
    "██████  ██   ██ ██ ██  ██ ██   ██ ██    ██ ██  █  ██ ██ ██  ██",
    "██   ██ ██   ██ ██  ██ ██ ██   ██ ██    ██ ██ ███ ██ ██  ██ ██",
    "██   ██  █████  ██   ████ ██████   ██████   ███ ███  ██   ████",
  ].map((line) => pc.bold(pc.magenta(line)));

  const lines = [...banner];
  pushGap(lines, spacing.afterBanner);
  lines.push(`${pc.bold("Status:")} ${statusToken}`, pc.dim("=".repeat(74)));
  pushGap(lines, spacing.afterStatus);

  if (sceneId === "mainMenu") {
    lines.push(
      `${pc.bold("Main Menu:")} ${pc.white("Choose where to go.")}`,
      pc.dim("Enter to open, Up/Down or j/k to move, 1-9 to jump."),
    );
    pushGap(lines, spacing.sectionGap);
    lines.push(...mainMenuRows.map((row) => formatMainMenuLine(row, viewportColumns)));
    if (mainMenuHint) {
      pushGap(lines, spacing.hintGap);
      lines.push(pc.yellow(mainMenuHint));
    }
  } else {
    lines.push(...sceneLines);
  }

  if (showHelpOverlay) {
    pushGap(lines, spacing.sectionGap);
    lines.push(pc.dim("-".repeat(74)), ...buildHelpOverlayLines());
  }

  pushGap(lines, spacing.beforeFooter);
  lines.push(pc.dim("Press ?/h for help, Esc/Backspace to go back, q or Ctrl+C to quit."));
  return lines;
}

export function render(lines, previousLineCount) {
  if (!process.stdout.isTTY) {
    process.stdout.write(lines.join("\n") + "\n");
    return lines.length;
  }
  if (previousLineCount > 0) {
    readline.moveCursor(process.stdout, 0, -previousLineCount);
  }
  readline.cursorTo(process.stdout, 0);
  readline.clearScreenDown(process.stdout);
  process.stdout.write(lines.join("\n") + "\n");
  return lines.length;
}

export function withCursorHidden() {
  if (!process.stdout.isTTY) {
    return () => {};
  }
  process.stdout.write("\u001B[?25l");
  return () => {
    process.stdout.write("\u001B[?25h");
  };
}
