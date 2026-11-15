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

  test("shows API and stream messages in the selected language", async () => {
    vi.resetModules();
    const { localizeServerText, setLanguage } = await import("../i18n");
    setLanguage("ko");
    expect(localizeServerText("Recording not found.")).toBe("녹화를 찾을 수 없습니다");
    expect(localizeServerText("Cannot connect to the agent live screen.")).toBe("에이전트의 실시간 화면에 연결할 수 없습니다");
    expect(localizeServerText("Auto-repair limit reached (2); the run did not pass."))
      .toBe("자동 보정 2회 후에도 실행이 통과하지 않았습니다");
    setLanguage("en");
    expect(localizeServerText("Recording not found.")).toBe("Recording not found.");
  });

  test("uses natural count labels in English and preserves Korean counts", async () => {
    vi.resetModules();
    const { setLanguage, t, tp } = await import("../i18n");
    setLanguage("en");
    expect(t("nav.devices")).toBe("Devices");
    expect(t("m_d1a2d3a223")).toBe("Created");
    expect(tp("live.connectedCount", 1)).toBe("1 device connected · view only");
    expect(tp("live.connectedCount", 2)).toBe("2 devices connected · view only");
    expect(tp("overview.workspaceCount", 1)).toBe("1 workspace");
    expect(t("ai.attemptLabel", [1])).toBe("Attempt 1 ·");
    expect(t("overview.workspaceCount.other", [1000])).toBe("1,000 workspaces");
    setLanguage("ko");
    expect(tp("live.connectedCount", 1)).toBe("연결된 기기 1대 · 보기 전용");
    expect(tp("overview.workspaceCount", 2)).toBe("2개");
    expect(t("ai.attemptLabel", [1])).toBe("1회차 ·");
    expect(t("overview.workspaceCount.other", [1000])).toBe("1000개");
  });
});
