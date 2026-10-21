import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { saveSettings } from "../../../lib/settings";
import { apiErrorResponse, healthBody, jsonResponse, mockApi } from "../../../test/api";
import { app } from "../../../test/fixtures";
import { renderPage } from "../../../test/render";
import { AppsPage } from "../AppsPage";

function withToken() {
  saveSettings({ token: "t", authorName: "Kim", authorEmail: "kim@x.io" });
}

function apkFile() {
  return new File(["apk contents"], "example.apk", { type: "application/vnd.android.package-archive" });
}

test("uploads a dropped APK through the same multipart contract and refreshes builds", async () => {
  const file = apkFile();
  const { calls } = mockApi({
    "GET /api/v1/apps": [],
    "POST /api/v1/apps": jsonResponse(201, app()),
  });
  renderPage(<AppsPage />);
  const zone = screen.getByRole("region", { name: "APK 업로드 영역" });
  fireEvent.dragOver(zone, { dataTransfer: { files: [file], types: ["Files"] } });
  fireEvent.drop(zone, { dataTransfer: { files: [file] } });

  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("com.example.app 1.0 (1) 추가됨"));
  const request = calls.find(call => call.method === "POST")!;
  expect(request.body).toBeInstanceOf(FormData);
  expect((request.body as FormData).get("apk")).toBe(file);
  expect((request.body as FormData).get("source")).toBe("dashboard");
  expect(request.headers).not.toHaveProperty("Content-Type");
  expect(calls.filter(call => call.method === "GET")).toHaveLength(2);
});

test("ignores dropped files when writes require a missing token", async () => {
  const { calls } = mockApi({
    "GET /api/v1/apps": [],
    "GET /api/v1/healthz": healthBody({ auth_required: true }),
  });
  renderPage(<AppsPage />);
  await screen.findByText("쓰기 작업에는 API 토큰이 필요합니다.");
  const zone = screen.getByRole("region", { name: "APK 업로드 영역" });
  expect(zone).toHaveAttribute("aria-disabled", "true");
  fireEvent.drop(zone, { dataTransfer: { files: [apkFile()] } });
  expect(screen.getByRole("button", { name: "파일 선택" })).toBeDisabled();
  expect(calls.every(call => call.method === "GET")).toBe(true);
});

test("ignores duplicate drops while an APK is uploading and exposes server errors", async () => {
  let finish!: (response: Response) => void;
  const { calls } = mockApi({
    "GET /api/v1/apps": [],
    "POST /api/v1/apps": () => new Promise<Response>(resolve => { finish = resolve; }),
  });
  renderPage(<AppsPage />);
  await screen.findByText(/보관함이 비어 있습니다/);
  const zone = screen.getByRole("region", { name: "APK 업로드 영역" });
  fireEvent.drop(zone, { dataTransfer: { files: [apkFile()] } });
  expect(await screen.findByRole("button", { name: "업로드 중…" })).toBeDisabled();
  fireEvent.drop(zone, { dataTransfer: { files: [apkFile()] } });
  expect(calls.filter(call => call.method === "POST")).toHaveLength(1);
  finish(apiErrorResponse(400, "invalid_apk", "올바른 APK 파일이 아닙니다"));
  expect(await screen.findByRole("alert")).toHaveTextContent("올바른 APK 파일이 아닙니다 (invalid_apk)");
  expect(screen.getByRole("button", { name: "파일 선택" })).toBeEnabled();
});

