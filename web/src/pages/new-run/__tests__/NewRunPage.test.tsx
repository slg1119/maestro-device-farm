import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { keys } from "../../../api/queries";
import { saveSettings } from "../../../lib/settings";
import { apiErrorResponse, healthBody, jsonResponse, mockApi } from "../../../test/api";
import { app, device, workspace } from "../../../test/fixtures";
import { renderPage } from "../../../test/render";
import { NewRunPage } from "../NewRunPage";

function setup(overrides: Parameters<typeof mockApi>[0] = {}, token = "t") {
  saveSettings({ token, authorName: "Kim", authorEmail: "kim@x.io" });
  const api = mockApi({
    "GET /api/v1/workspaces": [workspace()], "GET /api/v1/apps": [app()],
    "GET /api/v1/devices": [device()], "POST /api/v1/runs": jsonResponse(201, { id: "new1", url: "/runs/new1" }),
    ...overrides,
  });
  const page = renderPage(<NewRunPage />, { route: "/runs/new", path: "/runs/new" });
  return { ...api, ...page, user: userEvent.setup() };
}

test("keeps the execution summary in sync with source, app, mode and device eligibility", async () => {
  const { user } = setup({
    "GET /api/v1/apps": [app(), app({ id: "newer", version_name: "2.0", version_code: 2, min_sdk: 35 })],
  });
  await screen.findByRole("combobox", { name: "워크스페이스" });
  const summary = within(screen.getByRole("complementary", { name: "실행 요약" }));
  expect(summary.getByText("example-app")).toBeInTheDocument();
  expect(summary.getByText("com.example.app@latest")).toBeInTheDocument();
  expect(summary.getByText("split")).toBeInTheDocument();
  expect(summary.getByText("조건에 맞는 기기 1대")).toBeInTheDocument();
  expect(summary.getByRole("button", { name: "실행 시작" })).toBeInTheDocument();
  await user.type(screen.getByRole("textbox", { name: "ref" }), "release");
  expect(summary.getByText("release")).toBeInTheDocument();
  await user.selectOptions(screen.getByRole("combobox", { name: "빌드" }), "newer");
  expect(summary.getByText("com.example.app · 2.0 (2)")).toBeInTheDocument();
  expect(summary.getByText("조건에 맞는 기기 0대")).toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: /matrix/ }));
  expect(summary.getByText("matrix")).toBeInTheDocument();
});

test("submits the default workspace form as multipart and navigates after invalidating runs", async () => {
  const { calls, client, user } = setup();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  expect(await screen.findByRole("combobox", { name: "워크스페이스" })).toHaveValue("example-app");
  expect(screen.getByPlaceholderText("main")).toHaveValue("");
  expect(screen.getByRole("radio", { name: /split/ })).toBeChecked();
  expect(screen.getByRole("radio", { name: "사용 가능한 기기 전체" })).toBeChecked();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "패키지" })).toHaveValue("com.example.app");
  await user.click(screen.getByRole("button", { name: "실행 시작" }));
  expect(await screen.findByTestId("navigated")).toBeInTheDocument();
  const post = calls.find(c => c.method === "POST")!;
  expect(post.path).toBe("/api/v1/runs");
  expect(post.headers).toMatchObject({ Authorization: "Bearer t" });
  expect(post.headers).not.toHaveProperty("Content-Type");
  expect(post.body).toBeInstanceOf(FormData);
  const body = post.body as FormData;
  expect(JSON.parse(String(body.get("options")))).toEqual({
    mode: "split", origin: "dashboard", flow_source: "workspace", workspace: "example-app",
    app: "com.example.app@latest", device_selector: {}, include_tags: [], exclude_tags: [], env: {},
  });
  expect(body.has("flows")).toBe(false);
  expect(body.has("apk")).toBe(false);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.runsAll });
});

