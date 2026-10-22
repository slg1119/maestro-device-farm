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
  await screen.findByRole("combobox", { name: "저장소" });
  const summary = within(screen.getByRole("complementary", { name: "실행 요약" }));
  expect(summary.getByText("example-app")).toBeInTheDocument();
  expect(summary.getByText("com.example.app · 가장 최근 버전")).toBeInTheDocument();
  expect(summary.getByText("나눠서 한 번씩")).toBeInTheDocument();
  expect(summary.getByText("실행할 기기 1대")).toBeInTheDocument();
  expect(summary.getByRole("button", { name: "실행 시작" })).toBeInTheDocument();
  await user.type(screen.getByRole("textbox", { name: "브랜치 또는 커밋" }), "release");
  expect(summary.getByText("release")).toBeInTheDocument();
  await user.selectOptions(screen.getByRole("combobox", { name: "버전" }), "newer");
  expect(summary.getByText("com.example.app · 2.0 (2)")).toBeInTheDocument();
  expect(summary.getByText("실행할 기기 0대")).toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: /기기마다 전부/ }));
  expect(summary.getByText("기기마다 전부")).toBeInTheDocument();
});

test("submits the default workspace form as multipart and navigates after invalidating runs", async () => {
  const { calls, client, user } = setup({
    "GET /api/v1/healthz": healthBody({ default_task_timeout_sec: 1800 }),
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  expect(await screen.findByRole("combobox", { name: "저장소" })).toHaveValue("example-app");
  expect(screen.getByPlaceholderText("main")).toHaveValue("");
  expect(screen.getByRole("radio", { name: /나눠서 한 번씩/ })).toBeChecked();
  expect(screen.getByRole("radio", { name: "사용 가능한 기기 전체" })).toBeChecked();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "앱" })).toHaveValue("com.example.app");
  expect(await screen.findByPlaceholderText("비우면 30분")).toHaveValue(null);
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

test.each([
  [1800, "비우면 30분"],
  [5400, "비우면 1시간 30분"],
])("shows the server's %i-second default as the timeout placeholder", async (seconds, placeholder) => {
  setup({ "GET /api/v1/healthz": healthBody({ default_task_timeout_sec: seconds }) });
  const timeout = await screen.findByPlaceholderText(placeholder);
  expect(timeout).toHaveAccessibleName("제한 시간(초)");
  expect(timeout).toHaveValue(null);
});

test("uses a generic timeout placeholder when an older server omits the default", async () => {
  const { client } = setup();
  const timeout = await screen.findByRole("spinbutton", { name: "제한 시간(초)" });
  await vi.waitFor(() => expect(client.getQueryState(keys.health)?.status).toBe("success"));
  expect(timeout).toHaveAttribute("placeholder", "비우면 서버 기본값");
  expect(timeout).toHaveValue(null);
});

test("uses a generic timeout placeholder while health loads and preserves typed input when it arrives", async () => {
  let resolveHealth!: (body: ReturnType<typeof healthBody>) => void;
  const health = new Promise<ReturnType<typeof healthBody>>(resolve => { resolveHealth = resolve; });
  setup({ "GET /api/v1/healthz": () => health });
  const timeout = await screen.findByRole("spinbutton", { name: "제한 시간(초)" });
  expect(timeout).toHaveAttribute("placeholder", "비우면 서버 기본값");
  fireEvent.change(timeout, { target: { value: "120" } });
  resolveHealth(healthBody({ default_task_timeout_sec: 5400 }));
  expect(await screen.findByPlaceholderText("비우면 1시간 30분")).toHaveValue(120);
});

test("shows no_matching_devices without losing form values or navigating", async () => {
  const { calls, user } = setup({ "POST /api/v1/runs": apiErrorResponse(400, "no_matching_devices", "조건에 맞는 기기가 없습니다.") });
  await screen.findByRole("combobox", { name: "저장소" });
  await user.type(screen.getByRole("textbox", { name: "브랜치 또는 커밋" }), "release");
  await user.click(screen.getByRole("button", { name: "실행 시작" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("조건에 맞는 기기가 없습니다. (no_matching_devices)");
  expect(screen.getByRole("textbox", { name: "브랜치 또는 커밋" })).toHaveValue("release");
  expect(screen.queryByTestId("navigated")).not.toBeInTheDocument();
  expect(calls.filter(c => c.method === "POST")).toHaveLength(1);
});

test("disables submit and shows the shared token notice when the farm requires a token", async () => {
  const { calls } = setup({ "GET /api/v1/healthz": healthBody({ auth_required: true }) }, "");
  await screen.findByRole("combobox", { name: "저장소" });
  expect(await screen.findByText("쓰기 작업에는 API 토큰이 필요합니다.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "실행 시작" })).toBeDisabled();
  expect(calls.every(c => c.method === "GET")).toBe(true);
});

test("submits without a token when the farm does not require one", async () => {
  const { calls, user } = setup({}, "");
  await screen.findByRole("combobox", { name: "저장소" });
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
  expect(await screen.findByRole("combobox", { name: "앱" })).toHaveValue("com.example.app");
  expect(screen.queryByRole("option", { name: /purged/ })).not.toBeInTheDocument();
  expect(within(screen.getByRole("complementary", { name: "실행 요약" })).getByText("실행할 기기 0대")).toBeInTheDocument();
  const devices = within(screen.getByRole("group", { name: "실행할 기기" }));
  expect(devices.getByRole("status")).toHaveTextContent("실행할 기기 0대");
  expect(devices.getByRole("status")).toHaveTextContent("앱이 지원하지 않는 안드로이드 버전이라 1대 제외");
  expect(devices.getByRole("status")).toHaveTextContent("실행할 수 있는 기기가 없습니다.");
  expect(screen.getByRole("button", { name: "실행 시작" })).toBeDisabled();
  await user.selectOptions(screen.getByRole("combobox", { name: "버전" }), "old");
  expect(within(screen.getByRole("complementary", { name: "실행 요약" })).getByText("실행할 기기 1대")).toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: "조건으로 고르기" }));
  await user.click(screen.getByRole("button", { name: "tablet" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "버전" }), "new");
  expect(devices.getByRole("status")).toHaveTextContent("실행할 기기 0대");
  await user.click(screen.getByRole("radio", { name: "APK 파일 올리기" }));
  expect(within(screen.getByRole("complementary", { name: "실행 요약" })).getByText("실행할 기기 1대")).toBeInTheDocument();
  expect(devices.getByRole("status")).not.toHaveTextContent("앱이 지원하지 않는 안드로이드 버전");
});

test("changing workspace picks its default package and changing packages clears a selected build", async () => {
  const { calls, user } = setup({
    "GET /api/v1/workspaces": [workspace(), workspace({ id: "ws2", name: "second", default_app_package: "com.other" })],
    "GET /api/v1/apps": [app(), app({ id: "app2", package_name: "com.other" })],
  });
  await screen.findByRole("combobox", { name: "저장소" });
  await user.selectOptions(screen.getByRole("combobox", { name: "버전" }), "app1");
  await user.selectOptions(screen.getByRole("combobox", { name: "저장소" }), "second");
  expect(screen.getByRole("combobox", { name: "앱" })).toHaveValue("com.other");
  expect(screen.getByRole("combobox", { name: "버전" })).toHaveValue("");
  await user.selectOptions(screen.getByRole("combobox", { name: "버전" }), "app2");
  await user.selectOptions(screen.getByRole("combobox", { name: "앱" }), "com.example.app");
  expect(screen.getByRole("combobox", { name: "버전" })).toHaveValue("");
  await user.selectOptions(screen.getByRole("combobox", { name: "앱" }), "com.other");
  await user.selectOptions(screen.getByRole("combobox", { name: "버전" }), "app2");
  await user.click(screen.getByRole("button", { name: "실행 시작" }));
  await screen.findByTestId("navigated");
  const options = JSON.parse(String((calls.find(c => c.method === "POST")!.body as FormData).get("options")));
  expect(options).toMatchObject({ workspace: "second", app_build_id: "app2" });
  expect(options).not.toHaveProperty("app");
});

test("uploads zip and APK files and sends no stale workspace or library fields", async () => {
  const { calls, user } = setup();
  await screen.findByRole("combobox", { name: "저장소" });
  await user.type(screen.getByRole("textbox", { name: "브랜치 또는 커밋" }), "stale-ref");
  await user.click(screen.getByRole("radio", { name: "zip 파일 올리기" }));
  await user.click(screen.getByRole("radio", { name: "APK 파일 올리기" }));
  const zip = new File(["flows"], "flows.zip", { type: "application/zip" });
  const apk = new File(["apk"], "app.apk", { type: "application/vnd.android.package-archive" });
  await user.upload(screen.getByLabelText("테스트 zip 파일"), zip);
  await user.upload(screen.getByLabelText("APK 파일"), apk);
  const summary = within(screen.getByRole("complementary", { name: "실행 요약" }));
  expect(summary.getByText("flows.zip")).toBeInTheDocument();
  expect(summary.getByText("app.apk")).toBeInTheDocument();
  expect(summary.queryByText("example-app")).not.toBeInTheDocument();
  expect(summary.queryByText("com.example.app · 가장 최근 버전")).not.toBeInTheDocument();
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
  expect(await screen.findByRole("radio", { name: "zip 파일 올리기" })).toBeChecked();
  await user.click(screen.getByRole("radio", { name: "등록된 저장소" }));
  await user.click(screen.getByRole("button", { name: "실행 시작" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("저장소를 고르세요.");
  await user.click(screen.getByRole("radio", { name: "zip 파일 올리기" }));
  await user.click(screen.getByRole("button", { name: "실행 시작" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("테스트 zip 파일을 올리세요.");
  await user.upload(screen.getByLabelText("테스트 zip 파일"), new File(["zip"], "flows.zip"));
  await user.click(screen.getByRole("button", { name: "실행 시작" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("앱 버전을 고르세요.");
  await user.click(screen.getByRole("radio", { name: "APK 파일 올리기" }));
  await user.click(screen.getByRole("button", { name: "실행 시작" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("APK 파일을 올리세요.");
  expect(calls.filter(c => c.method === "POST")).toHaveLength(0);
});

test("rejects malformed env before posting and keeps the input", async () => {
  const { calls, user } = setup();
  await screen.findByRole("combobox", { name: "저장소" });
  await user.type(screen.getByRole("textbox", { name: "테스트에 넘길 값" }), "NOPE");
  await user.click(screen.getByRole("button", { name: "실행 시작" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("테스트에 넘길 값은 KEY=VALUE 형식으로 입력하세요: NOPE");
  expect(screen.getByRole("textbox", { name: "테스트에 넘길 값" })).toHaveValue("NOPE");
  expect(calls.filter(c => c.method === "POST")).toHaveLength(0);
});

test("requires every selected device tag and submits advanced conditions with optional flow filters", async () => {
  const { calls, user } = setup({
    "GET /api/v1/devices": [
      device({ tags: ["smoke", "tablet", "smoke"] }),
      device({ serial: "second", model: "Tablet", sdk_int: 30, tags: ["smoke"] }),
    ],
  });
  await screen.findByRole("combobox", { name: "저장소" });
  expect(within(screen.getByRole("complementary", { name: "실행 요약" })).getByText("실행할 기기 2대")).toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: "조건으로 고르기" }));
  expect(screen.getByRole("textbox", { name: "모델" })).not.toBeVisible();
  expect(screen.getAllByRole("button", { name: "smoke" })).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "smoke" }));
  expect(within(screen.getByRole("complementary", { name: "실행 요약" })).getByText("실행할 기기 2대")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "tablet" }));
  expect(within(screen.getByRole("complementary", { name: "실행 요약" })).getByText("실행할 기기 1대")).toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: /기기마다 전부/ }));
  await user.click(screen.getByText("모델·안드로이드 버전"));
  expect(screen.getByRole("spinbutton", { name: "안드로이드 API 레벨 (이상)" })).toHaveValue(null);
  expect(screen.getByRole("spinbutton", { name: "안드로이드 API 레벨 (이하)" })).toHaveValue(null);
  await user.type(screen.getByRole("textbox", { name: "모델" }), "Pixel 7, Tablet");
  fireEvent.change(screen.getByRole("spinbutton", { name: "안드로이드 API 레벨 (이상)" }), { target: { value: "24" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "안드로이드 API 레벨 (이하)" }), { target: { value: "33" } });
  expect(within(screen.getByRole("complementary", { name: "실행 요약" })).getByText("실행할 기기 0대")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("spinbutton", { name: "안드로이드 API 레벨 (이하)" }), { target: { value: "35" } });
  await user.type(screen.getByRole("textbox", { name: "이 태그가 하나라도 붙은 테스트만" }), "fast");
  await user.type(screen.getByRole("textbox", { name: "이 태그가 붙은 테스트는 빼기" }), "slow");
  await user.type(screen.getByRole("textbox", { name: "테스트 파일 직접 지정" }), "login.yaml\nhome.yaml");
  await user.type(screen.getByRole("textbox", { name: "테스트에 넘길 값" }), "A=x=y");
  fireEvent.change(screen.getByRole("spinbutton", { name: "제한 시간(초)" }), { target: { value: "120" } });
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
  await screen.findByRole("combobox", { name: "저장소" });
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
  const summary = within(screen.getByRole("group", { name: "실행할 기기" })).getByRole("status");
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
  await screen.findByRole("combobox", { name: "저장소" });
  await user.click(screen.getByRole("radio", { name: "직접 고르기" }));
  await user.click(screen.getByRole("button", { name: "모두 선택" }));
  expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "선택 해제" }));
  for (const checkbox of screen.getAllByRole("checkbox")) expect(checkbox).not.toBeChecked();
  const summary = within(screen.getByRole("group", { name: "실행할 기기" })).getByRole("status");
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
  await screen.findByRole("combobox", { name: "저장소" });
  await user.click(screen.getByRole("radio", { name: "직접 고르기" }));
  await user.click(screen.getByRole("checkbox", { name: "emulator-5554 (Pixel 7)" }));
  await user.click(screen.getByRole("radio", { name: mode }));
  expect(within(screen.getByRole("complementary", { name: "실행 요약" })).getByText("실행할 기기 2대")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "실행 시작" }));
  await screen.findByTestId("navigated");
  const options = JSON.parse(String((calls.find(c => c.method === "POST")!.body as FormData).get("options")));
  expect(options.device_selector).toEqual({});
});

test.each(["사용 가능한 기기 전체", "직접 고르기"])("clears tags and advanced fields when switching to %s", async mode => {
  const { calls, user } = setup({
    "GET /api/v1/devices": [device({ tags: ["smoke"] }), device({ serial: "second", model: "Tablet", sdk_int: 30 })],
  });
  await screen.findByRole("combobox", { name: "저장소" });
  await user.click(screen.getByRole("radio", { name: "조건으로 고르기" }));
  await user.click(screen.getByRole("button", { name: "smoke" }));
  await user.click(screen.getByText("모델·안드로이드 버전"));
  await user.type(screen.getByRole("textbox", { name: "모델" }), "Pixel 7");
  fireEvent.change(screen.getByRole("spinbutton", { name: "안드로이드 API 레벨 (이상)" }), { target: { value: "33" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "안드로이드 API 레벨 (이하)" }), { target: { value: "34" } });
  // Clicking the selected mode must not clear its conditions.
  await user.click(screen.getByRole("radio", { name: "조건으로 고르기" }));
  expect(screen.getByRole("textbox", { name: "모델" })).toHaveValue("Pixel 7");
  await user.click(screen.getByRole("radio", { name: mode }));
  if (mode === "직접 고르기") {
    await user.click(screen.getByRole("checkbox", { name: "second (Tablet)" }));
  }
  expect(within(screen.getByRole("complementary", { name: "실행 요약" })).getByText(`실행할 기기 ${mode === "직접 고르기" ? 1 : 2}대`)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "실행 시작" }));
  await screen.findByTestId("navigated");
  const options = JSON.parse(String((calls.find(c => c.method === "POST")!.body as FormData).get("options")));
  expect(options.device_selector).toEqual(mode === "직접 고르기" ? { serials: ["second"] } : {});
});

