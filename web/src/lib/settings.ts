import { useSyncExternalStore } from "react";

// Per-browser settings: the API token for writes and the author used for commits (spec §13.5 공통).
export interface FarmSettings {
  token: string;
  authorName: string;
  authorEmail: string;
}

const KEY = "farm.settings";
const EMPTY: FarmSettings = { token: "", authorName: "", authorEmail: "" };
const listeners = new Set<() => void>();
let cache: FarmSettings | null = null;

function read(): FarmSettings {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<FarmSettings>) } : EMPTY;
  } catch {
    cache = EMPTY; // storage blocked or corrupt: behave as a fresh browser
  }
  return cache;
}

export function getSettings(): FarmSettings {
  return read();
}

export function saveSettings(next: FarmSettings): void {
  cache = { ...next };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // keep the in-memory copy for this tab
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSettings(): FarmSettings {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

/** Test helper: forget the cached copy so the next read hits localStorage again. */
export function resetSettingsCache(): void {
  cache = null;
}
