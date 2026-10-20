import { getSettings, resetSettingsCache, saveSettings } from "../settings";

test("persists settings in localStorage", () => {
  expect(getSettings()).toEqual({ token: "", authorName: "", authorEmail: "" });
  saveSettings({ token: "t", authorName: "Kim", authorEmail: "kim@x.io" });
  resetSettingsCache();
  expect(getSettings()).toEqual({ token: "t", authorName: "Kim", authorEmail: "kim@x.io" });
});

test("survives blocked storage", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  resetSettingsCache();
  expect(getSettings().token).toBe("");
  vi.restoreAllMocks();
});
