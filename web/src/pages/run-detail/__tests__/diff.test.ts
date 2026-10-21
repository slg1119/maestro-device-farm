import { expect, test } from "vitest";
import { lineDiff } from "../diff";

test("LCS preserves common lines between repeated commands", () => {
  expect(lineDiff("appId: a\n- tapOn: old\n- back\n- tapOn: old", "appId: a\n- tapOn: new\n- back\n- tapOn: old")).toEqual([
    { kind: "same", text: "appId: a" }, { kind: "removed", text: "- tapOn: old" },
    { kind: "added", text: "- tapOn: new" }, { kind: "same", text: "- back" }, { kind: "same", text: "- tapOn: old" },
  ]);
});
test("new files and removed files keep their line contents", () => {
  expect(lineDiff("", "appId: a")).toEqual([{ kind: "added", text: "appId: a" }]);
  expect(lineDiff("appId: a", "")).toEqual([{ kind: "removed", text: "appId: a" }]);
  expect(lineDiff("", "")).toEqual([]);
});
test("large diffs stay bounded without exceeding JavaScript argument limits", () => {
  const lines = lineDiff("old\n".repeat(150_000), "new\n".repeat(8));
  expect(lines.filter((line) => line.kind === "removed")).toHaveLength(150_000);
  expect(lines.filter((line) => line.kind === "added")).toHaveLength(8);
  expect(lines.at(-1)).toEqual({ kind: "same", text: "" });
});
