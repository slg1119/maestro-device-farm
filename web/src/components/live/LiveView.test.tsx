import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { LiveView } from "./LiveView";
import { renderPage } from "../../test/render";
import { mockApi } from "../../test/api";

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
function mount() {
  const view = renderPage(<LiveView serial="s1" />); const canvas = screen.getByLabelText("실시간 기기 화면");
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 400, height: 400 } as DOMRect);
  Object.assign(canvas, { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() });
  return { ...view, canvas };
}

test("maps touch including captured movement outside, scroll, toolbar keys and text", () => {
  const { canvas } = mount();
  expect(screen.getByRole("alert")).toHaveTextContent("CI 테스트 실행 중 · 조작하면 결과가 달라질 수 있음");
  expect(screen.getByText("시청자 3명")).toBeInTheDocument(); expect(screen.getByText("조작자 운영자")).toBeInTheDocument(); expect(screen.getByText("녹화 중")).toBeInTheDocument();
  pointer(canvas, "pointerdown", 0, 200); expect(send).not.toHaveBeenCalled();
  pointer(canvas, "pointerdown", 200, 200); pointer(canvas, "pointermove", 1000, 1000, 2); pointer(canvas, "pointermove", 1000, 1000); pointer(canvas, "pointerup", 1000, 1000);
  expect(send.mock.calls).toEqual([[{ type: "touch", action: "down", x: 50, y: 100 }], [{ type: "touch", action: "move", x: 99, y: 199 }], [{ type: "touch", action: "up", x: 99, y: 199 }]]);
  fireEvent.wheel(canvas, { clientX: 200, clientY: 200, deltaX: 50, deltaY: 100 }); expect(send).toHaveBeenLastCalledWith({ type: "scroll", x: 50, y: 100, dx: 0.5, dy: 1 });
  for (const [label, key] of [["뒤로", "BACK"], ["홈", "HOME"], ["최근 앱", "APP_SWITCH"]]) { fireEvent.click(screen.getByRole("button", { name: label })); expect(send).toHaveBeenLastCalledWith({ type: "key", key }); }
  const input = screen.getByRole("textbox", { name: "기기에 텍스트 입력" }); fireEvent.change(input, { target: { value: "한글 입력" } }); fireEvent.submit(input.closest("form")!);
  expect(send).toHaveBeenLastCalledWith({ type: "text", text: "한글 입력" }); expect(input).toHaveValue(""); expect(input).toHaveAttribute("maxlength", "300");
});

test("view-only blocks pointer, wheel, keys and text and omits the CI control warning", () => {
  mock.stream.mockReturnValue(state(false)); const { canvas } = mount();
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
