import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { LiveView } from "./LiveView";
import { Drawer } from "../ui";
import { renderPage } from "../../test/render";
import { mockApi } from "../../test/api";
import { LIVE_DRAWER_STORAGE_KEY, LIVE_HEIGHT_STORAGE_KEYS } from "./useResizableSize";

const mock = vi.hoisted(() => ({ stream: vi.fn(), write: vi.fn() }));
vi.mock("./useLiveStream", () => ({ useLiveStream: mock.stream }));
vi.mock("../Layout", () => ({ useCanWrite: mock.write }));
const send = vi.fn(() => true);
function state(canControl = true) {
  return { phase: "connected", size: { width: 100, height: 200 }, status: { viewers: 3, controller: "운영자", recording: true, running_task_id: "t1", control: canControl }, canControl, send, message: "" };
}
function pointer(canvas: HTMLElement, type: string, x: number, y: number, id = 1) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { clientX: x, clientY: y, pointerId: id, button: 0 }); fireEvent(canvas, event);
}
beforeEach(() => { send.mockClear(); mock.write.mockReturnValue(true); mock.stream.mockReturnValue(state()); mockApi({ "GET /api/v1/workspaces": [], "GET /api/v1/ai/status": { enabled: false }, "GET /api/v1/devices/s1/recordings": [] }); });
function mount(compact = false) {
  const view = renderPage(<LiveView serial="s1" compact={compact} />); const canvas = screen.getByLabelText("실시간 기기 화면");
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 400, height: 400 } as DOMRect);
  Object.assign(canvas, { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() });
  return { ...view, canvas };
}

test.each([false, true])("toggles enlarged mode without remounting the stream or canvas (compact: %s)", compact => {
  const mounted = vi.fn(); const disconnected = vi.fn(); const stream = state();
  mock.stream.mockImplementation(function useMockLiveStream() {
    useEffect(() => { mounted(); return disconnected; }, []);
    return stream;
  });
  const { canvas } = mount(compact); const section = screen.getByRole("region", { name: "s1 실시간 화면" });
  const toggle = screen.getByRole("button", { name: "크게 보기" });
  const input = screen.getByRole("textbox", { name: "기기에 텍스트 입력" });
  const recording = screen.getByRole("button", { name: "녹화" });
  fireEvent.change(input, { target: { value: "작성 중" } });
  expect(toggle).toHaveAttribute("title", "크게 보기"); expect(toggle).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(toggle);
  expect(section).toHaveClass("fixed", "inset-0", "z-[60]", "bg-surface", "h-dvh");
  expect(screen.getByRole("button", { name: "작게 보기" })).toBe(toggle);
  expect(toggle).toHaveAttribute("title", "작게 보기"); expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("조작자 운영자")).toBeInTheDocument(); expect(screen.getByText("녹화 중")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "홈" })); expect(send).toHaveBeenLastCalledWith({ type: "key", key: "HOME" });
  fireEvent.click(toggle);
  expect(section).not.toHaveClass("fixed"); expect(toggle).toHaveAccessibleName("크게 보기"); expect(toggle).toHaveFocus();
  expect(screen.getByLabelText("실시간 기기 화면")).toBe(canvas);
  expect(screen.getByRole("button", { name: "녹화" })).toBe(recording); expect(input).toHaveValue("작성 중");
  expect(mounted).toHaveBeenCalledTimes(1); expect(disconnected).not.toHaveBeenCalled();
});

test("Escape leaves enlarged mode and restores toggle focus before the drawer can close", () => {
  const close = vi.fn(); renderPage(<Drawer title="기기 라이브" onClose={close}><LiveView serial="s1" /></Drawer>);
  const toggle = screen.getByRole("button", { name: "크게 보기" }); fireEvent.click(toggle);
  const input = screen.getByRole("textbox"); input.focus(); fireEvent.keyDown(input, { key: "Escape" });
  expect(close).not.toHaveBeenCalled(); expect(screen.getByRole("region", { name: "s1 실시간 화면" })).not.toHaveClass("fixed");
  expect(toggle).toHaveAccessibleName("크게 보기"); expect(toggle).toHaveFocus();
  fireEvent.keyDown(toggle, { key: "Escape" }); expect(close).toHaveBeenCalledTimes(1);
});

