import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { useState } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { useLiveEvents } from "../../api/events";
import { keys } from "../../api/queries";
import { apiErrorResponse, mockApi, type MockRequest } from "../../test/api";
import type { Recording } from "../../api/types";
import { workspace } from "../../test/fixtures";
import { renderPage } from "../../test/render";
import { RecordingControls } from "./RecordingControls";

const ts = "2026-10-21T05:00:00Z";
const active = { id: "rec1", device_serial: "s1", status: "active", include_launch_app: true, app_package: "org.example", workspace_id: "ws1", steps: [{ kind: "launch", ts }], yaml: null, ai_job_id: null, created_by: "운영자", created_at: ts, finished_at: null };
const done = { ...active, status: "done", yaml: "appId: org.example\n---\n- launchApp\n", finished_at: ts };
class Events {
  static CLOSED = 2;
  static current: Events;
  readyState = 1;
  onopen = null;
  onerror = null;
  listeners = new Map<string, (message: MessageEvent<string>) => void>();
  constructor() { Events.current = this; }
  addEventListener(type: string, listener: (message: MessageEvent<string>) => void) { this.listeners.set(type, listener); }
  close() {}
  emit(id = "rec1") { this.listeners.get("recording.updated")?.(new MessageEvent("recording.updated", { data: JSON.stringify({ payload: { id, status: "active", steps: 2 } }) })); }
}
function Probe() { useLiveEvents(); const location = useLocation(); return <output aria-label="현재 주소">{location.pathname}{location.search}</output>; }
beforeEach(() => vi.stubGlobal("EventSource", Events));
function setup(options: { canControl?: boolean; ai?: boolean; existing?: boolean; failStart?: boolean; noWorkspace?: boolean; unsynced?: boolean; stopResult?: Promise<unknown>; onComplete?: (recording: Recording) => void } = {}) {
  let current = { ...active, workspace_id: options.noWorkspace ? null : active.workspace_id };
  let activeList = options.existing ? [current] : [];
  const mock = mockApi({
    "GET /api/v1/workspaces": [workspace({ default_app_package: "org.example", ...(options.unsynced ? { head_sha: null } : {}) })],
    "GET /api/v1/ai/status": { enabled: options.ai ?? false },
    "GET /api/v1/devices/s1/recordings": () => activeList,
    "POST /api/v1/devices/s1/recordings": () => options.failStart ? apiErrorResponse(409, "recording_active", "이미 녹화 중입니다.") : active,
    "GET /api/v1/recordings/rec1": () => current,
    "GET /api/v1/recordings/rec2": () => ({ ...active, id: "rec2" }),
    "POST /api/v1/recordings/rec1/stop": (req: MockRequest) => options.stopResult ?? ({ ...done, ai_job_id: (req.body as { ai_polish: boolean }).ai_polish ? "ai1" : null }),
    "DELETE /api/v1/recordings/rec1": { ...active, status: "cancelled" },
  });
  function Harness() { const [control, setControl] = useState(options.canControl ?? true); return <><RecordingControls serial="s1" canControl={control} onComplete={options.onComplete} /><button onClick={() => setControl(false)}>조작 권한 해제</button><Probe /></>; }
  const view = renderPage(<Harness />);
  return { ...view, ...mock, user: userEvent.setup(), addStep: () => { current = { ...active, steps: [...active.steps, { kind: "back", ts }] }; }, externalStart: () => { activeList = [{ ...active, id: "rec2" }]; } };
}
async function start(view: ReturnType<typeof setup>) {
  await waitFor(() => expect(screen.getByRole("button", { name: "녹화" })).toBeEnabled());
  await view.user.click(await screen.findByRole("button", { name: "녹화" }));
  const dialog = screen.getByRole("dialog", { name: "녹화 시작" });
  await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "워크스페이스" }).querySelectorAll("option")).toHaveLength(2));
  await view.user.selectOptions(within(dialog).getByRole("combobox", { name: "워크스페이스" }), "ws1");
  expect(within(dialog).getByRole("checkbox", { name: /launchApp/ })).toBeChecked();
  await view.user.click(within(dialog).getByRole("button", { name: "시작" }));
  await screen.findByText("녹화 중 · 1단계");
}

test("starts with workspace defaults, refreshes steps through SSE, stops synchronously and copies/opens the result", async () => {
  const view = setup(); await start(view);
  expect(view.calls.find(c => c.method === "POST" && c.path.endsWith("/recordings"))?.body).toEqual({ include_launch_app: true, workspace: "example-app", app_package: "org.example" });
  expect(screen.getByRole("list", { name: "녹화 단계" })).toHaveTextContent("- launchApp");
  view.addStep(); act(() => Events.current.emit());
  await screen.findByText("녹화 중 · 2단계");
  expect(screen.getByRole("list", { name: "녹화 단계" })).toHaveTextContent("- back");
  await view.user.click(screen.getByRole("button", { name: "중지" }));
  expect(screen.queryByRole("button", { name: "AI로 다듬기" })).not.toBeInTheDocument();
  await view.user.click(screen.getByRole("button", { name: "그대로 YAML 만들기" }));
  expect(await screen.findByLabelText("녹화 YAML")).toHaveTextContent("appId: org.example");
  expect(view.calls.find(c => c.path.endsWith("/stop"))?.body).toEqual({ ai_polish: false });
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  await view.user.click(screen.getByRole("button", { name: "복사" })); expect(copy).toHaveBeenCalledWith(done.yaml);
  await view.user.click(screen.getByRole("button", { name: "에디터에서 열기" }));
  expect(screen.getByLabelText("현재 주소")).toHaveTextContent("/editor/example-app?draft=rec1");
  expect(screen.getByLabelText("현재 주소")).not.toHaveTextContent("appId");
});

