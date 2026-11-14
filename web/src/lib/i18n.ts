import en from "./locales/en.json";
import ko from "./locales/ko.json";

export type Language = "en" | "ko";
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
    return value === undefined || value === null ? match : String(value);
  });
}
