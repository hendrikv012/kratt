import { describe, test, expect } from "vitest";
import { score, searchItems } from "./search";

const item = (id, title, group = "Pages", extra = {}) => ({ id, group, title, run() {}, ...extra });

describe("quick find search", () => {
  test("prefix beats substring", () => {
    const items = [item("a", "Precell"), item("b", "Cell review")];
    const result = searchItems(items, "cel", []);
    expect(result[0].items.map((i) => i.title)).toEqual(["Cell review", "Precell"]);
  });

  test("ranks title prefix > word prefix > substring > keyword > text", () => {
    const q = "mito";
    const scores = [
      score(item("1", "Mitosis"), q),
      score(item("2", "Cell mitosis"), q),
      score(item("3", "Premitotic"), q),
      score(item("4", "Division", "Pages", { keywords: ["mitosis"] }), q),
      score(item("5", "Notes", "Pages", { text: "about mitosis" }), q),
    ];
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(new Set(scores).size).toBe(5);
    expect(score(item("6", "Other"), q)).toBe(0);
  });

  test("groups in fixed order and caps at 6", () => {
    const pages = Array.from({ length: 8 }, (_, i) => item(`p${i}`, `Page a${i}`));
    const action = item("act", "Add thing", "Actions");
    const result = searchItems([action, ...pages], "a", []);
    expect(result.map((g) => g.group)).toEqual(["Pages", "Actions"]);
    expect(result[0].items).toHaveLength(6);
  });

  test("matches page text when title doesn't", () => {
    const page = item("p", "Organelles", "Pages", { text: "The mitochondria makes ATP" });
    const result = searchItems([page, item("q", "Other")], "mitoch", []);
    expect(result).toEqual([{ group: "Pages", items: [page] }]);
  });

  test("ties break by position in recentIds", () => {
    const items = [item("a", "Cell one"), item("b", "Cell two")];
    expect(searchItems(items, "cell", ["b", "a"])[0].items.map((i) => i.id)).toEqual(["b", "a"]);
  });

  test("empty query returns Recent in recentIds order", () => {
    const items = [item("a", "A"), item("b", "B"), item("c", "C")];
    expect(searchItems(items, "  ", ["c", "gone", "a"])).toEqual([{ group: "Recent", items: [items[2], items[0]] }]);
  });

  test("no match returns []", () => {
    expect(searchItems([item("a", "Cell")], "zzz", [])).toEqual([]);
    expect(searchItems([item("a", "Cell")], "", [])).toEqual([]);
  });
});
