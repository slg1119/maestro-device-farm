import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import { resetSettingsCache } from "../lib/settings";

class FakeEventSource {
  static readonly CLOSED = 2;
  readonly readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {}
  addEventListener() {}
  close() {}
}

vi.stubGlobal("EventSource", FakeEventSource);

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  resetSettingsCache();
  vi.unstubAllGlobals();
  vi.stubGlobal("EventSource", FakeEventSource);
});
