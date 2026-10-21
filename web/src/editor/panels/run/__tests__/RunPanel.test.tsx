import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, test, expect, vi } from "vitest";
import { EditorProvider, useEditor, type EditorApi } from "../../../store";
import { RunPanel } from "../../RunPanel";
import { apiErrorResponse, mockApi } from "../../../../test/api";
import { app, device, runDetail, task, taskSteps, workspace } from "../../../../test/fixtures";
import type { RunOptions } from "../../../../api/types";
import { keys } from "../../../../api/queries";

const ws = workspace();
const reservation = { id: "res1", device_serial: "ready", holder_name: "에디터", status: "active", created_at: "2026-10-21T00:00:00Z", expires_at: "2026-10-22T12:34:00Z", released_at: null };
let editor: EditorApi;
function Probe({ onShowScreen }: { onShowScreen: () => void }) { editor = useEditor(); return <RunPanel onShowScreen={onShowScreen} />; }
// Exercise the panel against the real editor store and mock only HTTP.
import { renderPage } from "../../../../test/render";
function setup(extra: Parameters<typeof mockApi>[0] = {}) {
  const api = mockApi({
    "GET /api/v1/workspaces/ws1/tree": { sha: ws.head_sha, files: [{ path: "flows/login.yaml", size: 30 }, { path: "notes.md", size: 20 }] },
    "GET /api/v1/devices": [device({ serial: "offline", state: "offline" }), device({ serial: "busy", state: "busy" }), device({ serial: "ready", model: "Pixel 준비" }), device({ serial: "disabled", disabled: true })],
    "GET /api/v1/apps": [app()],
    "POST /api/v1/devices/ready/reservations": reservation,
    "DELETE /api/v1/reservations/res1": { ...reservation, status: "released" },
    "POST /api/v1/reservations/res1/renew": reservation,
    "POST /api/v1/workspaces/ws1/validate": { valid: true, issues: [] },
    ...extra,
  });
  const onShowScreen = vi.fn();
  return { ...renderPage(<EditorProvider workspace={ws}><Probe onShowScreen={onShowScreen} /></EditorProvider>), ...api, onShowScreen };
}
afterEach(() => sessionStorage.clear());

test("available devices sort first, unavailable devices cannot be selected, and reserve/release updates the store", async () => {
  const view = setup(); const user = userEvent.setup();
  const list = await screen.findByRole("radiogroup", { name: "기기" });
  const devices = await within(list).findAllByRole("radio");
  expect(devices[0]).toHaveAccessibleName(/Pixel 준비/);
  expect(within(list).getByRole("radio", { name: /offline/ })).toBeDisabled();
  expect(within(list).getByRole("radio", { name: /disabled/ })).toBeDisabled();
  await user.click(devices[0]!); await user.click(screen.getByRole("button", { name: "예약" }));
  await screen.findByText(/편집하는 동안 자동 연장/);
  expect(editor.reservation?.id).toBe("res1");
  await user.click(screen.getByRole("button", { name: "해제" }));
  await waitFor(() => expect(editor.reservation).toBeNull());
  expect(view.calls.some(c => c.method === "DELETE" && c.path.endsWith("/res1"))).toBe(true);
});

