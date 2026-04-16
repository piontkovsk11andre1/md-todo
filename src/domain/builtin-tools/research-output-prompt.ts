interface ResearchOutputPromptContractOptions {
  itemLabel: string;
  metadataPrefix: string;
  emptyConditionLabel: string;
}

export function buildResearchOutputPromptContract(options: ResearchOutputPromptContractOptions): string[] {
  return [
    `Return one ${options.itemLabel} per line.`,
    "Allowed line formats: plain lines, markdown bullet lines, or markdown ordered-list lines. Do not return JSON.",
    `Do not include the literal \`${options.metadataPrefix}\` prefix unless it is part of the value.`,
    "Preserve discovery order.",
    `If no ${options.emptyConditionLabel}, return an empty response.`,
    "Do not include commentary.",
  ];
}
