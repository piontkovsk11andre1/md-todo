interface ResearchOutputPromptContractOptions {
  itemLabel: string;
  metadataPrefix: string;
  emptyConditionLabel: string;
}

export function buildResearchOutputPromptContract(options: ResearchOutputPromptContractOptions): string[] {
  return [
    `Return one ${options.itemLabel} per line using plain lines or Markdown list items (bulleted/numbered).`,
    "Do not wrap output in code fences.",
    "Use one item per line; do not use JSON or nested structures.",
    `Do not include the literal \`${options.metadataPrefix}\` prefix unless it is part of the value.`,
    "Preserve discovery order.",
    `If no ${options.emptyConditionLabel}, return an empty response.`,
    "Do not include commentary.",
  ];
}
