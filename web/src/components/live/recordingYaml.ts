import type { RecordingStep } from "../../api/types";

const keyNames: Record<string, string> = { HOME: "Home", APP_SWITCH: "Recent Apps", ENTER: "Enter", DEL: "Backspace", VOLUME_UP: "Volume Up", VOLUME_DOWN: "Volume Down", POWER: "Power" };
// JSON strings are YAML scalars too: preserve quotes, newlines, colons and Korean.
const quote = (text: string | undefined) => JSON.stringify(text ?? "");

/** Mirrors the recording backend's steps_to_yaml command mapping. */
export function stepYamlLine(step: RecordingStep): string {
  switch (step.kind) {
    case "launch": return "- launchApp";
    case "tap": {
      const selector = step.selector;
      if (selector?.id) return `- tapOn: {id: ${quote(selector.id)}}`;
      if (selector?.text) return `- tapOn: {text: ${quote(selector.text)}}`;
      return `- tapOn: {point: ${quote(step.point)}}`;
    }
    case "swipe": return `- swipe: {start: ${quote(step.from)}, end: ${quote(step.to)}}`;
    case "input": return `- inputText: ${quote(step.text)}`;
    case "back": return "- back";
    case "key": return step.key === "BACK" ? "- back" : `- pressKey: ${quote(keyNames[step.key ?? ""] ?? step.key)}`;
  }
}

export function recordingPath(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `flows/recorded-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.yaml`;
}
