import { device } from "../../../test/fixtures";
import { buildRunOptions, matchingDevices, parseEnv, splitList, type RunForm } from "../options";

function form(overrides: Partial<RunForm> = {}): RunForm {
  return {
    flowSource: "workspace", workspace: "example-app", ref: "", appSource: "library",
    packageName: "com.example.app", appBuildId: "", mode: "split", tags: "", models: "",
    minSdk: "", maxSdk: "", serials: [], includeTags: "", excludeTags: "", flowPaths: "",
    env: "", taskTimeoutSec: "", ...overrides,
  };
}

test("splits comma and newline lists and ignores empty items", () => {
  expect(splitList(" a, b ,,c\nd ")).toEqual(["a", "b", "c", "d"]);
  expect(splitList("\n , ")).toEqual([]);
});

test("parses env comments, blanks and values containing equals", () => {
  expect(parseEnv("A=1\n# c\n\nB=x=y")).toEqual({ A: "1", B: "x=y" });
  expect(parseEnv("  # comment\n EMPTY=\n A = spaced value ")).toEqual({ EMPTY: "", A: " spaced value " });
  expect(() => parseEnv("NOPE")).toThrow("KEY=VALUE 형식이 아닙니다: NOPE");
  expect(() => parseEnv("=value")).toThrow("KEY=VALUE 형식이 아닙니다: =value");
});

test("builds exactly the default workspace and latest-app split options", () => {
  expect(buildRunOptions(form())).toEqual({
    mode: "split", origin: "dashboard", flow_source: "workspace", workspace: "example-app",
    app: "com.example.app@latest", device_selector: {}, include_tags: [], exclude_tags: [], env: {},
  });
});

test("includes selected ref, build, device and flow filters, env and timeout", () => {
  expect(buildRunOptions(form({
    mode: "matrix", ref: " release ", appBuildId: "app2", tags: "smoke, tablet", models: "Pixel 7",
    serials: ["emulator-5554"], minSdk: "24", maxSdk: "35", includeTags: "fast, smoke",
    excludeTags: "slow", flowPaths: "login.yaml\ncheckout.yaml, home.yaml", env: "A=x=y", taskTimeoutSec: "120",
  }))).toEqual({
    mode: "matrix", origin: "dashboard", flow_source: "workspace", workspace: "example-app", ref: "release",
    app_build_id: "app2", device_selector: { tags: ["smoke", "tablet"], models: ["Pixel 7"],
      serials: ["emulator-5554"], min_sdk: 24, max_sdk: 35 },
    include_tags: ["fast", "smoke"], exclude_tags: ["slow"],
    flow_paths: ["login.yaml", "checkout.yaml", "home.yaml"], env: { A: "x=y" }, task_timeout_sec: 120,
  });
});

test("omits workspace/ref and all library app fields for zip and APK uploads", () => {
  expect(buildRunOptions(form({ flowSource: "upload", appSource: "upload", ref: "stale", appBuildId: "app2" }))).toEqual({
    mode: "split", origin: "dashboard", flow_source: "upload", device_selector: {}, include_tags: [], exclude_tags: [], env: {},
  });
});

test("matches only available or busy unreserved enabled devices meeting all SDK limits", () => {
  const reserved = {
    id: "res1", device_serial: "reserved", holder_name: "Kim", status: "active" as const,
    created_at: "2026-10-20T05:00:00Z", expires_at: "2026-10-20T06:00:00Z", released_at: null,
  };
  const devices = [
    device({ serial: "available", sdk_int: 30 }), device({ serial: "busy", state: "busy", sdk_int: 31 }),
    device({ serial: "reserved", reservation: reserved }), device({ serial: "disabled", disabled: true }),
    ...(["offline", "reserved", "unhealthy", "disabled"] as const).map(state => device({ serial: state, state })),
    device({ serial: "old", sdk_int: 23 }), device({ serial: "new", sdk_int: 36 }),
  ];
  expect(matchingDevices(devices, { min_sdk: 24, max_sdk: 35 }, 30).map(d => d.serial)).toEqual(["available", "busy"]);
  expect(matchingDevices([device({ sdk_int: 24 })], {}, 25)).toEqual([]);
});

test("requires every tag and exact model and serial matches", () => {
  const devices = [
    device({ serial: "yes", tags: ["smoke", "tablet"], model: "Pixel 7" }),
    device({ serial: "tag", tags: ["smoke"], model: "Pixel 7" }),
    device({ serial: "model", tags: ["smoke", "tablet"], model: "Pixel 7 Pro" }),
    device({ serial: "serial", tags: ["smoke", "tablet"], model: "Pixel 7" }),
  ];
  expect(matchingDevices(devices, { tags: ["smoke", "tablet"], models: ["Pixel 7"], serials: ["yes", "tag", "model"] })
    .map(d => d.serial)).toEqual(["yes"]);
  expect(matchingDevices(devices, { serials: [] })).toEqual([]);
});