test("shows no_matching_devices without losing form values or navigating", async () => {
  const { calls, user } = setup({ "POST /api/v1/runs": apiErrorResponse(400, "no_matching_devices", "조건에 맞는 기기가 없습니다.") });
  await screen.findByRole("combobox", { name: "워크스페이스" });
  await user.type(screen.getByRole("textbox", { name: "ref" }), "release");
  await user.click(screen.getByRole("button", { name: "실행 시작" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("조건에 맞는 기기가 없습니다. (no_matching_devices)");
  expect(screen.getByRole("textbox", { name: "ref" })).toHaveValue("release");
  expect(screen.queryByTestId("navigated")).not.toBeInTheDocument();
  expect(calls.filter(c => c.method === "POST")).toHaveLength(1);
});

test("disables submit and shows the shared token notice when the farm requires a token", async () => {
  const { calls } = setup({ "GET /api/v1/healthz": healthBody({ auth_required: true }) }, "");
  await screen.findByRole("combobox", { name: "워크스페이스" });
  expect(await screen.findByText("쓰기 작업에는 API 토큰이 필요합니다.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "실행 시작" })).toBeDisabled();
  expect(calls.every(c => c.method === "GET")).toBe(true);
});

test("submits without a token when the farm does not require one", async () => {
  const { calls, user } = setup({}, "");
  await screen.findByRole("combobox", { name: "워크스페이스" });
  expect(screen.queryByText("쓰기 작업에는 API 토큰이 필요합니다.")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "실행 시작" }));
  expect(await screen.findByTestId("navigated")).toBeInTheDocument();
  const post = calls.find((c) => c.method === "POST")!;
  expect(post.headers).not.toHaveProperty("Authorization");
  expect(post.headers).toMatchObject({ "X-Farm-User": "Kim" });
});

test("defaults to the workspace package, hides purged builds and previews the selected build SDK", async () => {
  const { user } = setup({
    "GET /api/v1/apps": [
      app({ id: "other", package_name: "com.other" }),
      app({ id: "purged", purged: true, version_name: "purged", min_sdk: 99, created_at: "2026-10-20T06:00:00Z" }),
      app({ id: "new", version_name: "2.0", version_code: 2, min_sdk: 35 }),
      app({ id: "old", min_sdk: 24, created_at: "2026-10-19T05:00:00Z" }),
    ],
    "GET /api/v1/devices": [device({ tags: ["tablet"] })],
  });
  expect(await screen.findByRole("combobox", { name: "패키지" })).toHaveValue("com.example.app");
  expect(screen.queryByRole("option", { name: /purged/ })).not.toBeInTheDocument();
  expect(screen.getByText("조건에 맞는 기기 0대")).toBeInTheDocument();
  const devices = within(screen.getByRole("group", { name: "기기 조건" }));
  expect(devices.getByRole("status")).toHaveTextContent("실행할 기기 0대");
  expect(devices.getByRole("status")).toHaveTextContent("앱 최소 SDK 35 조건으로 1대 제외");
  expect(devices.getByRole("status")).toHaveTextContent("실행할 수 있는 기기가 없습니다.");
  expect(screen.getByRole("button", { name: "실행 시작" })).toBeDisabled();
  await user.selectOptions(screen.getByRole("combobox", { name: "빌드" }), "old");
  expect(screen.getByText("조건에 맞는 기기 1대")).toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: "조건으로 고르기" }));
  await user.click(screen.getByRole("button", { name: "tablet" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "빌드" }), "new");
  expect(devices.getByRole("status")).toHaveTextContent("실행할 기기 0대");
  await user.click(screen.getByRole("radio", { name: "APK 업로드" }));
  expect(screen.getByText("조건에 맞는 기기 1대")).toBeInTheDocument();
  expect(devices.getByRole("status")).not.toHaveTextContent("앱 최소 SDK");
});