test("summarizes the first five matching serials and the remaining count", async () => {
  setup({ "GET /api/v1/devices": Array.from({ length: 7 }, (_, i) => device({ serial: `serial-${i + 1}` })) });
  await screen.findByRole("combobox", { name: "저장소" });
  const summary = within(screen.getByRole("group", { name: "실행할 기기" })).getByRole("status");
  expect(summary).toHaveTextContent("실행할 기기 7대 · serial-1, serial-2, serial-3, serial-4, serial-5 외 2대");
  expect(summary).not.toHaveTextContent("serial-6");
});

test("warns and prevents submitting when no devices can run", async () => {
  const { calls, user } = setup({ "GET /api/v1/devices": [device({ state: "offline" })] });
  await screen.findByRole("combobox", { name: "저장소" });
  const summary = within(screen.getByRole("group", { name: "실행할 기기" })).getByRole("status");
  expect(summary).toHaveTextContent("실행할 기기 0대");
  expect(summary).toHaveTextContent("실행할 수 있는 기기가 없습니다.");
  await user.click(screen.getByRole("button", { name: "실행 시작" }));
  expect(calls.some(c => c.method === "POST")).toBe(false);
});

test("supports keyboard mode selection and toggling a tag off", async () => {
  const { user } = setup({
    "GET /api/v1/devices": [device({ tags: ["smoke"] }), device({ serial: "second" })],
  });
  await screen.findByRole("combobox", { name: "저장소" });
  screen.getByRole("radio", { name: "사용 가능한 기기 전체" }).focus();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("radio", { name: "직접 고르기" })).toHaveFocus();
  expect(screen.getByRole("radio", { name: "직접 고르기" })).toBeChecked();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("radio", { name: "조건으로 고르기" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "smoke" }));
  expect(screen.getByRole("button", { name: "smoke" })).toHaveAttribute("aria-pressed", "true");
  expect(within(screen.getByRole("complementary", { name: "실행 요약" })).getByText("실행할 기기 1대")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "smoke" }));
  expect(screen.getByRole("button", { name: "smoke" })).toHaveAttribute("aria-pressed", "false");
  expect(within(screen.getByRole("complementary", { name: "실행 요약" })).getByText("실행할 기기 2대")).toBeInTheDocument();
});


