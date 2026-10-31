import { it, expect } from "vitest";
import { itemsToText } from "./readPdf";

it("joins PDF.js text pieces into lines", () => {
  const items = [
    { str: "The Krebs cycle", hasEOL: true },
    { str: "runs in the ", hasEOL: false },
    { str: "matrix.  ", hasEOL: true },
    { str: "", hasEOL: true },
  ];
  expect(itemsToText(items)).toBe("The Krebs cycle\nruns in the matrix.");
});