test("changing workspace picks its default package and changing packages clears a selected build", async () => {
  const { calls, user } = setup({
    "GET /api/v1/workspaces": [workspace(), workspace({ id: "ws2", name: "second", default_app_package: "com.other" })],
    "GET /api/v1/apps": [app(), app({ id: "app2", package_name: "com.other" })],
  });
  await screen.findByRole("combobox", { name: "워크스페이스" });
  await user.selectOptions(screen.getByRole("combobox", { name: "빌드" }), "app1");
  await user.selectOptions(screen.getByRole("combobox", { name: "워크스페이스" }), "second");
  expect(screen.getByRole("combobox", { name: "패키지" })).toHaveValue("com.other");
  expect(screen.getByRole("combobox", { name: "빌드" })).toHaveValue("");
  await user.selectOptions(screen.getByRole("combobox", { name: "빌드" }), "app2");
  await user.selectOptions(screen.getByRole("combobox", { name: "패키지" }), "com.example.app");
  expect(screen.getByRole("combobox", { name: "빌드" })).toHaveValue("");
  await user.selectOptions(screen.getByRole("combobox", { name: "패키지" }), "com.other");
  await user.selectOptions(screen.getByRole("combobox", { name: "빌드" }), "app2");
  await user.click(screen.getByRole("button", { name: "실행 시작" }));
  await screen.findByTestId("navigated");
  const options = JSON.parse(String((calls.find(c => c.method === "POST")!.body as FormData).get("options")));
  expect(options).toMatchObject({ workspace: "second", app_build_id: "app2" });
  expect(options).not.toHaveProperty("app");
});

test("uploads zip and APK files and sends no stale workspace or library fields", async () => {
  const { calls, user } = setup();
  await screen.findByRole("combobox", { name: "워크스페이스" });
  await user.type(screen.getByRole("textbox", { name: "ref" }), "stale-ref");
  await user.click(screen.getByRole("radio", { name: "zip 업로드" }));
  await user.click(screen.getByRole("radio", { name: "APK 업로드" }));
  const zip = new File(["flows"], "flows.zip", { type: "application/zip" });
  const apk = new File(["apk"], "app.apk", { type: "application/vnd.android.package-archive" });
  await user.upload(screen.getByLabelText("Flow zip"), zip);
  await user.upload(screen.getByLabelText("APK 파일"), apk);
  const summary = within(screen.getByRole("complementary", { name: "실행 요약" }));
  expect(summary.getByText("flows.zip")).toBeInTheDocument();
  expect(summary.getByText("app.apk")).toBeInTheDocument();
  expect(summary.queryByText("example-app")).not.toBeInTheDocument();
  expect(summary.queryByText("com.example.app@latest")).not.toBeInTheDocument();
  expect(summary.queryByText("stale-ref")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "실행 시작" }));
  await screen.findByTestId("navigated");
  const body = calls.find(c => c.method === "POST")!.body as FormData;
  expect(body.get("flows")).toBe(zip);
  expect(body.get("apk")).toBe(apk);
  expect(JSON.parse(String(body.get("options")))).toEqual({
    mode: "split", origin: "dashboard", flow_source: "upload", device_selector: {}, include_tags: [], exclude_tags: [], env: {},
  });
});

