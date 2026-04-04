import pc from "picocolors";

export interface AnimationContext {
  skipped?: boolean;
}

export const isTTY = (): boolean => Boolean(process.stdout.isTTY);

export function sleep(ms: number, ctx?: AnimationContext): Promise<void> {
  if (!isTTY() || ms <= 0 || ctx?.skipped) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pause(ms = 400, ctx?: AnimationContext): Promise<void> {
  await sleep(ms, ctx);
}

export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

export async function typeText(text: string, ctx?: AnimationContext, charDelay = 18): Promise<void> {
  if (!isTTY() || ctx?.skipped) {
    process.stdout.write(text);
    return;
  }
  for (let i = 0; i < text.length; i++) {
    process.stdout.write(text[i]);
    await sleep(charDelay, ctx);
    if (ctx?.skipped) {
      const remaining = text.slice(i + 1);
      if (remaining) process.stdout.write(remaining);
      return;
    }
  }
}

export async function typeLine(text: string, ctx?: AnimationContext, charDelay = 18): Promise<void> {
  await typeText(text, ctx, charDelay);
  process.stdout.write("\n");
}

export async function revealLines(lines: string[], ctx?: AnimationContext, lineDelay = 60): Promise<void> {
  for (const line of lines) {
    process.stdout.write(line + "\n");
    await sleep(lineDelay, ctx);
  }
}

export async function cascade(lines: string[], ctx?: AnimationContext, lineDelay = 80): Promise<void> {
  for (const line of lines) {
    process.stdout.write(line + "\n");
    await sleep(lineDelay, ctx);
  }
}

export async function spinner(
  message: string,
  durationMs: number,
  ctx?: AnimationContext,
  doneMessage?: string,
): Promise<void> {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  if (!isTTY() || ctx?.skipped) {
    process.stdout.write((doneMessage ?? `  ${pc.green("✔")} ${message}`) + "\n");
    return;
  }
  const start = Date.now();
  let i = 0;
  while (Date.now() - start < durationMs && !ctx?.skipped) {
    process.stdout.write(`\r  ${pc.cyan(frames[i % frames.length])} ${message}`);
    await sleep(80, ctx);
    i++;
  }
  const final = doneMessage ?? `  ${pc.green("✔")} ${message}`;
  process.stdout.write(`\r${final}${" ".repeat(10)}\n`);
}

export async function progressBar(
  label: string,
  ctx?: AnimationContext,
  width = 32,
  fillDelay = 35,
): Promise<void> {
  const prefix = `  ${label} `;
  if (!isTTY() || ctx?.skipped) {
    process.stdout.write(`${prefix}[${"█".repeat(width)}] done\n`);
    return;
  }
  process.stdout.write(`${prefix}[${" ".repeat(width)}]`);
  for (let i = 0; i < width; i++) {
    process.stdout.write(`\r${prefix}[${"█".repeat(i + 1)}${pc.dim("░".repeat(width - i - 1))}]`);
    await sleep(fillDelay, ctx);
    if (ctx?.skipped) {
      process.stdout.write(`\r${prefix}[${"█".repeat(width)}] done`);
      process.stdout.write("\n");
      return;
    }
  }
  process.stdout.write(" done\n");
}

export function drawBox(title: string, lines: string[]): string[] {
  const innerWidth = Math.max(title.length + 2, ...lines.map(stripAnsi).map((line) => line.length)) + 2;
  const pad = (s: string) => {
    const visible = stripAnsi(s).length;
    return s + " ".repeat(Math.max(0, innerWidth - visible));
  };
  const top = `  ${pc.dim("╭─")} ${pc.cyan(title)} ${pc.dim("─".repeat(Math.max(0, innerWidth - title.length - 2)) + "╮")}`;
  const bot = `  ${pc.dim("╰" + "─".repeat(innerWidth + 2) + "╯")}`;
  const body = lines.map((line) => `  ${pc.dim("│")} ${pad(line)} ${pc.dim("│")}`);
  return [top, ...body, bot];
}
