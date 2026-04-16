interface ResearchOutputPromptContractOptions {
  itemLabel: string;
  metadataPrefix: string;
  emptyConditionLabel: string;
}

export function buildResearchOutputPromptContract(options: ResearchOutputPromptContractOptions): string[] {
  return [
    `Return one ${options.itemLabel} per line.`,
    "Use plain text lines only: no bullets, no numbering, and no JSON.",
    `Do not include the literal \`${options.metadataPrefix}\` prefix unless it is part of the value.`,
    "Preserve discovery order.",
    `If no ${options.emptyConditionLabel}, return an empty response.`,
    "Do not include commentary.",
  ];
}