test("explains file paths relative to the selected repository folder or the zip", async () => {
  const { user } = setup({
    "GET /api/v1/workspaces": [workspace(), workspace({ id: "ws2", name: "second", branch: "release", path: "qa/tests" })],
  });
  await screen.findByRole("combobox", { name: "저장소" });
  expect(screen.getByText("어떤 테스트를, 어떤 앱으로, 어떤 기기에서 돌릴지 고릅니다.")).toBeInTheDocument();
  expect(screen.getByText("비워두면 전체 테스트를 돌립니다.")).toBeInTheDocument();
  expect(screen.getByText("비우면 main 브랜치의 최신 상태로 실행합니다.")).toBeInTheDocument();
  expect(screen.getByText(".maestro 폴더 기준 파일 경로, 한 줄에 하나. 지정하면 태그 조건은 쓰지 않습니다.")).toBeInTheDocument();
  expect(screen.getByPlaceholderText("flows/login.yaml")).toHaveValue("");
  await user.selectOptions(screen.getByRole("combobox", { name: "저장소" }), "second");
  expect(screen.getByText("비우면 release 브랜치의 최신 상태로 실행합니다.")).toBeInTheDocument();
  expect(screen.getByText("qa/tests 폴더 기준 파일 경로, 한 줄에 하나. 지정하면 태그 조건은 쓰지 않습니다.")).toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: "zip 파일 올리기" }));
  expect(screen.getByText("zip 안의 경로, 한 줄에 하나. 지정하면 태그 조건은 쓰지 않습니다.")).toBeInTheDocument();
  expect(screen.getByText("zip 파일을 올리세요")).toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: "APK 파일 올리기" }));
  expect(screen.getByText("APK 파일을 올리세요")).toBeInTheDocument();
});

