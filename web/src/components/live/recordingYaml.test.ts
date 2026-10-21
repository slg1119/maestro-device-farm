import { expect, test } from "vitest";
import { recordingPath, stepYamlLine } from "./recordingYaml";

test("renders every recording step as a safe Maestro YAML command", () => {
  const ts = "2026-10-21T05:00:00Z";
  expect([
    { kind: "launch", ts },
    { kind: "tap", selector: { id: 'app:id/continue"' }, ts },
    { kind: "tap", selector: { text: "확인: 예\n다음" }, ts },
    { kind: "tap", point: "25%,50%", ts },
    { kind: "swipe", from: "50%,80%", to: "50%,20%", ts },
    { kind: "input", text: '한글 "입력"\n다음', ts },
    { kind: "back", ts },
    ...["HOME", "APP_SWITCH", "ENTER", "DEL", "VOLUME_UP", "VOLUME_DOWN", "POWER"].map(key => ({ kind: "key", key, ts })),
  ].map(step => stepYamlLine(step as Parameters<typeof stepYamlLine>[0]))).toEqual([
    "- launchApp", '- tapOn: {id: "app:id/continue\\\""}', '- tapOn: {text: "확인: 예\\n다음"}',
    '- tapOn: {point: "25%,50%"}', '- swipe: {start: "50%,80%", end: "50%,20%"}',
    '- inputText: "한글 \\"입력\\"\\n다음"', "- back", '- pressKey: "Home"', '- pressKey: "Recent Apps"',
    '- pressKey: "Enter"', '- pressKey: "Backspace"', '- pressKey: "Volume Up"', '- pressKey: "Volume Down"', '- pressKey: "Power"',
  ]);
});

test("uses a local minute timestamp for the recorded draft filename", () => {
  expect(recordingPath(new Date(2026, 9, 21, 14, 35))).toBe("flows/recorded-20261021-1435.yaml");
});
