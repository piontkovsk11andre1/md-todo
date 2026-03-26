import { parseTraceBlock } from "./trace-parser.js";

export interface WorkerOutputAnalysis {
  thinking_blocks: { content: string }[];
  tool_calls: string[];
  agent_signals: Record<string, string> | null;
  raw_stdout: string;
}

const THINKING_BLOCK_PATTERNS = [
  /<thinking>([\s\S]*?)<\/thinking>/g,
  /```thinking[\t ]*\r?\n([\s\S]*?)\r?\n```/g,
  /```opencode-thinking[\t ]*\r?\n([\s\S]*?)\r?\n```/g,
] as const;

export function parseWorkerOutput(stdout: string): WorkerOutputAnalysis {
  const thinking_blocks = extractThinkingBlocks(stdout);
  const agent_signals = parseTraceBlock(stdout);
  const tool_calls = extractToolCalls(agent_signals);

  return {
    thinking_blocks,
    tool_calls,
    agent_signals,
    raw_stdout: stdout,
  };
}

function extractThinkingBlocks(stdout: string): { content: string }[] {
  const blocks: { content: string }[] = [];

  for (const pattern of THINKING_BLOCK_PATTERNS) {
    for (const match of stdout.matchAll(pattern)) {
      const content = match[1]?.trim();
      if (content && content.length > 0) {
        blocks.push({ content });
      }
    }
  }

  return blocks;
}

function extractToolCalls(agentSignals: Record<string, string> | null): string[] {
  const toolsValue = agentSignals?.tools_used;

  if (!toolsValue) {
    return [];
  }

  const seen = new Set<string>();
  const tools: string[] = [];

  for (const rawTool of toolsValue.split(",")) {
    const tool = rawTool.trim();

    if (tool.length === 0 || seen.has(tool)) {
      continue;
    }

    seen.add(tool);
    tools.push(tool);
  }

  return tools;
}
