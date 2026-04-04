import { describe, expect, it } from "vitest";
import {
  DEFAULT_REPAIR_TEMPLATE,
  DEFAULT_PLAN_TEMPLATE,
  DEFAULT_RESEARCH_TEMPLATE,
  DEFAULT_TASK_TEMPLATE,
  DEFAULT_VERIFY_TEMPLATE,
} from "../../src/domain/defaults.js";
import { renderTemplate } from "../../src/domain/template.js";

const sharedPrefix = `{{context}}\n\n---\n\nThe Markdown above is the source document up to but not including the selected unchecked task.\n\n## Source file\n\n\`{{file}}\` (line {{taskLine}})\n\n## Selected task\n\n{{task}}\n`;

describe("default prompt templates", () => {
  it("starts every built-in template with the same shared prefix", () => {
    expect(DEFAULT_TASK_TEMPLATE.startsWith(sharedPrefix)).toBe(true);
    expect(DEFAULT_VERIFY_TEMPLATE.startsWith(sharedPrefix)).toBe(true);
    expect(DEFAULT_REPAIR_TEMPLATE.startsWith(sharedPrefix)).toBe(true);
    expect(DEFAULT_PLAN_TEMPLATE.startsWith(sharedPrefix)).toBe(true);
    expect(DEFAULT_RESEARCH_TEMPLATE.startsWith(sharedPrefix)).toBe(true);
  });

  it("renders the variables section in the default task template", () => {
    const result = renderTemplate(DEFAULT_TASK_TEMPLATE, {
      task: "Ship release",
      file: "tasks.md",
      context: "- [ ] Ship release",
      taskIndex: 0,
      taskLine: 1,
      source: "- [ ] Ship release",
      userVariables: "branch=main\nticket=ENG-42",
    });

    expect(result).toContain("## Variables\n\nbranch=main\nticket=ENG-42");
  });

  it("renders (none) in the variables section when userVariables is empty", () => {
    const result = renderTemplate(DEFAULT_TASK_TEMPLATE, {
      task: "Ship release",
      file: "tasks.md",
      context: "- [ ] Ship release",
      taskIndex: 0,
      taskLine: 1,
      source: "- [ ] Ship release",
      userVariables: "(none)",
    });

    expect(result).toContain("## Variables\n\n(none)");
  });
});
