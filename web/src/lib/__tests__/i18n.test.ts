import { describe, expect, test, vi } from "vitest";
import en from "../locales/en.json";
import ko from "../locales/ko.json";

describe("dashboard language", () => {
  test("keeps the catalogs and interpolation markers in sync", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ko).sort());
    for (const key of Object.keys(ko) as Array<keyof typeof ko>) {
      const markers = (value: string) => [...value.matchAll(/\{\d+\}/g)].map((match) => match[0]).sort();
      expect(markers(en[key])).toEqual(markers(ko[key]));
    }
  });
  test("defaults to English when no browser preference exists", async () => {
    localStorage.removeItem("farm.language");
    vi.resetModules();
    const { getLanguage, t } = await import("../i18n");
    expect(getLanguage()).toBe("en");
    expect(t("nav.overview")).toBe("Overview");
  });

  test("keeps the existing Korean copy when Korean is selected", async () => {
    vi.resetModules();
    const { getLanguage, setLanguage, t } = await import("../i18n");
    expect(setLanguage("ko")).toBe(true);
    expect(localStorage.getItem("farm.language")).toBe("ko");
    expect(getLanguage()).toBe("ko");
    expect(t("nav.overview")).toBe("개요");
  });

  test("keeps the choice in memory when localStorage is blocked", async () => {
    vi.resetModules();
    const { getLanguage, setLanguage, t } = await import("../i18n");
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", { configurable: true, get: () => { throw new Error("blocked"); } });
    try {
      expect(setLanguage("ko")).toBe(false);
      expect(getLanguage()).toBe("ko");
      expect(t("nav.runs")).toBe("실행");
    } finally {
      if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
    }
  });
});
