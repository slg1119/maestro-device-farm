import { useCallback, useEffect, useLayoutEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
const KEY = "farm.theme";
const CHANGE = "farm:theme";

function isPreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(KEY);
    return isPreference(value) ? value : "system";
  } catch {
    return "system";
  }
}

/** Shares browser preferences across mounted consumers and follows OS changes in system mode. */
export function useTheme(): {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (value: ThemePreference) => void;
} {
  const [preference, setLocalPreference] = useState(readPreference);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  const resolved = preference === "system" ? (systemDark ? "dark" : "light") : preference;

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const changed = () => setSystemDark(media?.matches ?? false);
    changed();
    media?.addEventListener("change", changed);
    const stored = (event: StorageEvent) => {
      if (event.key === KEY || event.key === null) setLocalPreference(readPreference());
    };
    const selected = (event: Event) => {
      const value: unknown = (event as CustomEvent).detail;
      if (isPreference(value)) setLocalPreference(value);
    };
    window.addEventListener("storage", stored);
    window.addEventListener(CHANGE, selected);
    return () => {
      media?.removeEventListener("change", changed);
      window.removeEventListener("storage", stored);
      window.removeEventListener(CHANGE, selected);
    };
  }, []);

  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);

  const setPreference = useCallback((value: ThemePreference) => {
    try { localStorage.setItem(KEY, value); } catch { /* Keep the preference for this tab when storage is blocked. */ }
    setLocalPreference(value);
    window.dispatchEvent(new CustomEvent(CHANGE, { detail: value }));
  }, []);

  return { preference, resolved, setPreference };
}