test("Escape closes a recording dialog before leaving enlarged mode without closing the drawer", async () => {
  const close = vi.fn(); renderPage(<Drawer title="기기 라이브" onClose={close}><LiveView serial="s1" /></Drawer>);
  const section = screen.getByRole("region", { name: "s1 실시간 화면" });
  const toggle = screen.getByRole("button", { name: "크게 보기" }); fireEvent.click(toggle);
  const recording = screen.getByRole("button", { name: "녹화" }); await waitFor(() => expect(recording).toBeEnabled());
  recording.focus(); fireEvent.click(recording);
  const dialog = screen.getByRole("dialog", { name: "녹화 시작" });
  expect(dialog).toContainElement(document.activeElement as HTMLElement);
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "녹화 시작" })).not.toBeInTheDocument();
  expect(section).toHaveClass("fixed"); expect(recording).toHaveFocus(); expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(recording, { key: "Escape" });
  expect(section).not.toHaveClass("fixed"); expect(toggle).toHaveFocus(); expect(close).not.toHaveBeenCalled();
});

test.each([false, true])("enlarged controls and recording dialogs retain keyboard focus and stacking (compact: %s)", async compact => {
  renderPage(compact ? <LiveView serial="s1" compact /> : <Drawer title="기기 라이브" onClose={vi.fn()}><LiveView serial="s1" /></Drawer>);
  const toggle = screen.getByRole("button", { name: "크게 보기" }); fireEvent.click(toggle);
  const recording = screen.getByRole("button", { name: "녹화" }); await waitFor(() => expect(recording).toBeEnabled());
  const resize = screen.getByRole("separator", { name: "화면 크기 조절" });
  recording.focus(); fireEvent.keyDown(recording, { key: "Tab" }); expect(resize).toHaveFocus();
  fireEvent.keyDown(resize, { key: "Tab", shiftKey: true }); expect(recording).toHaveFocus();
  fireEvent.click(recording);
  expect(screen.getByRole("dialog", { name: "녹화 시작" }).parentElement).toHaveClass("z-[70]");
  const start = screen.getByRole("button", { name: "시작" }); start.focus(); fireEvent.keyDown(start, { key: "Tab" });
  const close = within(screen.getByRole("dialog", { name: "녹화 시작" })).getAllByRole("button", { name: "닫기" })[0]!;
  expect(close).toHaveFocus(); fireEvent.click(close);
});

test("unmounting an enlarged drawer removes the layer and Escape listener and restores scrolling", () => {
  const overflow = document.body.style.overflow; const close = vi.fn();
  const { unmount } = renderPage(<Drawer title="기기 라이브" onClose={close}><LiveView serial="s1" /></Drawer>);
  fireEvent.click(screen.getByRole("button", { name: "크게 보기" })); unmount();
  expect(screen.queryByRole("region", { name: "s1 실시간 화면" })).not.toBeInTheDocument();
  expect(document.body.style.overflow).toBe(overflow);
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  document.dispatchEvent(escape); expect(escape.defaultPrevented).toBe(false); expect(close).not.toHaveBeenCalled();
});

