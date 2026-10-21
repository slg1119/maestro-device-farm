import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { EditorProvider, useEditor, useEditorRuntime, type EditorApi } from "../../store";
import { mockApi, healthBody } from "../../../test/api";
import { device, deviceCommand, workspace } from "../../../test/fixtures";
import { renderPage } from "../../../test/render";
import { ScreenPanel } from "../ScreenPanel";
import fixture from "./hierarchy.fixture.json";

const reservation = { id: "res1", device_serial: "emulator-5554", holder_name: "에디터", status: "active" as const, created_at: "2026-10-21", expires_at: "2026-10-22", released_at: null };
const files = { "screen.png": "/api/v1/device-commands/cmd1/files/screen.png", "hierarchy.json": "/api/v1/device-commands/cmd1/files/hierarchy.json" };
let api: EditorApi;
let runtime: ReturnType<typeof useEditorRuntime>;
function Probe() { api = useEditor(); runtime = useEditorRuntime(); return null; }
function setup(options: { queued?: boolean; denied?: boolean; commandError?: boolean; hierarchy?: unknown } = {}) {
  let reads = 0;
  const mock = mockApi({
    "GET /api/v1/healthz": healthBody({ auth_required: options.denied ?? false }),
    "GET /api/v1/devices": [device()],
    "GET /api/v1/workspaces/ws1/tree": { files: [{ path: "flow.yaml", size: 4 }] },
    "GET /api/v1/workspaces/ws1/files/flow.yaml": new Response("  - "),
    "POST /api/v1/devices/emulator-5554/reservations": reservation,
    "DELETE /api/v1/reservations/res1": { ...reservation, status: "released" },
    "POST /api/v1/reservations/res1/inspect": { id: "cmd1" },
    "GET /api/v1/device-commands/cmd1": () => deviceCommand({ status: options.commandError ? "error" : options.queued && reads++ === 0 ? "queued" : "done", files, finished_at: "2026-10-21T03:00:00Z", error_message: options.commandError ? "스냅샷 실패" : null }),
    "GET /api/v1/device-commands/cmd1/files/hierarchy.json": options.hierarchy ?? fixture,
  });
  const onReserve = vi.fn();
  const view = renderPage(<EditorProvider workspace={workspace()}><Probe /><ScreenPanel onReserve={onReserve} /></EditorProvider>);
  return { ...view, ...mock, onReserve, user: userEvent.setup() };
}
async function reserve() { await act(async () => api.reserve("emulator-5554")); }
async function snapshot(user: ReturnType<typeof userEvent.setup>) {
  await reserve(); await user.click(await screen.findByRole("button", { name: "다시 찍기" }));
  return screen.findByRole("img", { name: "예약 기기 화면 스냅샷" }, { timeout: 3500 });
}

test("without a reservation offers the run-panel shortcut", async () => {
  const view = setup();
  expect(screen.getByText("화면을 확인하려면 기기를 예약하세요.")).toBeInTheDocument();
  await view.user.click(screen.getByRole("button", { name: "기기 예약" }));
  expect(view.onReserve).toHaveBeenCalledOnce();
  expect(view.calls.some(c => c.path.endsWith("/inspect"))).toBe(false);
});

test("inspect polls to completion, loads real hierarchy, and publishes distinct completion candidates", async () => {
  const view = setup({ queued: true });
  const image = await snapshot(view.user);
  expect(image).toHaveAttribute("src", files["screen.png"]);
  expect(view.calls.filter(c => c.path === "/api/v1/device-commands/cmd1").length).toBeGreaterThanOrEqual(2);
  expect(view.calls.some(c => c.method === "POST" && c.path === "/api/v1/reservations/res1/inspect")).toBe(true);
  expect(screen.getByText("요소 47개")).toBeInTheDocument();
  expect(screen.getByText("Pixel 7")).toBeInTheDocument();
  expect(api.snapshotSelectors).toContainEqual(expect.objectContaining({ kind: "text", value: "Learn more about Wikipedia" }));
  expect(view.calls.some(c => c.method === "DELETE")).toBe(false);
});