test("disables tags for any file-field content and restores their values when cleared", async () => {
  const { user } = setup();
  await screen.findByRole("combobox", { name: "저장소" });
  const include = screen.getByRole("textbox", { name: "이 태그가 하나라도 붙은 테스트만" });
  const exclude = screen.getByRole("textbox", { name: "이 태그가 붙은 테스트는 빼기" });
  const paths = screen.getByRole("textbox", { name: "테스트 파일 직접 지정" });
  await user.type(include, "smoke, fast");
  await user.type(exclude, "known-issue");
  for (const value of ["flows/login.yaml", " "]) {
    await user.type(paths, value);
    expect(include).toBeDisabled();
    expect(exclude).toBeDisabled();
    expect(include).toHaveValue("smoke, fast");
    expect(exclude).toHaveValue("known-issue");
    expect(screen.getByText("파일을 직접 지정한 동안에는 태그 조건을 쓰지 않습니다.")).toBeInTheDocument();
    await user.clear(paths);
    expect(include).toBeEnabled();
    expect(exclude).toBeEnabled();
    expect(include).toHaveValue("smoke, fast");
    expect(exclude).toHaveValue("known-issue");
    expect(screen.queryByText("파일을 직접 지정한 동안에는 태그 조건을 쓰지 않습니다.")).not.toBeInTheDocument();
  }
});

