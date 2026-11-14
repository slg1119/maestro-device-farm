import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import { resetSettingsCache } from "../lib/settings";
import { LANGUAGE_KEY, setLanguage } from "../lib/i18n";

class FakeEventSource {
  static readonly CLOSED = 2;
  readonly readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {}
  addEventListener() {}
  close() {}
}

window.localStorage.setItem(LANGUAGE_KEY, "ko");
setLanguage("ko");
vi.stubGlobal("EventSource", FakeEventSource);

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.localStorage.setItem(LANGUAGE_KEY, "ko");
  setLanguage("ko");
  resetSettingsCache();
  vi.unstubAllGlobals();
  vi.stubGlobal("EventSource", FakeEventSource);
});