test.each([false, true])("submits multipart %s draft choice for current file and all workspace via shortcut", async (draft) => {
  const view = setup({ "POST /api/v1/runs": { id: "new-run", url: "/runs/new-run" } });
  await waitFor(() => expect(editor.files).toHaveLength(2));
  await act(async () => { await editor.reserve("ready"); editor.openFile("flows/login.yaml"); });
  if (draft) act(() => editor.setContent("flows/login.yaml", "appId: com.example.app\n---\n- launchApp"));
  const user = userEvent.setup();
  await user.click(screen.getByText("환경 변수"));
  fireEvent.change(screen.getByRole("textbox", { name: "환경 변수" }), { target: { value: "TOKEN=secret=value\nREGION=kr" } });
  if (draft) expect(screen.getByText("저장하지 않은 변경 1개를 포함해 실행합니다 (초안)")).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "Enter", metaKey: true });
  await waitFor(() => expect(view.calls.filter(c => c.method === "POST" && c.path === "/api/v1/runs")).toHaveLength(1));
  const first = view.calls.find(c => c.path === "/api/v1/runs")!;
  expect(first.body).toBeInstanceOf(FormData);
  const payload = JSON.parse((first.body as FormData).get("options") as string) as RunOptions;
  expect(payload).toMatchObject({ origin: "editor", mode: "matrix", reservation_id: "res1", device_selector: { serials: ["ready"] }, workspace: ws.name, app: "com.example.app@latest", flow_paths: ["flows/login.yaml"], env: { TOKEN: "secret=value", REGION: "kr" }, flow_source: draft ? "draft" : "workspace" });
  if (draft) {
    expect(payload).toMatchObject({ base_sha: ws.head_sha, changes: [{ op: "put", path: "flows/login.yaml", content: "appId: com.example.app\n---\n- launchApp", encoding: "utf-8" }] });
    expect(payload.ref).toBeUndefined();
  } else { expect(payload.ref).toBe(ws.head_sha); expect(payload.changes).toBeUndefined(); }
  expect(first.headers["Content-Type"]).toBeUndefined();
  await waitFor(() => expect(screen.getByRole("button", { name: /login.yaml 실행/ })).toBeEnabled());
  await user.selectOptions(screen.getByRole("combobox", { name: "앱 빌드" }), "build:app1");
  expect(editor.appChoice).toEqual({ app_build_id: "app1" });
  await user.click(screen.getByRole("radio", { name: "워크스페이스 전체" }));
  fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
  await waitFor(() => expect(view.calls.filter(c => c.method === "POST" && c.path === "/api/v1/runs")).toHaveLength(2));
  const last = view.calls.filter(c => c.path === "/api/v1/runs").at(-1)!;
  const all = JSON.parse((last.body as FormData).get("options") as string) as RunOptions;
  expect(all.flow_paths).toBeUndefined(); expect(all.app).toBeUndefined(); expect(all.app_build_id).toBe("app1");
  expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain("secret=value");
});

test("non-flow active file disables current-file targeting", async () => {
  setup(); await waitFor(() => expect(editor.files).toHaveLength(2));
  act(() => editor.openFile("notes.md"));
  expect(screen.getByRole("radio", { name: "현재 파일" })).toBeDisabled();
  expect(screen.getByRole("radio", { name: "워크스페이스 전체" })).toBeChecked();
});

