import { expect, test } from "bun:test";
import { matchingLines, tail } from "../src/triage";

test("tail keeps the end of long output", () => {
  expect(tail("abcdef", 3)).toBe("...def");
  expect(tail("abc", 3)).toBe("abc");
});

test("matchingLines returns failure lines by default, capped", () => {
  const out = ["ok 1", "FAIL src/a.test.ts", "ok 2", "Error: boom", "warning: deprecated"].join("\n");
  expect(matchingLines(out)).toEqual(["FAIL src/a.test.ts", "Error: boom", "warning: deprecated"]);
  expect(matchingLines(out, undefined, 1)).toEqual(["FAIL src/a.test.ts"]);
});

test("matchingLines accepts a custom pattern and truncates long lines", () => {
  const long = "x".repeat(500);
  expect(matchingLines(`a\n${long}\nb`, "x+")).toEqual([`${"x".repeat(300)}...`]);
});