test("groups builds by package with the newest package and latest label first", async () => {
  mockApi({ "GET /api/v1/apps": [
    app({ id: "new", package_name: "com.new.app", label: "새 앱", version_name: "2.0", version_code: 2,
      created_at: "2026-10-20T06:00:00.000000Z", ci_meta: { branch: "release", commit: "abcdef123456" } }),
    app({ id: "other", package_name: "com.other.app", label: "다른 앱", source: "dashboard", uploaded_by: "Kim" }),
    app({ id: "old", package_name: "com.new.app", label: "예전 이름", created_at: "2026-10-19T05:00:00.000000Z" }),
  ] });
  renderPage(<AppsPage />);

  await screen.findByRole("heading", { name: "com.new.app" });
  expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent))
    .toEqual(["com.new.app", "com.other.app"]);
  expect(screen.getByText("새 앱")).toBeInTheDocument();
  expect(screen.queryByText("예전 이름")).not.toBeInTheDocument();
  const tables = screen.getAllByRole("table");
  expect(within(tables[0]!).getAllByRole("row")).toHaveLength(3);
  expect(within(tables[1]!).getAllByRole("row")).toHaveLength(2);
  expect(within(tables[0]!).getAllByRole("row")[1]).toHaveTextContent("2.0 (2)");
  expect(within(tables[0]!).getAllByRole("row")[1]).toHaveTextContent("24");
  expect(within(tables[0]!).getAllByRole("row")[1]).toHaveTextContent("12 MB");
  expect(screen.getByText("release")).toBeInTheDocument();
  expect(screen.getByText("abcdef1")).toBeInTheDocument();
  expect(screen.getByText("대시보드")).toBeInTheDocument();
  expect(screen.getByText("Kim")).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "다운로드" })[0])
    .toHaveAttribute("href", "/api/v1/apps/new/download");
});

test.each([false, true])("toggles a build with pinned=%s and refreshes the library", async (pinned) => {
  withToken();
  let build = app({ pinned });
  const { calls } = mockApi({
    "GET /api/v1/apps": () => [build],
    "PATCH /api/v1/apps/app1": () => (build = app({ pinned: !pinned })),
  });
  renderPage(<AppsPage />);
  await userEvent.click(await screen.findByRole("button", { name: pinned ? "고정 해제" : "고정" }));

  await screen.findByRole("button", { name: pinned ? "고정" : "고정 해제" });
  expect(calls.find((call) => call.method === "PATCH"))
    .toMatchObject({ path: "/api/v1/apps/app1", body: { pinned: !pinned }, headers: { Authorization: "Bearer t" } });
  expect(calls.filter((call) => call.method === "GET")).toHaveLength(2);
  expect(screen.queryByText("고정됨") !== null).toBe(!pinned);
});

test.each([201, 200])("uploads multipart APK data and shows the %s result with a dismiss button", async (status) => {
  withToken();
  const build = app({ source: "dashboard" });
  const { calls } = mockApi({
    "GET /api/v1/apps": [],
    "POST /api/v1/apps": () => jsonResponse(status, build),
  });
  renderPage(<AppsPage />);
  const file = apkFile();
  const input = screen.getByLabelText("APK 파일");
  expect(input).toHaveAttribute("accept", ".apk");
  expect(input).toHaveAttribute("hidden");
  await userEvent.upload(input, file);

  const message = status === 201 ? "com.example.app 1.0 (1) 추가됨" : "이미 보관함에 있는 빌드입니다";
  expect(await screen.findByRole("status")).toHaveTextContent(message);
  const request = calls.find((call) => call.method === "POST")!;
  expect(request.path).toBe("/api/v1/apps");
  expect(request.headers.Authorization).toBe("Bearer t");
  expect(request.body).toBeInstanceOf(FormData);
  expect((request.body as FormData).get("apk")).toBe(file);
  expect((request.body as FormData).get("source")).toBe("dashboard");
  expect(calls.filter((call) => call.method === "GET")).toHaveLength(2);
  await userEvent.click(screen.getByRole("button", { name: "알림 닫기" }));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

test("shows purged files as deleted without a download link", async () => {
  mockApi({ "GET /api/v1/apps": [app({ purged: true })] });
  renderPage(<AppsPage />);
  expect(await screen.findByText("파일 삭제됨")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "다운로드" })).not.toBeInTheDocument();
});

test("filters package names by case-insensitive substring without requesting again", async () => {
  const { calls } = mockApi({ "GET /api/v1/apps": [
    app({ package_name: "com.Example.app" }), app({ id: "app2", package_name: "org.other.app" }),
  ] });
  renderPage(<AppsPage />);
  await screen.findByRole("heading", { name: "org.other.app" });
  const filter = screen.getByPlaceholderText("패키지 이름 검색");
  await userEvent.type(filter, "EXAMPLE");
  expect(screen.getByRole("heading", { name: "com.Example.app" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "org.other.app" })).not.toBeInTheDocument();
  await userEvent.clear(filter);
  expect(screen.getByRole("heading", { name: "org.other.app" })).toBeInTheDocument();
  expect(calls).toHaveLength(1);
});