test("cancels an active recording without producing a YAML result", async () => {
  const view = setup(); await start(view); await view.user.click(screen.getByRole("button", { name: "중지" }));
  await view.user.click(within(screen.getByRole("dialog", { name: "녹화 중지" })).getByRole("button", { name: "취소" }));
  await waitFor(() => expect(view.calls.some(c => c.method === "DELETE" && c.path.endsWith("/rec1"))).toBe(true));
  await waitFor(() => expect(screen.queryByText(/녹화 중 ·/)).not.toBeInTheDocument());
  expect(screen.queryByLabelText("녹화 YAML")).not.toBeInTheDocument();
});

test("AI polish returns the recording to the existing AI job flow", async () => {
  const onComplete = vi.fn(); const view = setup({ ai: true, onComplete }); await start(view);
  await view.user.click(screen.getByRole("button", { name: "중지" }));
  await view.user.click(await screen.findByRole("button", { name: "AI로 다듬기" }));
  await waitFor(() => expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ status: "done", ai_job_id: "ai1" })));
  expect(view.calls.find(c => c.path.endsWith("/stop"))?.body).toEqual({ ai_polish: true });
});

test("restores an active recording and disables its writes when control is lost", async () => {
  const view = setup({ existing: true }); await screen.findByText("녹화 중 · 1단계");
  await view.user.click(screen.getByRole("button", { name: "조작 권한 해제" }));
  expect(screen.getByRole("button", { name: "중지" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "중지" }));
  expect(view.calls.some(c => c.method === "POST")).toBe(false);
});

test("view-only connections cannot start a recording", async () => {
  const view = setup({ canControl: false });
  expect(screen.queryByRole("button", { name: "녹화" })).not.toBeInTheDocument();
  expect(view.calls.some(c => c.method === "POST")).toBe(false);
});

test("start errors preserve the dialog and show the API failure", async () => {
  const view = setup({ failStart: true });
  await waitFor(() => expect(screen.getByRole("button", { name: "녹화" })).toBeEnabled());
  await view.user.click(await screen.findByRole("button", { name: "녹화" }));
  await view.user.click(screen.getByRole("button", { name: "시작" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("이미 녹화 중입니다.");
  expect(screen.getByRole("dialog", { name: "녹화 시작" })).toBeInTheDocument();
  expect(view.client.getQueryData(keys.recording("rec1"))).toBeUndefined();
});

test.each([{ noWorkspace: true }, { unsynced: true }])("AI polish needs a synced workspace (%j)", async (options) => {
  const view = setup({ ...options, ai: true, existing: true });
  await screen.findByText("녹화 중 · 1단계");
  await view.user.click(screen.getByRole("button", { name: "중지" }));
  expect(await screen.findByRole("button", { name: "AI로 다듬기" })).toBeDisabled();
  expect(screen.getByText(/워크스페이스.*(지정|동기화)/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "그대로 YAML 만들기" })).toBeEnabled();
});

test("pending stop blocks duplicate writes and closing its dialog until the server completes", async () => {
  let resolve!: (value: unknown) => void;
  const view = setup({ stopResult: new Promise(value => { resolve = value; }) });
  await start(view); await view.user.click(screen.getByRole("button", { name: "중지" }));
  await view.user.click(screen.getByRole("button", { name: "그대로 YAML 만들기" }));
  expect(screen.getByRole("button", { name: "그대로 YAML 만들기" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.getByRole("dialog", { name: "녹화 중지" })).toBeInTheDocument();
  await act(async () => resolve(done));
  expect(await screen.findByLabelText("녹화 YAML")).toBeInTheDocument();
  expect(view.calls.filter(c => c.path.endsWith("/stop"))).toHaveLength(1);
});

test("unknown package starts without launchApp, and a known package can explicitly exclude it", async () => {
  const view = setup(); await waitFor(() => expect(screen.getByRole("button", { name: "녹화" })).toBeEnabled());
  await view.user.click(screen.getByRole("button", { name: "녹화" }));
  expect(screen.getByRole("checkbox", { name: /launchApp/ })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: /launchApp/ })).toBeDisabled();
  await view.user.selectOptions(screen.getByRole("combobox", { name: "워크스페이스" }), "ws1");
  await view.user.click(screen.getByRole("checkbox", { name: /launchApp/ }));
  await view.user.click(screen.getByRole("button", { name: "시작" }));
  await screen.findByText("녹화 중 · 1단계");
  expect(view.calls.find(c => c.method === "POST" && c.path.endsWith("/recordings"))?.body).toEqual({ include_launch_app: false, workspace: "example-app", app_package: "org.example" });
});

test("a new active recording from SSE replaces a previous completed result", async () => {
  const view = setup(); await start(view);
  await view.user.click(screen.getByRole("button", { name: "중지" }));
  await view.user.click(screen.getByRole("button", { name: "그대로 YAML 만들기" }));
  await screen.findByLabelText("녹화 YAML");
  view.externalStart(); act(() => Events.current.emit("rec2"));
  await screen.findByText("녹화 중 · 1단계");
  expect(screen.queryByLabelText("녹화 YAML")).not.toBeInTheDocument();
});
