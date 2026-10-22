import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { mockApi, apiErrorResponse } from "../../../test/api";
import { device } from "../../../test/fixtures";
import { renderPage } from "../../../test/render";
import { LiveBoardPage } from "../LiveBoardPage";

const ticket = vi.hoisted(() => vi.fn());
vi.mock("../../../api/queries", async (original) => ({ ...await original<typeof import("../../../api/queries")>(), createStreamTicket: ticket }));
vi.mock("../../../components/live/LiveView", () => ({ LiveView: ({ serial }: { serial: string }) => <div>확대 화면 {serial}</div> }));

class Observer {
  static instances: Observer[] = [];
  node: Element | null = null;
  disconnect = vi.fn();
  constructor(readonly callback: IntersectionObserverCallback) { Observer.instances.push(this); }
  observe(node: Element) { this.node = node; }
  setVisible(visible: boolean) { this.callback([{ target: this.node!, isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
}
class Socket {
  static instances: Socket[] = [];
  readyState = 0; binaryType = "";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn(); close = vi.fn(() => { this.readyState = 3; });
  constructor(readonly url: string) { Socket.instances.push(this); }
  message(data: object | ArrayBuffer) { this.onmessage?.({ data: data instanceof ArrayBuffer ? data : JSON.stringify(data) }); }
}
function showTiles() { act(() => Observer.instances.forEach((observer) => observer.setVisible(true))); }
function visibility(value: "hidden" | "visible") {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(value);
  fireEvent(document, new Event("visibilitychange"));
}
const devices = [
  device({ serial: "a", model: "Pixel", tags: ["phone"] }),
  device({ serial: "b", model: "Galaxy", state: "busy", current_task_id: "task-running", tags: ["smoke"] }),
  device({ serial: "c", model: "QA 에뮬레이터", state: "disabled", disabled: true, tags: ["smoke"] }),
  device({ serial: "d", model: "예약 기기", state: "reserved" }),
  device({ serial: "e", model: "점검 기기", state: "unhealthy" }),
  device({ serial: "offline", model: "꺼진 기기", state: "offline" }),
];
beforeEach(() => {
  Socket.instances = []; Observer.instances = []; ticket.mockReset();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.stubGlobal("IntersectionObserver", Observer);
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("VideoDecoder", class { state = "configured"; configure = vi.fn(); close = vi.fn(); });
  vi.stubGlobal("EncodedVideoChunk", class {});
});
afterEach(() => vi.restoreAllMocks());

test("renders every connected state, metadata and running task, but never streams offline devices", async () => {
  mockApi({ "GET /api/v1/devices": devices });
  renderPage(<LiveBoardPage />);
  expect(await screen.findByText("Pixel")).toBeInTheDocument();
  expect(screen.getAllByRole("article")).toHaveLength(5);
  expect(screen.getByText("task-running")).toBeInTheDocument();
  expect(screen.getByText("꺼진 기기")).toBeInTheDocument();
  expect(Socket.instances).toHaveLength(0);
  showTiles();
  await waitFor(() => expect(Socket.instances).toHaveLength(5));
  expect(Socket.instances.every((socket) => !socket.url.includes("offline"))).toBe(true);
  expect(screen.getByText("c")).toBeInTheDocument();
});

test("tiles never request a controller ticket or send input even when the server claims control", async () => {
  const { calls } = mockApi({ "GET /api/v1/devices": [devices[0]!] });
  renderPage(<LiveBoardPage />); await screen.findByText("Pixel"); showTiles();
  const socket = Socket.instances[0]!;
  expect(socket.url).not.toContain("ticket"); expect(ticket).not.toHaveBeenCalled();
  act(() => {
    socket.readyState = 1; socket.onopen?.();
    socket.message({ type: "status", viewers: 1, controller: "", running_task_id: null, recording: false, control: true });
  });
  const canvas = screen.getByLabelText("a 보기 전용 화면");
  fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerUp(canvas, { pointerId: 1 });
  fireEvent.wheel(canvas, { deltaY: 10 });
  fireEvent.keyDown(canvas, { key: "Enter" });
  expect(socket.send).not.toHaveBeenCalled();
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("state and tag chips combine, unmount filtered streams and include disabled devices", async () => {
  mockApi({ "GET /api/v1/devices": devices });
  renderPage(<LiveBoardPage />); await screen.findByText("Pixel"); showTiles();
  await userEvent.click(screen.getByRole("button", { name: "실행 중" }));
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.getByText("Galaxy")).toBeInTheDocument();
  expect(Socket.instances[0]!.close).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole("button", { name: "phone" }));
  expect(screen.getByText("조건에 맞는 기기가 없습니다.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "모든 태그" }));
  await userEvent.click(screen.getByRole("button", { name: "비활성" }));
  expect(screen.getByText("QA 에뮬레이터")).toBeInTheDocument();
  expect(screen.queryByText("Galaxy")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "사용 가능" }));
  expect(screen.getByText("Pixel")).toBeInTheDocument();
});

test("tile size persists across remounts and controls a grid that fits narrow viewports", async () => {
  mockApi({ "GET /api/v1/devices": [devices[0]!] });
  const first = renderPage(<LiveBoardPage />); await screen.findByText("Pixel");
  fireEvent.change(screen.getByRole("slider", { name: "타일 크기" }), { target: { value: "320" } });
  expect(localStorage.getItem("farm.live-board.tile-size")).toBe("320");
  expect(screen.getByRole("region", { name: "기기 라이브 그리드" })).toHaveStyle({ gridTemplateColumns: "repeat(auto-fill, minmax(min(320px, 100%), 1fr))" });
  first.unmount(); renderPage(<LiveBoardPage />);
  expect(screen.getByRole("slider", { name: "타일 크기" })).toHaveValue("320");
});

test.each(["garbage", "900", "", "Infinity"])("invalid stored tile size %s falls back to the default", (stored) => {
  localStorage.setItem("farm.live-board.tile-size", stored);
  mockApi({ "GET /api/v1/devices": [] }); renderPage(<LiveBoardPage />);
  expect(screen.getByRole("slider", { name: "타일 크기" })).toHaveValue("240");
});

test("localStorage failures preserve session resizing", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  mockApi({ "GET /api/v1/devices": [] }); renderPage(<LiveBoardPage />);
  const slider = screen.getByRole("slider", { name: "타일 크기" });
  expect(slider).toHaveValue("240");
  fireEvent.change(slider, { target: { value: "300" } }); expect(slider).toHaveValue("300");
});

test("offscreen, hidden tabs and the global pause close streams and resume only visible tiles", async () => {
  mockApi({ "GET /api/v1/devices": [devices[0]!, devices[1]!] });
  const view = renderPage(<LiveBoardPage />); await screen.findByText("Pixel"); showTiles();
  expect(Socket.instances).toHaveLength(2);
  act(() => Observer.instances[0]!.setVisible(false));
  expect(Socket.instances[0]!.close).toHaveBeenCalledOnce();
  visibility("hidden"); expect(Socket.instances[1]!.close).toHaveBeenCalledOnce();
  visibility("visible"); expect(Socket.instances).toHaveLength(3);
  await userEvent.click(screen.getByRole("button", { name: "모두 일시정지" }));
  expect(Socket.instances[2]!.close).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole("button", { name: "모두 재생" }));
  expect(Socket.instances).toHaveLength(4);
  view.unmount(); expect(Socket.instances[3]!.close).toHaveBeenCalledOnce();
  expect(Observer.instances.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(true);
});

test("an initially hidden browser tab does not connect until visible", async () => {
  visibility("hidden");
  mockApi({ "GET /api/v1/devices": [devices[0]!] }); renderPage(<LiveBoardPage />);
  await screen.findByText("Pixel"); showTiles(); expect(Socket.instances).toHaveLength(0);
  visibility("visible"); expect(Socket.instances).toHaveLength(1);
});

test("opening a tile mounts the existing LiveView in a Drawer and pauses only that tile", async () => {
  mockApi({ "GET /api/v1/devices": [devices[0]!, devices[1]!] });
  renderPage(<LiveBoardPage />); await screen.findByText("Pixel"); showTiles();
  await userEvent.click(screen.getByRole("button", { name: "Pixel a 라이브 열기" }));
  const drawer = screen.getByRole("dialog", { name: "Pixel 라이브" });
  expect(within(drawer).getByText("확대 화면 a")).toBeInTheDocument();
  const resize = within(drawer).getByRole("separator", { name: "패널 너비 조절" });
  fireEvent.keyDown(resize, { key: "ArrowLeft" });
  expect(localStorage.getItem("farm.live.drawer-width")).toBe("404");
  expect(Socket.instances[0]!.close).toHaveBeenCalledOnce();
  expect(Socket.instances[1]!.close).not.toHaveBeenCalled();
  await userEvent.click(within(drawer).getByRole("button", { name: "닫기" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(Socket.instances).toHaveLength(3);
});

test("device aspect ratio follows stream dimensions and survives a pause", async () => {
  mockApi({ "GET /api/v1/devices": [devices[0]!] });
  renderPage(<LiveBoardPage />); await screen.findByText("Pixel"); showTiles();
  const bytes = new Uint8Array([1, 0, 0, 0, 0, 11, ...new TextEncoder().encode("avc1.64001f")]);
  const data = new DataView(bytes.buffer); data.setUint16(1, 2400); data.setUint16(3, 1080);
  act(() => Socket.instances[0]!.message(bytes.buffer));
  expect(screen.getByLabelText("a 화면 영역")).toHaveStyle({ aspectRatio: "2400 / 1080" });
  await userEvent.click(screen.getByRole("button", { name: "모두 일시정지" }));
  expect(screen.getByLabelText("a 화면 영역")).toHaveStyle({ aspectRatio: "2400 / 1080" });
});

test("empty, offline-only and failed loads have Korean explanations", async () => {
  mockApi({ "GET /api/v1/devices": [] }); let current = renderPage(<LiveBoardPage />);
  expect(await screen.findByText("연결된 기기가 없습니다. farm-agent가 실행 중인지 확인하세요.")).toBeInTheDocument();
  current.unmount();
  mockApi({ "GET /api/v1/devices": [devices[5]!] }); current = renderPage(<LiveBoardPage />);
  expect(await screen.findByText("연결된 기기가 없습니다. 오프라인 기기는 연결되면 여기에 표시됩니다.")).toBeInTheDocument();
  expect(Socket.instances).toHaveLength(0); current.unmount();
  mockApi({ "GET /api/v1/devices": () => apiErrorResponse(500, "internal", "internal failure") }); renderPage(<LiveBoardPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent("기기 목록을 불러오지 못했습니다. 잠시 후 다시 시도하세요.");
});
