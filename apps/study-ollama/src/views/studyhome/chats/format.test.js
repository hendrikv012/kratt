import { expect, it } from "vitest";
import { chatTitle, escapeHeadings, formatTurns, parseTurns } from "./format";

it("round-trips", () => {
  const turns = [
    { who: "you", text: "What does the cycle make?" },
    { who: "kratt", text: "ATP ⇒ ADP, café.\n\n- one\n- two" },
  ];
  const text = formatTurns(turns);
  expect(text).toBe("### You\nWhat does the cycle make?\n\n### Kratt\nATP ⇒ ADP, café.\n\n- one\n- two\n");
  expect(parseTurns(text)).toEqual(turns);
  expect(formatTurns(parseTurns(formatTurns(turns)))).toBe(formatTurns(turns));
});

it("keeps hand-edited text", () => {
  expect(parseTurns("intro\n### You\nq\n## Notes\nmore\n### Kratt\na\n")).toEqual([
    { who: "you", text: "intro" },
    { who: "you", text: "q\n## Notes\nmore" },
    { who: "kratt", text: "a" },
  ]);
  expect(parseTurns("")).toEqual([]);
});

it("titles", () => {
  const title = chatTitle("Walk me through one turn of the cycle, step by step please");
  expect(title.length).toBeLessThanOrEqual(48);
  expect("Walk me through one turn of the cycle, step by step please".startsWith(title)).toBe(true);
  expect("Walk me through one turn of the cycle, step by step please"[title.length]).toBe(" ");
  expect(title).not.toMatch(/,$/);
  expect(chatTitle("  ")).toBe("New chat");
  expect(chatTitle("Short one?")).toBe("Short one?");
});

it("escapes heading lines inside a turn so it reloads as one turn", () => {
  const text = escapeHeadings("Part one\n### You\n###  kratt \nPart two");
  expect(text).toBe("Part one\n ### You\n ###  kratt \nPart two");
  const turns = [{ who: "kratt", text }];
  expect(parseTurns(formatTurns(turns))).toEqual(turns);
});

it("reads a chat saved with Windows line endings", () => {
  expect(parseTurns("### You\r\nWhat does the cycle make?\r\n\r\n### Kratt\r\nATP.\r\n")).toEqual([
    { who: "you", text: "What does the cycle make?" },
    { who: "kratt", text: "ATP." },
  ]);
});

it("escapes a heading line that ends in a Windows line ending", () => {
  const text = escapeHeadings("Like this:\r\n### You\r\nand so on");
  expect(text).toBe("Like this:\n ### You\nand so on");
  expect(parseTurns(formatTurns([{ who: "kratt", text }]))).toEqual([{ who: "kratt", text }]);
});