test("explains the timeout scope and retry behavior for each execution mode", async () => {
  const { user } = setup();
  await screen.findByRole("combobox", { name: "저장소" });
  const splitHint = "테스트 하나가 이 시간을 넘기면 중단하고 최대 한 번 더 시도합니다. 다시 넘기면 오류로 끝납니다.";
  const matrixHint = "기기 한 대가 모든 테스트를 끝내야 하는 시간입니다. 넘기면 그 기기의 테스트를 중단하고 처음부터 최대 한 번 더 시도합니다. 다시 넘기면 오류로 끝납니다.";
  const timeout = screen.getByRole("spinbutton", { name: "제한 시간(초)" });
  expect(screen.getByText(splitHint)).toBeInTheDocument();
  fireEvent.change(timeout, { target: { value: "120" } });
  await user.click(screen.getByRole("radio", { name: /기기마다 전부/ }));
  expect(screen.getByText(matrixHint)).toBeInTheDocument();
  expect(screen.queryByText(splitHint)).not.toBeInTheDocument();
  expect(timeout).toHaveValue(120);
  await user.click(screen.getByRole("radio", { name: /나눠서 한 번씩/ }));
  expect(screen.getByText(splitHint)).toBeInTheDocument();
  expect(screen.queryByText(matrixHint)).not.toBeInTheDocument();
  expect(timeout).toHaveValue(120);
});