test("defaults to zip without workspaces and validates each required source before posting", async () => {
  const { calls, user } = setup({ "GET /api/v1/workspaces": [], "GET /api/v1/apps": [] });
  expect(await screen.findByRole("radio", { name: "zip 업로드" })).toBeChecked();
  await user.click(screen.getByRole("radio", { name: "워크스페이스" }));
  await user.click(screen.getByRole("button", { name: "실행 시작" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("워크스페이스를 선택하세요.");
  await user.click(screen.getByRole("radio", { name: "zip 업로드" }));
  await user.click(screen.getByRole("button", { name: "실행 시작" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Flow zip 파일을 선택하세요.");
  await user.upload(screen.getByLabelText("Flow zip"), new File(["zip"], "flows.zip"));
  await user.click(screen.getByRole("button", { name: "실행 시작" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("앱 빌드를 선택하세요.");
  await user.click(screen.getByRole("radio", { name: "APK 업로드" }));
  await user.click(screen.getByRole("button", { name: "실행 시작" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("APK 파일을 선택하세요.");
  expect(calls.filter(c => c.method === "POST")).toHaveLength(0);
});

test("rejects malformed env before posting and keeps the input", async () => {
  const { calls, user } = setup();
  await screen.findByRole("combobox", { name: "워크스페이스" });
  await user.type(screen.getByRole("textbox", { name: "환경 변수" }), "NOPE");
  await user.click(screen.getByRole("button", { name: "실행 시작" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("KEY=VALUE 형식이 아닙니다: NOPE");
  expect(screen.getByRole("textbox", { name: "환경 변수" })).toHaveValue("NOPE");
  expect(calls.filter(c => c.method === "POST")).toHaveLength(0);
});

test("requires every selected device tag and submits advanced conditions with optional flow filters", async () => {
  const { calls, user } = setup({
    "GET /api/v1/devices": [
      device({ tags: ["smoke", "tablet", "smoke"] }),
      device({ serial: "second", model: "Tablet", sdk_int: 30, tags: ["smoke"] }),
    ],
  });
  await screen.findByRole("combobox", { name: "워크스페이스" });
  expect(screen.getByText("조건에 맞는 기기 2대")).toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: "조건으로 고르기" }));
  expect(screen.getByRole("textbox", { name: "모델" })).not.toBeVisible();
  expect(screen.getAllByRole("button", { name: "smoke" })).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "smoke" }));
  expect(screen.getByText("조건에 맞는 기기 2대")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "tablet" }));
  expect(screen.getByText("조건에 맞는 기기 1대")).toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: /matrix/ }));
  await user.click(screen.getByText("고급 조건"));
  expect(screen.getByRole("spinbutton", { name: "최소 SDK" })).toHaveValue(null);
  expect(screen.getByRole("spinbutton", { name: "최대 SDK" })).toHaveValue(null);
  await user.type(screen.getByRole("textbox", { name: "모델" }), "Pixel 7, Tablet");
  fireEvent.change(screen.getByRole("spinbutton", { name: "최소 SDK" }), { target: { value: "24" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "최대 SDK" }), { target: { value: "33" } });
  expect(screen.getByText("조건에 맞는 기기 0대")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("spinbutton", { name: "최대 SDK" }), { target: { value: "35" } });
  await user.type(screen.getByRole("textbox", { name: "포함 태그" }), "fast");
  await user.type(screen.getByRole("textbox", { name: "제외 태그" }), "slow");
  await user.type(screen.getByRole("textbox", { name: /Flow 경로/ }), "login.yaml\nhome.yaml");
  await user.type(screen.getByRole("textbox", { name: "환경 변수" }), "A=x=y");
  fireEvent.change(screen.getByRole("spinbutton", { name: "Task 타임아웃(초)" }), { target: { value: "120" } });
  await user.click(screen.getByRole("button", { name: "실행 시작" }));
  await screen.findByTestId("navigated");
  const options = JSON.parse(String((calls.find(c => c.method === "POST")!.body as FormData).get("options")));
  expect(options).toMatchObject({
    mode: "matrix", device_selector: { tags: ["smoke", "tablet"], models: ["Pixel 7", "Tablet"], min_sdk: 24, max_sdk: 35 },
    include_tags: ["fast"], exclude_tags: ["slow"], flow_paths: ["login.yaml", "home.yaml"], env: { A: "x=y" }, task_timeout_sec: 120,
  });
});

test("picks serials from compact rows and folds disabled and offline devices into an unselectable list", async () => {
  const { calls, user } = setup({
    "GET /api/v1/devices": [
      device(), device({ serial: "busy", state: "busy" }),
      device({ serial: "offline", state: "offline" }), device({ serial: "disabled", disabled: true }),
      device({ serial: "reserved", state: "reserved" }), device({ serial: "unhealthy", state: "unhealthy" }),
    ],
  });
  await screen.findByRole("combobox", { name: "워크스페이스" });
  await user.click(screen.getByRole("radio", { name: "직접 고르기" }));
  expect(screen.getByRole("checkbox", { name: "emulator-5554 (Pixel 7)" })).toBeVisible();
  expect(screen.getByRole("checkbox", { name: "busy (Pixel 7)" })).toBeVisible();
  expect(screen.getByRole("checkbox", { name: "offline (Pixel 7)" })).not.toBeVisible();
  expect(screen.getByRole("checkbox", { name: "disabled (Pixel 7)" })).not.toBeVisible();
  expect(screen.getByRole("button", { name: "실행 시작" })).toBeDisabled();
  await user.click(screen.getByText("사용할 수 없는 기기 4대"));
  expect(screen.getByRole("checkbox", { name: "offline (Pixel 7)" })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "disabled (Pixel 7)" })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "reserved (Pixel 7)" })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: "unhealthy (Pixel 7)" })).toBeDisabled();
  expect(screen.getByText("오프라인")).toBeInTheDocument();
  expect(screen.getByText("정비 모드")).toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", { name: "busy (Pixel 7)" }));
  const summary = within(screen.getByRole("group", { name: "기기 조건" })).getByRole("status");
  expect(summary).toHaveTextContent("실행할 기기 1대 · busy");
  await user.click(screen.getByRole("button", { name: "실행 시작" }));
  await screen.findByTestId("navigated");
  const options = JSON.parse(String((calls.find(c => c.method === "POST")!.body as FormData).get("options")));
  expect(options.device_selector).toEqual({ serials: ["busy"] });
});

