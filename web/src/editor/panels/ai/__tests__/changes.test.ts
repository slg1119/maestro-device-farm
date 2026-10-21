import { lineChanges, suggestedPath } from "../changes";

test("line counts distinguish insertions, removals, replacements and reordered duplicate lines", () => {
  expect(lineChanges("", "one\ntwo\n")).toEqual({ added: 2, removed: 0 });
  expect(lineChanges("one\ntwo\n", "")).toEqual({ added: 0, removed: 2 });
  expect(lineChanges("- launchApp\n- back\n", "- launchApp\n- scroll\n")).toEqual({ added: 1, removed: 1 });
  expect(lineChanges("a\nb\na\nc\n", "a\na\nb\nc\n")).toEqual({ added: 1, removed: 1 });
  expect(lineChanges("a\r\nb\r\n", "a\nb\n")).toEqual({ added: 0, removed: 0 });
});

test("path suggestions stay within flows and handle Korean and empty descriptions", () => {
  expect(suggestedPath("Check Login!")).toBe("flows/check-login.yaml");
  expect(suggestedPath("예약하기 확인")).toBe("flows/예약하기-확인.yaml");
  expect(suggestedPath("../../")).toBe("flows/new-flow.yaml");
});