test("disables writes without a token and keeps downloads available", async () => {
  mockApi({ "GET /api/v1/apps": [app()], "GET /api/v1/healthz": healthBody({ auth_required: true }) });
  renderPage(<AppsPage />);
  expect(await screen.findByText("쓰기 작업에는 API 토큰이 필요합니다.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "APK 업로드" })).toBeDisabled();
  expect(screen.getByLabelText("APK 파일")).toBeDisabled();
  expect(await screen.findByRole("button", { name: "고정" })).toBeDisabled();
  expect(screen.getByRole("link", { name: "다운로드" })).toBeInTheDocument();
});

test("shows upload progress, prevents duplicate uploads and allows selecting the same file again", async () => {
  withToken();
  let finish!: (response: Response) => void;
  const { calls } = mockApi({
    "GET /api/v1/apps": [],
    "POST /api/v1/apps": () => new Promise<Response>((resolve) => { finish = resolve; }),
  });
  renderPage(<AppsPage />);
  const input = screen.getByLabelText("APK 파일");
  const file = apkFile();
  await userEvent.upload(input, file);
  expect(await screen.findByRole("button", { name: "업로드 중…" })).toBeDisabled();
  expect(input).toBeDisabled();
  finish(jsonResponse(201, app()));
  await screen.findByRole("button", { name: "APK 업로드" });
  await userEvent.upload(input, file);
  await waitFor(() => expect(calls.filter((call) => call.method === "POST")).toHaveLength(2));
  finish(jsonResponse(200, app()));
  expect(await screen.findByRole("status")).toHaveTextContent("이미 보관함에 있는 빌드입니다");
});

test.each([
  [400, "invalid_apk", "올바른 APK 파일이 아닙니다"],
  [413, "upload_too_large", "APK 파일이 너무 큽니다"],
])("shows upload error %s %s", async (status, code, message) => {
  withToken();
  const { calls } = mockApi({
    "GET /api/v1/apps": [],
    "POST /api/v1/apps": () => apiErrorResponse(Number(status), String(code), String(message)),
  });
  renderPage(<AppsPage />);
  await userEvent.upload(screen.getByLabelText("APK 파일"), apkFile());
  expect(await screen.findByRole("alert")).toHaveTextContent(`${message} (${code})`);
  expect(screen.getByRole("button", { name: "APK 업로드" })).toBeEnabled();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(calls.filter((call) => call.method === "GET")).toHaveLength(1);
});

test("shows pin errors while preserving the current build state", async () => {
  withToken();
  mockApi({ "GET /api/v1/apps": [app()], "PATCH /api/v1/apps/app1": apiErrorResponse(403, "forbidden", "권한이 없습니다") });
  renderPage(<AppsPage />);
  await userEvent.click(await screen.findByRole("button", { name: "고정" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("권한이 없습니다 (forbidden)");
  expect(screen.getByRole("button", { name: "고정" })).toBeEnabled();
  expect(screen.queryByText("고정됨")).not.toBeInTheDocument();
});

test("shows loading while the library request is pending", () => {
  mockApi({ "GET /api/v1/apps": () => new Promise(() => {}) });
  renderPage(<AppsPage />);
  expect(screen.getByText("불러오는 중…")).toBeInTheDocument();
});

test("shows the empty library guidance", async () => {
  mockApi({ "GET /api/v1/apps": [] });
  renderPage(<AppsPage />);
  expect(await screen.findByText("보관함이 비어 있습니다. CI에서 `farmctl apps upload`로 올리거나 여기서 업로드하세요."))
    .toBeInTheDocument();
});

test("shows library query errors", async () => {
  mockApi({ "GET /api/v1/apps": apiErrorResponse(503, "unavailable", "잠시 후 다시 시도하세요") });
  renderPage(<AppsPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent("잠시 후 다시 시도하세요 (unavailable)");
});