test("keeps five session runs newest first and loads the timeline only after the newest finishes", async () => {
  let number = 0;
  const running = runDetail({ id: "editor-run-6", origin: "editor", status: "running", finished_at: null, tasks: [task({ status: "running", finished_at: null })] });
  const routes: Parameters<typeof mockApi>[0] = {
    "POST /api/v1/runs": () => ({ id: `editor-run-${++number}`, url: `/runs/editor-run-${number}` }),
    "GET /api/v1/tasks/task1/steps": taskSteps({ flows: [{ flow: "login", steps: [
      { seq: 0, command: "launchApp", label: "앱 시작", status: "passed", duration_ms: 500, depth: 0, screenshot: null, hierarchy: null },
      { seq: 1, command: "tapOn", label: "로그인 누르기", status: "failed", duration_ms: 1500, depth: 1, screenshot: "screenshots/failure.png", hierarchy: null },
    ] }] }),
    "GET /api/v1/tasks/task1/artifacts/screenshots/failure.png": new Response(new Blob(["png"], { type: "image/png" })),
  };
  for (let i = 1; i <= 6; i++) routes[`GET /api/v1/runs/editor-run-${i}`] = i === 6 ? running : runDetail({ id: `editor-run-${i}`, origin: "editor", status: i === 5 ? "cancelled" : i === 4 ? "error" : "passed", tasks: [] });
  const NativeURL = URL;
  vi.stubGlobal("URL", class extends NativeURL { static createObjectURL = vi.fn(() => "blob:failed-step"); static revokeObjectURL = vi.fn(); });
  const view = setup(routes);
  await waitFor(() => expect(editor.files).toHaveLength(2));
  await act(async () => { await editor.reserve("ready"); editor.openFile("flows/login.yaml"); });
  for (let i = 1; i <= 6; i++) {
    await waitFor(() => expect(screen.getByRole("button", { name: /login.yaml 실행/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /login.yaml 실행/ }));
    await waitFor(() => expect(view.calls.filter(c => c.method === "POST" && c.path === "/api/v1/runs")).toHaveLength(i));
  }
  const results = await screen.findByRole("list", { name: "이번 세션 실행 결과" });
  await within(results).findByText("실행 중…");
  const links = within(results).getAllByRole("link");
  expect(links.map(link => link.getAttribute("href"))).toEqual([6, 5, 4, 3, 2].map(i => `/runs/editor-run-${i}`));
  expect(within(results).getByText("취소")).toBeInTheDocument(); expect(within(results).getByText("오류")).toBeInTheDocument();
  expect(view.calls.some(c => c.path.endsWith("/steps"))).toBe(false);
  act(() => view.client.setQueryData(keys.run(running.id), { ...running, status: "failed", finished_at: "2026-10-20T05:01:05Z", tasks: [task({ status: "failed", error_message: "로그인 버튼을 찾을 수 없습니다." })] }));
  expect(await within(results).findByText("로그인 누르기")).toBeInTheDocument();
  expect(await screen.findByText("로그인 버튼을 찾을 수 없습니다.")).toBeInTheDocument();
  expect(await screen.findByRole("img", { name: "실패 단계 스크린샷" })).toHaveAttribute("src", "blob:failed-step");
  fireEvent.click(screen.getByRole("button", { name: "화면 탭에서 보기" })); expect(view.onShowScreen).toHaveBeenCalledOnce();
  expect(JSON.parse(sessionStorage.getItem("farm.editor.runs.ws1")!)).toHaveLength(5);
});

test.each(["no_matching_devices", "reservation_not_active"])("shows %s inline without losing the draft or environment", async code => {
  const view = setup({ "POST /api/v1/runs": apiErrorResponse(400, code) });
  await waitFor(() => expect(editor.files).toHaveLength(2));
  await act(async () => { await editor.reserve("ready"); editor.openFile("flows/login.yaml"); });
  act(() => editor.setContent("flows/login.yaml", "draft"));
  fireEvent.click(screen.getByText("환경 변수"));
  fireEvent.change(screen.getByRole("textbox", { name: "환경 변수" }), { target: { value: "TOKEN=private" } });
  fireEvent.click(screen.getByRole("button", { name: /login.yaml 실행/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent(code);
  expect(screen.getByRole("textbox", { name: "환경 변수" })).toHaveValue("TOKEN=private");
  expect(editor.drafts["flows/login.yaml"]?.content).toBe("draft");
  expect(view.calls.filter(c => c.path === "/api/v1/runs")).toHaveLength(1);
});

test("shortcut cannot submit without write access and a reserved device", async () => {
  const view = setup({ "GET /api/v1/healthz": { status: "ok", auth_required: true } });
  await screen.findByRole("radio", { name: /Pixel 준비/ });
  expect(screen.getByRole("button", { name: "예약" })).toBeDisabled();
  fireEvent.keyDown(window, { key: "Enter", metaKey: true });
  expect(view.calls.some(c => c.method === "POST")).toBe(false);
});

test("rejects malformed environment lines without submitting or echoing their values", async () => {
  const view = setup(); await waitFor(() => expect(editor.files).toHaveLength(2));
  await act(async () => { await editor.reserve("ready"); editor.openFile("flows/login.yaml"); });
  fireEvent.click(screen.getByText("환경 변수"));
  fireEvent.change(screen.getByRole("textbox", { name: "환경 변수" }), { target: { value: "bad-key=private" } });
  fireEvent.keyDown(window, { key: "Enter", metaKey: true });
  expect(await screen.findByRole("alert")).toHaveTextContent("환경 변수 1행을 KEY=VALUE 형식으로 입력하세요.");
  expect(screen.getByRole("alert")).not.toHaveTextContent("private");
  expect(view.calls.some(c => c.path === "/api/v1/runs")).toBe(false);
});

test("the editor shortcut works before an input consumes the event and suppresses duplicate pending requests", async () => {
  let finish!: (value: unknown) => void;
  const pending = new Promise(resolve => { finish = resolve; });
  const view = setup({ "POST /api/v1/runs": () => pending });
  await waitFor(() => expect(editor.files).toHaveLength(2));
  await act(async () => { await editor.reserve("ready"); editor.openFile("flows/login.yaml"); });
  fireEvent.click(screen.getByText("환경 변수"));
  const input = screen.getByRole("textbox", { name: "환경 변수" });
  input.addEventListener("keydown", event => event.stopPropagation());
  fireEvent.keyDown(input, { key: "Enter", metaKey: true });
  fireEvent.keyDown(input, { key: "Enter", metaKey: true });
  await waitFor(() => expect(view.calls.filter(c => c.method === "POST" && c.path === "/api/v1/runs")).toHaveLength(1));
  expect(screen.getByRole("button", { name: /요청 중/ })).toBeDisabled();
  await act(async () => finish({ id: "new-run", url: "/runs/new-run" }));
  expect(screen.getByRole("button", { name: /login.yaml 실행/ })).toBeEnabled();
});