test("selects only runnable devices with select-all and treats clear-selection as zero devices", async () => {
  const { calls, user } = setup({
    "GET /api/v1/devices": [
      device(), device({ serial: "busy", state: "busy" }),
      device({ serial: "offline", state: "offline" }), device({ serial: "disabled", disabled: true }),
      device({ serial: "held", reservation: {
        id: "res1", device_serial: "held", holder_name: "Kim", status: "active",
        created_at: "2026-10-20T05:00:00Z", expires_at: "2026-10-20T06:00:00Z", released_at: null,
      } }),
    ],
  });
  await screen.findByRole("combobox", { name: "워크스페이스" });
  await user.click(screen.getByRole("radio", { name: "직접 고르기" }));
  await user.click(screen.getByRole("button", { name: "모두 선택" }));
  expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "선택 해제" }));
  for (const checkbox of screen.getAllByRole("checkbox")) expect(checkbox).not.toBeChecked();
  const summary = within(screen.getByRole("group", { name: "기기 조건" })).getByRole("status");
  expect(summary).toHaveTextContent("실행할 기기 0대");
  expect(summary).toHaveTextContent("실행할 수 있는 기기가 없습니다.");
  expect(screen.getByRole("button", { name: "실행 시작" })).toBeDisabled();
  fireEvent.submit(screen.getByRole("button", { name: "실행 시작" }).closest("form")!);
  expect(calls.some(c => c.method === "POST")).toBe(false);
  await user.click(screen.getByRole("button", { name: "모두 선택" }));
  await user.click(screen.getByRole("button", { name: "실행 시작" }));
  await screen.findByTestId("navigated");
  const options = JSON.parse(String((calls.find(c => c.method === "POST")!.body as FormData).get("options")));
  expect(options.device_selector).toEqual({ serials: ["emulator-5554", "busy"] });
});

test.each(["사용 가능한 기기 전체", "조건으로 고르기"])("clears manual serials when switching to %s", async mode => {
  const { calls, user } = setup({ "GET /api/v1/devices": [device(), device({ serial: "second" })] });
  await screen.findByRole("combobox", { name: "워크스페이스" });
  await user.click(screen.getByRole("radio", { name: "직접 고르기" }));
  await user.click(screen.getByRole("checkbox", { name: "emulator-5554 (Pixel 7)" }));
  await user.click(screen.getByRole("radio", { name: mode }));
  expect(screen.getByText("조건에 맞는 기기 2대")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "실행 시작" }));
  await screen.findByTestId("navigated");
  const options = JSON.parse(String((calls.find(c => c.method === "POST")!.body as FormData).get("options")));
  expect(options.device_selector).toEqual({});
});

