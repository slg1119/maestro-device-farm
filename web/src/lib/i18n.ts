import en from "./locales/en.json";
import ko from "./locales/ko.json";

export type Language = "en" | "ko";
export function getLocale(): "en-US" | "ko-KR" { return getLanguage() === "ko" ? "ko-KR" : "en-US"; }
export const LANGUAGE_KEY = "farm.language";
let sessionLanguage: Language = "en";
let storageUnavailable = false;

export function getLanguage(): Language {
  if (storageUnavailable) return sessionLanguage;
  try {
    const saved = window.localStorage.getItem(LANGUAGE_KEY);
    if (saved === "en" || saved === "ko") return saved;
  } catch { storageUnavailable = true; }
  return sessionLanguage;
}

/** Store the user's choice when possible; keep it for this page if storage is blocked. */
export function setLanguage(language: Language): boolean {
  sessionLanguage = language;
  try {
    window.localStorage.setItem(LANGUAGE_KEY, language);
    storageUnavailable = false;
    return true;
  } catch { storageUnavailable = true; return false; }
}

export function t(key: string, values: readonly unknown[] = []): string {
  const catalog: Record<string, string> = getLanguage() === "ko" ? ko : en;
  const template = catalog[key] ?? ko[key as keyof typeof ko] ?? key;
  return template.replace(/\{(\d+)\}/g, (match, index: string) => {
    const value = values[Number(index)];
    return value === undefined || value === null ? match : typeof value === "number" && getLanguage() === "en" ? new Intl.NumberFormat(getLocale()).format(value) : String(value);
  });
}

export function tp(key: string, count: number): string {
  return t(`${key}.${new Intl.PluralRules(getLocale()).select(count)}`, [count]);
}

/** Known API and agent messages keep the Korean UI's original wording. */
const serverMessages: Record<string, string> = {
  "A workspace is required to refine a recording with AI.": "server.recordingNeedsWorkspace",
  "Sync the workspace first.": "server.workspaceNotSynced",
  "Recording not found.": "server.recordingNotFound",
  "Device not found.": "server.deviceNotFound",
  "Live-screen device not found.": "server.liveDeviceNotFound",
  "Start recording on a connected device.": "server.recordingDeviceUnavailable",
  "A recording is already in progress.": "server.recordingActive",
  "This recording was cancelled.": "server.recordingCancelled",
  "This recording has finished.": "server.recordingFinished",
  "Cannot connect to the agent live screen.": "server.agentStreamUnavailable",
  "Device screen connection closed.": "server.deviceScreenClosed",
  "Cannot connect to device.": "server.deviceConnectionFailed",
  'Maestro supports only integer percentage coordinates (for example, "94%,97%").': "server.integerCoordinates",
  "codex (default model)": "server.codexDefaultModel",
};

export function localizeServerText(message: string): string {
  if (getLanguage() !== "ko") return message;
  const key = serverMessages[message];
  if (key) return t(key);
  return message.replace(/Auto-repair limit reached \((\d+)\); the run did not pass\./g,
    (_, attempts: string) => t("server.autoRepairLimit", [attempts]));
}
