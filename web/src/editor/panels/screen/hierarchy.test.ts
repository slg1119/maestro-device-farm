import fixture from "./hierarchy.fixture.json";
import { candidatesFor, flattenHierarchy, hitTest, parseBounds, snapshotCandidates, selectorInsertion } from "./hierarchy";

test("parses Maestro bounds and rejects malformed, empty or reversed rectangles", () => {
  expect(parseBounds("[10,20][110,220]")).toEqual({ x: 10, y: 20, width: 100, height: 200 });
  expect(parseBounds("[-10,0][10,20]")).toEqual({ x: -10, y: 0, width: 20, height: 20 });
  for (const bounds of [undefined, "", "[1,2][1,8]", "[2,3][1,8]", "[a,2][3,4]", "[0,0][2,3]junk"]) expect(parseBounds(bounds)).toBeNull();
});

test("flattens an actual Maestro hierarchy with an attribute-less root", () => {
  const nodes = flattenHierarchy(fixture);
  expect(nodes).toHaveLength(47);
  expect(nodes.find(n => n.attributes.text === "Learn more about Wikipedia")?.bounds).not.toBeNull();
  expect(new Set(nodes.map(n => n.key)).size).toBe(nodes.length);
  expect(flattenHierarchy(null)).toEqual([]);
});

const nested = { attributes: { class: "Root", bounds: "[0,0][1080,2400]" }, children: [
  { attributes: { class: "Button", bounds: "[100,100][500,500]", "resource-id": "repeated", text: "로그인", accessibilityText: "계속" }, children: [
    { attributes: { class: "Label", bounds: "[150,150][300,200]", text: "로그인" } },
  ] },
  { attributes: { class: "Button", bounds: "[600,100][900,500]", "resource-id": "repeated", text: "다음" } },
] };

test("hit testing selects the smallest containing element in natural-image coordinates", () => {
  const nodes = flattenHierarchy(nested);
  expect(hitTest(nodes, 160, 170)?.attributes.class).toBe("Label");
  expect(hitTest(nodes, 400, 300)?.attributes.class).toBe("Button");
  expect(hitTest(nodes, 1000, 2000)?.attributes.class).toBe("Root");
  expect(hitTest(nodes, 2000, 2000)).toBeNull();
});

test("candidates retain id/text/accessibility priority and explain uniqueness across all nodes", () => {
  const nodes = flattenHierarchy(nested);
  expect(candidatesFor(nodes[1]!, nodes)).toEqual([
    { kind: "id", value: "repeated", note: "같은 id 2개" },
    { kind: "text", value: "로그인", note: "같은 text 2개" },
    { kind: "accessibilityText", value: "계속", note: "고유" },
  ]);
  const unique = flattenHierarchy({ attributes: { "resource-id": "only" } });
  expect(candidatesFor(unique[0]!, unique)[0]?.note).toBe("권장 · 고유");
  const all = snapshotCandidates(nodes);
  expect(all.filter(c => c.value === "repeated")).toHaveLength(1);
  expect(all.filter(c => c.value === "로그인")).toHaveLength(1);
  expect(all).toHaveLength(4);
});

test("insertion escapes YAML scalars and respects blank, nested and existing command lines", () => {
  const selector = { kind: "text" as const, value: '로그인: "계속"\n다음' };
  expect(selectorInsertion("tapOn", selector, "", { line: 1, column: 1 })).toBe('- tapOn:\n    text: "로그인: \\"계속\\"\\n다음"\n');
  expect(selectorInsertion("assertVisible", { kind: "id", value: "submit" }, "  - ", { line: 1, column: 5 })).toBe('assertVisible:\n      id: "submit"\n');
  expect(selectorInsertion("tapOn", { kind: "id", value: "submit" }, "    ", { line: 1, column: 5 })).toBe('- tapOn:\n        id: "submit"\n');
  expect(selectorInsertion("tapOn", { kind: "id", value: "submit" }, "  - scroll", { line: 1, column: 11 })).toBe('\n  - tapOn:\n      id: "submit"\n');
});

test("insertion after a selector uses the enclosing command indentation and rejects a split scalar", () => {
  const candidate = { kind: "id" as const, value: "submit" };
  expect(selectorInsertion("tapOn", candidate, '- tapOn:\n    id: "old"', { line: 2, column: 14 })).toBe('\n- tapOn:\n    id: "submit"\n');
  expect(() => selectorInsertion("tapOn", candidate, '- tapOn: "old"', { line: 1, column: 6 })).toThrow("빈 줄이나 줄 끝");
});

test("inserting before an existing nested command preserves both commands' indentation", () => {
  const content = "- repeat:\n    times: 2\n    commands:\n      - scroll";
  const candidate = { kind: "id" as const, value: "submit" };
  const expected = "- repeat:\n    times: 2\n    commands:\n      - tapOn:\n          id: \"submit\"\n      - scroll";
  for (const column of [1, 4, 7]) {
    const offset = content.lastIndexOf("\n") + column;
    const insertion = selectorInsertion("tapOn", candidate, content, { line: 4, column });
    expect(content.slice(0, offset) + insertion + content.slice(offset)).toBe(expected);
  }
});