test.each(["사용 가능한 기기 전체", "직접 고르기"])("clears tags and advanced fields when switching to %s", async mode => {
  const { calls, user } = setup({
    "GET /api/v1/devices": [device({ tags: ["smoke"] }), device({ serial: "second", model: "Tablet", sdk_int: 30 })],
  });
  await screen.findByRole("combobox", { name: "워크스페이스" });
  await user.click(screen.getByRole("radio", { name: "조건으로 고르기" }));
  await user.click(screen.getByRole("button", { name: "smoke" }));
  await user.click(screen.getByText("고급 조건"));
  await user.type(screen.getByRole("textbox", { name: "모델" }), "Pixel 7");
  fireEvent.change(screen.getByRole("spinbutton", { name: "최소 SDK" }), { target: { value: "33" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "최대 SDK" }), { target: { value: "34" } });
  // Clicking the selected mode must not clear its conditions.
  await user.click(screen.getByRole("radio", { name: "조건으로 고르기" }));
  expect(screen.getByRole("textbox", { name: "모델" })).toHaveValue("Pixel 7");
  await user.click(screen.getByRole("radio", { name: mode }));
  if (mode === "직접 고르기") {
    await user.click(screen.getByRole("checkbox", { name: "second (Tablet)" }));
  }
  expect(screen.getByText(`조건에 맞는 기기 ${mode === "직접 고르기" ? 1 : 2}대`)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "실행 시작" }));
  await screen.findByTestId("navigated");
  const options = JSON.parse(String((calls.find(c => c.method === "POST")!.body as FormData).get("options")));
  expect(options.device_selector).toEqual(mode === "직접 고르기" ? { serials: ["second"] } : {});
});

test("summarizes the first five matching serials and the remaining count", async () => {
  setup({ "GET /api/v1/devices": Array.from({ length: 7 }, (_, i) => device({ serial: `serial-${i + 1}` })) });
  await screen.findByRole("combobox", { name: "워크스페이스" });
  const summary = within(screen.getByRole("group", { name: "기기 조건" })).getByRole("status");
  expect(summary).toHaveTextContent("실행할 기기 7대 · serial-1, serial-2, serial-3, serial-4, serial-5 외 2대");
  expect(summary).not.toHaveTextContent("serial-6");
});

test("warns and prevents submitting when no devices can run", async () => {
  const { calls, user } = setup({ "GET /api/v1/devices": [device({ state: "offline" })] });
  await screen.findByRole("combobox", { name: "워크스페이스" });
  const summary = within(screen.getByRole("group", { name: "기기 조건" })).getByRole("status");
  expect(summary).toHaveTextContent("실행할 기기 0대");
  expect(summary).toHaveTextContent("실행할 수 있는 기기가 없습니다.");
  await user.click(screen.getByRole("button", { name: "실행 시작" }));
  expect(calls.some(c => c.method === "POST")).toBe(false);
});

test("supports keyboard mode selection and toggling a tag off", async () => {
  const { user } = setup({
    "GET /api/v1/devices": [device({ tags: ["smoke"] }), device({ serial: "second" })],
  });
  await screen.findByRole("combobox", { name: "워크스페이스" });
  screen.getByRole("radio", { name: "사용 가능한 기기 전체" }).focus();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("radio", { name: "직접 고르기" })).toHaveFocus();
  expect(screen.getByRole("radio", { name: "직접 고르기" })).toBeChecked();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("radio", { name: "조건으로 고르기" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "smoke" }));
  expect(screen.getByRole("button", { name: "smoke" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("조건에 맞는 기기 1대")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "smoke" }));
  expect(screen.getByRole("button", { name: "smoke" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByText("조건에 맞는 기기 2대")).toBeInTheDocument();
});