test("natural image size scales hit testing and all bounds; list filters and selects nodes", async () => {
  const hierarchy = { attributes: { class: "Root", bounds: "[0,0][1080,2400]" }, children: [{ attributes: { class: "Button", bounds: "[100,100][500,500]", "resource-id": "submit", text: "로그인", clickable: "true" }, children: [{ attributes: { class: "Label", bounds: "[150,150][300,200]", text: "계속" } }] }] };
  const view = setup({ hierarchy }); const image = await snapshot(view.user);
  Object.defineProperties(image, { naturalWidth: { value: 1080 }, naturalHeight: { value: 2400 } });
  vi.spyOn(image, "getBoundingClientRect").mockReturnValue({ left: 10, top: 20, width: 270, height: 600 } as DOMRect);
  fireEvent.load(image);
  expect(screen.getByTestId("screen-bounds")).toHaveAttribute("viewBox", "0 0 1080 2400");
  expect(screen.getByTestId("screen-bounds").querySelectorAll("rect")).toHaveLength(3);
  fireEvent.click(image, { clientX: 50, clientY: 62.5 });
  expect(within(screen.getByRole("region", { name: "선택한 요소" })).getByText("Label")).toBeInTheDocument();
  await view.user.click(screen.getByRole("button", { name: "요소 목록" }));
  await view.user.type(screen.getByRole("searchbox", { name: "요소 검색" }), "submit");
  const list = screen.getByRole("list", { name: "화면 요소" });
  expect(within(list).getAllByRole("button")).toHaveLength(1);
  await view.user.click(within(list).getByRole("button"));
  expect(within(screen.getByRole("region", { name: "선택한 요소" })).getByText("클릭 가능")).toBeInTheDocument();
  expect(screen.getByTestId("screen-bounds").querySelector('[data-selected="true"]')).toHaveAttribute("x", "100");
});

test("copies quoted selectors and inserts both commands at the active cursor with nested indentation", async () => {
  const hierarchy = { attributes: { class: "Button", "resource-id": "submit", text: '계속: "로그인"', accessibilityText: "계속" } };
  const view = setup({ hierarchy }); await snapshot(view.user);
  const insert = vi.fn(); const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  act(() => { api.openFile("flow.yaml"); runtime.attachEditor({ insert }); runtime.setCursor({ line: 1, column: 5 }); });
  await view.user.click(screen.getByRole("button", { name: "요소 목록" }));
  await view.user.click(within(screen.getByRole("list", { name: "화면 요소" })).getByRole("button"));
  const candidates = screen.getByRole("list", { name: "셀렉터 후보" });
  const id = within(candidates).getAllByRole("listitem")[0]!;
  await view.user.click(within(id).getByRole("button", { name: "복사" }));
  expect(writeText).toHaveBeenCalledWith('id: "submit"');
  await view.user.click(within(id).getByRole("button", { name: "tapOn 삽입" }));
  expect(insert).toHaveBeenLastCalledWith('tapOn:\n      id: "submit"\n');
  await view.user.click(within(id).getByRole("button", { name: "assertVisible 삽입" }));
  expect(insert).toHaveBeenLastCalledWith('assertVisible:\n      id: "submit"\n');
});

test("command errors are visible and allow another capture; token policy disables inspection", async () => {
  const view = setup({ commandError: true }); await reserve();
  await view.user.click(await screen.findByRole("button", { name: "다시 찍기" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("스냅샷 실패");
  expect(screen.getByRole("button", { name: "다시 찍기" })).toBeEnabled();
  view.unmount();
  const denied = setup({ denied: true }); await reserve();
  await waitFor(() => expect(screen.getByRole("button", { name: "다시 찍기" })).toBeDisabled());
  expect(denied.calls.some(c => c.path.endsWith("/inspect"))).toBe(false);
});

test("releasing a reservation ignores a late hierarchy response and clears selectors", async () => {
  let resolve!: (value: unknown) => void;
  const pending = new Promise(r => { resolve = r; });
  const view = setup({ hierarchy: () => pending }); await reserve();
  await view.user.click(await screen.findByRole("button", { name: "다시 찍기" }));
  await waitFor(() => expect(view.calls.some(c => c.path.endsWith("/files/hierarchy.json"))).toBe(true));
  await act(async () => api.release());
  await act(async () => { resolve(fixture); await pending; });
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(api.snapshotSelectors).toEqual([]);
});
