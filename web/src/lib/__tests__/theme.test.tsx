import { act, renderHook } from "@testing-library/react";

import { useTheme } from "../theme";

function systemTheme(dark: boolean) {
  const media = new EventTarget() as MediaQueryList;
  Object.defineProperty(media, "matches", { value: dark, writable: true });
  vi.stubGlobal("matchMedia", vi.fn(() => media));
  return media;
}

afterEach(() => document.documentElement.classList.remove("dark"));

test("persists the theme, applies dark and follows system changes only in system mode", () => {
  const media = systemTheme(false);
  const { result } = renderHook(useTheme);
  expect(result.current.preference).toBe("system");
  expect(result.current.resolved).toBe("light");
  act(() => result.current.setPreference("dark"));
  expect(localStorage.getItem("farm.theme")).toBe("dark");
  expect(document.documentElement).toHaveClass("dark");
  act(() => result.current.setPreference("light"));
  act(() => { Object.assign(media, { matches: true }); media.dispatchEvent(new Event("change")); });
  expect(result.current.resolved).toBe("light");
  act(() => result.current.setPreference("system"));
  expect(result.current.resolved).toBe("dark");
  act(() => { Object.assign(media, { matches: false }); media.dispatchEvent(new Event("change")); });
  expect(document.documentElement).not.toHaveClass("dark");
});

test("reads a stored preference and tolerates unavailable storage", () => {
  systemTheme(false);
  localStorage.setItem("farm.theme", "dark");
  const { result } = renderHook(useTheme);
  expect(result.current.preference).toBe("dark");
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  act(() => result.current.setPreference("light"));
  expect(result.current.resolved).toBe("light");
  spy.mockRestore();
});
