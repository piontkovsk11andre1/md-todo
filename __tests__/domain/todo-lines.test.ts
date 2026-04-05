import { describe, expect, it } from "vitest";
import { parseUncheckedTodoLines } from "../../src/domain/todo-lines.js";

describe("parseUncheckedTodoLines", () => {
  it("extracts unchecked task lines from worker output", () => {
    const output = [
      "Here are the subtasks:",
      "",
      "- [ ] First step",
      "- [ ] Second step",
      "- [ ] Third step",
      "",
      "That should cover it.",
    ].join("\n");

    const items = parseUncheckedTodoLines(output);
    expect(items).toEqual([
      "- [ ] First step",
      "- [ ] Second step",
      "- [ ] Third step",
    ]);
  });

  it("handles * and + bullet markers", () => {
    const output = "* [ ] Star item\n+ [ ] Plus item\n";
    const items = parseUncheckedTodoLines(output);
    expect(items).toEqual(["* [ ] Star item", "+ [ ] Plus item"]);
  });

  it("strips leading whitespace from indented items", () => {
    const output = "  - [ ] Indented item\n    - [ ] More indented\n";
    const items = parseUncheckedTodoLines(output);
    expect(items).toEqual(["- [ ] Indented item", "- [ ] More indented"]);
  });

  it("ignores checked items", () => {
    const output = "- [x] Done\n- [ ] Open\n";
    const items = parseUncheckedTodoLines(output);
    expect(items).toEqual(["- [ ] Open"]);
  });

  it("ignores non-task lines", () => {
    const output = "# Heading\n\nSome text\n- regular list\n- [ ] Task\n";
    const items = parseUncheckedTodoLines(output);
    expect(items).toEqual(["- [ ] Task"]);
  });

  it("returns empty array for no tasks", () => {
    expect(parseUncheckedTodoLines("No tasks here.")).toEqual([]);
    expect(parseUncheckedTodoLines("")).toEqual([]);
  });
});
