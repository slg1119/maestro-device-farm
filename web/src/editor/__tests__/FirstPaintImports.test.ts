import { vi } from "vitest";

// Import the real route and all of its eager dependencies without mounting it.
// Neither Monaco package may be evaluated until an editor is mounted.
vi.mock("@monaco-editor/react", () => {
  throw new Error("EditorPage eagerly imported @monaco-editor/react");
});
vi.mock("monaco-editor", () => {
  throw new Error("EditorPage eagerly imported monaco-editor");
});

test("loading EditorPage does not eagerly import either Monaco package", async () => {
  await expect(import("../EditorPage")).resolves.toHaveProperty("EditorPage", expect.any(Function));
});