test.each([false, true])("unmounting enlarged mode with an open recording dialog restores scrolling (compact: %s)", async compact => {
  const overflow = document.body.style.overflow;
  const { unmount } = renderPage(compact ? <LiveView serial="s1" compact /> : <Drawer title="기기 라이브" onClose={vi.fn()}><LiveView serial="s1" /></Drawer>);
  fireEvent.click(screen.getByRole("button", { name: "크게 보기" }));
  const recording = screen.getByRole("button", { name: "녹화" }); await waitFor(() => expect(recording).toBeEnabled()); fireEvent.click(recording);
  expect(screen.getByRole("dialog", { name: "녹화 시작" })).toBeInTheDocument(); unmount();
  expect(document.body.style.overflow).toBe(overflow); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("enlarged touch, captured drag and wheel use the current canvas rect", () => {
  const { canvas } = mount(); fireEvent.click(screen.getByRole("button", { name: "크게 보기" }));
  vi.mocked(canvas.getBoundingClientRect).mockReturnValue({ left: 20, top: 30, width: 1000, height: 600 } as DOMRect);
  pointer(canvas, "pointerdown", 100, 330); expect(send).not.toHaveBeenCalled();
  pointer(canvas, "pointerdown", 445, 180); pointer(canvas, "pointermove", 595, 480); pointer(canvas, "pointerup", 595, 480);
  expect(send.mock.calls).toEqual([[{ type: "touch", action: "down", x: 25, y: 50 }], [{ type: "touch", action: "move", x: 75, y: 150 }], [{ type: "touch", action: "up", x: 75, y: 150 }]]);
  fireEvent.wheel(canvas, { clientX: 520, clientY: 330, deltaY: 100 });
  expect(send).toHaveBeenLastCalledWith({ type: "scroll", x: 50, y: 100, dx: 0, dy: 1 });
});

test("maps touch including captured movement outside, scroll, toolbar keys and text", () => {
  const { canvas } = mount();
  expect(screen.getByRole("alert").textContent).toBe("테스트 실행 중 · 조작하면 결과가 달라질 수 있음");
  expect(screen.getByText("시청자 3명")).toBeInTheDocument(); expect(screen.getByText("조작자 운영자")).toBeInTheDocument(); expect(screen.getByText("녹화 중")).toBeInTheDocument();
  pointer(canvas, "pointerdown", 0, 200); expect(send).not.toHaveBeenCalled();
  pointer(canvas, "pointerdown", 200, 200); pointer(canvas, "pointermove", 1000, 1000, 2); pointer(canvas, "pointermove", 1000, 1000); pointer(canvas, "pointerup", 1000, 1000);
  expect(send.mock.calls).toEqual([[{ type: "touch", action: "down", x: 50, y: 100 }], [{ type: "touch", action: "move", x: 99, y: 199 }], [{ type: "touch", action: "up", x: 99, y: 199 }]]);
  fireEvent.wheel(canvas, { clientX: 200, clientY: 200, deltaX: 50, deltaY: 100 }); expect(send).toHaveBeenLastCalledWith({ type: "scroll", x: 50, y: 100, dx: 0.5, dy: 1 });
  for (const [label, key] of [["뒤로", "BACK"], ["홈", "HOME"], ["최근 앱", "APP_SWITCH"]]) { fireEvent.click(screen.getByRole("button", { name: label })); expect(send).toHaveBeenLastCalledWith({ type: "key", key }); }
  const input = screen.getByRole("textbox", { name: "기기에 텍스트 입력" }); fireEvent.change(input, { target: { value: "한글 입력" } }); fireEvent.submit(input.closest("form")!);
  expect(send).toHaveBeenLastCalledWith({ type: "text", text: "한글 입력" }); expect(input).toHaveValue(""); expect(input).toHaveAttribute("maxlength", "300");
});

test("view-only blocks pointer, wheel, keys and text and omits the running-task warning", () => {
  mock.stream.mockReturnValue(state(false)); const { canvas } = mount();
  fireEvent.click(screen.getByRole("button", { name: "크게 보기" })); expect(screen.getByRole("button", { name: "작게 보기" })).toBeEnabled();
  expect(screen.getByText("보기 전용")).toBeInTheDocument(); expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  pointer(canvas, "pointerdown", 200, 200); pointer(canvas, "pointerup", 200, 200); fireEvent.wheel(canvas, { clientX: 200, clientY: 200, deltaY: 100 });
  for (const label of ["뒤로", "홈", "최근 앱"]) { const button = screen.getByRole("button", { name: label }); expect(button).toBeDisabled(); fireEvent.click(button); }
  expect(screen.getByRole("textbox")).toBeDisabled(); expect(send).not.toHaveBeenCalled();
});

test("pointer cancellation releases the virtual finger", () => {
  const { canvas } = mount(); pointer(canvas, "pointerdown", 200, 200); pointer(canvas, "pointercancel", 200, 200);
  expect(send).toHaveBeenLastCalledWith({ type: "touch", action: "up", x: 50, y: 100 });
});

test("unmount releases an active touch before the socket closes", () => {
  const { canvas, unmount } = mount(); pointer(canvas, "pointerdown", 200, 200); unmount();
  expect(send).toHaveBeenLastCalledWith({ type: "touch", action: "up", x: 50, y: 100 });
});

test("shows unsupported browser copy without control UI", () => {
  mock.stream.mockReturnValue({ ...state(false), phase: "unsupported" }); render(<LiveView serial="s1" control="never" compact />);
  expect(screen.getByText("이 브라우저는 실시간 화면을 지원하지 않습니다 (Chrome/Edge 최신 버전 권장)")).toBeInTheDocument(); expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});

test.each([{ compact: false, enlarged: false }, { compact: true, enlarged: false }, { compact: false, enlarged: true }, { compact: true, enlarged: true }])("screen drag and keyboard resizing preserve canvas, stream and recording ($compact / $enlarged)", ({ compact, enlarged }) => {
  vi.stubGlobal("innerHeight", 1000);
  const mounted = vi.fn(); const disconnected = vi.fn(); const stream = state();
  mock.stream.mockImplementation(function useMockLiveStream() { useEffect(() => { mounted(); return disconnected; }, []); return stream; });
  const { canvas } = mount(compact);
  if (enlarged) fireEvent.click(screen.getByRole("button", { name: "크게 보기" }));
  const recording = screen.getByRole("button", { name: "녹화" });
  const handle = screen.getByRole("separator", { name: "화면 크기 조절" });
  expect(handle).toHaveAttribute("aria-orientation", "horizontal"); expect(handle).toHaveAttribute("tabindex", "0");
  const maximum = Number(handle.getAttribute("aria-valuemax"));
  fireEvent.keyDown(handle, { key: "Home" }); expect(handle).toHaveAttribute("aria-valuenow", "200");
  Object.assign(handle, { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() });
  pointer(handle, "pointerdown", 10, 300); pointer(handle, "pointermove", 10, 380, 2);
  expect(handle).toHaveAttribute("aria-valuenow", "200");
  pointer(handle, "pointermove", 10, 380); pointer(handle, "pointerup", 10, 380);
  expect(handle).toHaveAttribute("aria-valuenow", "280"); expect(canvas.parentElement).toHaveStyle({ height: "280px" });
  expect(handle.setPointerCapture).toHaveBeenCalledWith(1); expect(handle.releasePointerCapture).toHaveBeenCalledWith(1);
  expect(handle).toHaveFocus(); expect(send).not.toHaveBeenCalled();
  fireEvent.keyDown(handle, { key: "ArrowUp" }); expect(handle).toHaveAttribute("aria-valuenow", "260");
  fireEvent.keyDown(handle, { key: "ArrowDown" }); expect(handle).toHaveAttribute("aria-valuenow", "280");
  fireEvent.keyDown(handle, { key: "End" }); expect(handle).toHaveAttribute("aria-valuenow", String(maximum));
  pointer(handle, "pointerdown", 10, 300); pointer(handle, "pointermove", 10, 20000); pointer(handle, "pointercancel", 10, 20000);
  pointer(handle, "pointermove", 10, 100); expect(handle).toHaveAttribute("aria-valuenow", String(maximum));
  fireEvent.doubleClick(handle); const fit = Number(handle.getAttribute("aria-valuenow"));
  fireEvent.keyDown(handle, { key: "Home" }); fireEvent.click(screen.getByRole("button", { name: "맞춤" }));
  expect(handle).toHaveAttribute("aria-valuenow", String(fit));
  expect(canvas).toHaveClass("object-contain", "w-full"); expect(screen.getByLabelText("실시간 기기 화면")).toBe(canvas);
  expect(screen.getByRole("button", { name: "녹화" })).toBe(recording); expect(screen.getByText("조작자 운영자")).toBeInTheDocument(); expect(screen.getByText("녹화 중")).toBeInTheDocument();
  expect(mounted).toHaveBeenCalledTimes(1); expect(disconnected).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
});

test("normal, compact and enlarged heights persist independently and clamp on load and resize", () => {
  vi.stubGlobal("innerHeight", 1000);
  localStorage.setItem(LIVE_HEIGHT_STORAGE_KEYS.normal, "9999"); localStorage.setItem(LIVE_HEIGHT_STORAGE_KEYS.compact, "100"); localStorage.setItem(LIVE_HEIGHT_STORAGE_KEYS.enlarged, "700");
  const view = mount(); const handle = screen.getByRole("separator", { name: "화면 크기 조절" });
  expect(handle).toHaveAttribute("aria-valuenow", "900"); expect(localStorage.getItem(LIVE_HEIGHT_STORAGE_KEYS.normal)).toBe("900");
  fireEvent.keyDown(handle, { key: "ArrowUp" }); expect(localStorage.getItem(LIVE_HEIGHT_STORAGE_KEYS.normal)).toBe("880");
  const toggle = screen.getByRole("button", { name: "크게 보기" }); fireEvent.click(toggle);
  expect(handle).toHaveAttribute("aria-valuenow", "700"); fireEvent.keyDown(handle, { key: "ArrowUp" });
  expect(localStorage.getItem(LIVE_HEIGHT_STORAGE_KEYS.enlarged)).toBe("680"); fireEvent.click(toggle);
  expect(handle).toHaveAttribute("aria-valuenow", "880");
  vi.stubGlobal("innerHeight", 600); fireEvent(window, new Event("resize"));
  expect(handle).toHaveAttribute("aria-valuenow", "540"); expect(localStorage.getItem(LIVE_HEIGHT_STORAGE_KEYS.normal)).toBe("540");
  view.unmount(); const compact = mount(true);
  expect(screen.getByRole("separator", { name: "화면 크기 조절" })).toHaveAttribute("aria-valuenow", "200");
  fireEvent.keyDown(screen.getByRole("separator", { name: "화면 크기 조절" }), { key: "ArrowDown" }); compact.unmount(); mount(true);
  expect(screen.getByRole("separator", { name: "화면 크기 조절" })).toHaveAttribute("aria-valuenow", "220");
});

test("enlarged maximum excludes measured controls and updates as controls resize", () => {
  vi.stubGlobal("innerHeight", 800);
  let notify = () => {}; let controlHeight = 100;
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { notify = callback; } observe() {} disconnect() {} });
  const { canvas } = mount(); const root = screen.getByRole("region", { name: "s1 실시간 화면" });
  const controls = [...root.children].filter(child => child !== canvas.parentElement);
  const measures = controls.map(child => vi.spyOn(child, "getBoundingClientRect").mockImplementation(() => ({ height: controlHeight } as DOMRect)));
  fireEvent.click(screen.getByRole("button", { name: "크게 보기" }));
  const handle = screen.getByRole("separator", { name: "화면 크기 조절" });
  expect(handle).toHaveAttribute("aria-valuemax", String(800 - controls.length * 100));
  controlHeight = 120; fireEvent.keyDown(handle, { key: "End" });
  // A real ResizeObserver reports wrapped controls after a panel/viewport change.
  act(() => notify());
  expect(handle).toHaveAttribute("aria-valuenow", String(800 - controls.length * 120));
  measures.forEach(measure => measure.mockRestore());
});

