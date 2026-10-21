import { completionsFor, closestCommand, maestroCommands } from "../maestroCommands";
import { issueMarkers } from "../code/adapter";

test("command completion after - scr and reference command coverage", () => {
  expect(completionsFor("- scr", [])).toEqual(expect.arrayContaining([expect.objectContaining({ name: "scroll" }), expect.objectContaining({ name: "scrollUntilVisible" })]));
  for (const name of ["addMedia", "killApp", "inputRandomPersonName", "retry", "evalScript", "repeat"]) expect(maestroCommands.some(c => c.name === name)).toBe(true);
  expect(completionsFor("app", []).some(c => c.name === "appId")).toBe(true);
  expect(completionsFor("  id:", [{ kind: "id", value: "login" }]).some(c => c.snippet.includes("login"))).toBe(true);
  expect(closestCommand("scrol")).toBe("scroll"); expect(closestCommand("nonsense")).toBeNull();
});

test("validation maps positions, severity and source into Monaco markers", () => {
  expect(issueMarkers([{ path: "a.yaml", message: "Invalid Command: scrol", line: 4, column: 3 }, { path: "a.yaml", message: "YAML: bad", line: null, column: null }])).toEqual([
    expect.objectContaining({ startLineNumber: 4, startColumn: 3, source: "check-syntax", severity: 8 }),
    expect.objectContaining({ startLineNumber: 1, startColumn: 1, source: "YAML" }),
  ]);
});

test("quick fixes never replace the invalid command inside a different valid command", async () => {
  const { commandLocation } = await import("../code/adapter");
  expect(commandLocation(["- scroll", "- scrol"], "scrol", 1)).toEqual({ line: 2, column: 3 });
  expect(commandLocation(["- scroll"], "scrol", 1)).toBeNull();
});