test("resizing a live drawer and screen keeps instances and maps input using the resized rect", () => {
  const mounted = vi.fn(); const disconnected = vi.fn(); const stream = state();
  mock.stream.mockImplementation(function useMockLiveStream() { useEffect(() => { mounted(); return disconnected; }, []); return stream; });
  renderPage(<Drawer title="기기 라이브" onClose={vi.fn()} resizable storageKey={LIVE_DRAWER_STORAGE_KEY}><LiveView serial="s1" /></Drawer>);
  const canvas = screen.getByLabelText("실시간 기기 화면"); const recording = screen.getByRole("button", { name: "녹화" });
  const screenHandle = screen.getByRole("separator", { name: "화면 크기 조절" }); const drawerHandle = screen.getByRole("separator", { name: "패널 너비 조절" });
  for (const handle of [screenHandle, drawerHandle]) { pointer(handle, "pointerdown", 400, 400); pointer(handle, "pointermove", 300, 450); pointer(handle, "pointerup", 300, 450); }
  expect(send).not.toHaveBeenCalled(); expect(screen.getByLabelText("실시간 기기 화면")).toBe(canvas); expect(screen.getByRole("button", { name: "녹화" })).toBe(recording);
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 20, top: 30, width: 1000, height: 600 } as DOMRect);
  Object.assign(canvas, { setPointerCapture: vi.fn() });
  pointer(canvas, "pointerdown", 445, 180); pointer(canvas, "pointerup", 595, 480);
  expect(send.mock.calls).toEqual([[{ type: "touch", action: "down", x: 25, y: 50 }], [{ type: "touch", action: "up", x: 75, y: 150 }]]);
  fireEvent.wheel(canvas, { clientX: 520, clientY: 330, deltaY: 100 }); expect(send).toHaveBeenLastCalledWith({ type: "scroll", x: 50, y: 100, dx: 0, dy: 1 });
  expect(mounted).toHaveBeenCalledTimes(1); expect(disconnected).not.toHaveBeenCalled();
});

test("blocked or invalid height storage falls back to fit and remains resizable", () => {
  vi.stubGlobal("innerHeight", 1000); localStorage.setItem(LIVE_HEIGHT_STORAGE_KEYS.normal, "NaN");
  const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
  try {
    mount(); const handle = screen.getByRole("separator", { name: "화면 크기 조절" }); expect(handle).toHaveAttribute("aria-valuenow", "600");
    fireEvent.keyDown(handle, { key: "Home" }); expect(handle).toHaveAttribute("aria-valuenow", "200");
    fireEvent.click(screen.getByRole("button", { name: "맞춤" })); expect(handle).toHaveAttribute("aria-valuenow", "600");
  } finally { get.mockRestore(); set.mockRestore(); remove.mockRestore(); }
});
