import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { Drawer, Modal, ProgressBar, Tabs } from "../ui";
import { LIVE_DRAWER_STORAGE_KEY } from "../live/useResizableSize";

function StackedDialogs() {
  const [drawer, setDrawer] = useState(true); const [modal, setModal] = useState(false);
  return drawer && <Drawer title="기기 정보" onClose={() => setDrawer(false)}>
    <button onClick={() => setModal(true)}>대화상자 열기</button>
    {modal && <Modal title="확인 대화상자" onClose={() => setModal(false)}><button>확인</button></Modal>}
  </Drawer>;
}

test("Escape closes only the topmost dialog and then the underlying drawer", async () => {
  render(<StackedDialogs />); const open = screen.getByRole("button", { name: "대화상자 열기" });
  await userEvent.click(open); await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "확인 대화상자" })).not.toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "기기 정보" })).toBeInTheDocument(); expect(open).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "기기 정보" })).not.toBeInTheDocument();
});

test.each([false, true])("only the topmost dialog traps Tab until it closes (shift: %s)", async shiftKey => {
  render(<StackedDialogs />); const open = screen.getByRole("button", { name: "대화상자 열기" });
  const drawerClose = within(screen.getByRole("dialog", { name: "기기 정보" })).getByRole("button", { name: "닫기" });
  await userEvent.click(open);
  const modal = within(screen.getByRole("dialog", { name: "확인 대화상자" }));
  const modalClose = modal.getByRole("button", { name: "닫기" }); const confirm = modal.getByRole("button", { name: "확인" });
  (shiftKey ? modalClose : confirm).focus(); await userEvent.tab({ shift: shiftKey });
  expect(shiftKey ? confirm : modalClose).toHaveFocus();
  const edge = shiftKey ? drawerClose : open; edge.focus();
  expect(fireEvent.keyDown(edge, { key: "Tab", shiftKey })).toBe(true); expect(edge).toHaveFocus();
  await userEvent.click(modalClose); edge.focus();
  expect(fireEvent.keyDown(edge, { key: "Tab", shiftKey })).toBe(false);
  expect(shiftKey ? open : drawerClose).toHaveFocus();
});

test("progress segments occupy their share of the total and expose a label", () => {
  render(<ProgressBar label="4개 결과: 통과 3, 실패 1" segments={[{ value: 3, tone: "passed" }, { value: 1, tone: "failed" }]} />);
  const bar = screen.getByRole("progressbar", { name: "4개 결과: 통과 3, 실패 1" });
  expect(bar).toHaveAttribute("aria-valuenow", "4");
  expect(bar).toHaveAttribute("aria-valuemax", "4");
  expect(bar.children[0]).toHaveStyle({ width: "75%" });
  expect(bar.children[1]).toHaveStyle({ width: "25%" });
});

test("tabs select and focus with arrows, wrap and skip disabled options", async () => {
  function Example() {
    const [value, setValue] = useState("steps");
    return <Tabs label="작업 정보" value={value} onChange={setValue} options={[
      { value: "steps", label: "단계" }, { value: "hidden", label: "준비 중", disabled: true }, { value: "files", label: "파일" },
    ]} />;
  }
  render(<Example />);
  screen.getByRole("tab", { name: "단계" }).focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "파일", selected: true })).toHaveFocus();
  await userEvent.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "단계", selected: true })).toHaveFocus();
  await userEvent.keyboard("{End}");
  expect(screen.getByRole("tab", { name: "파일", selected: true })).toHaveFocus();
  await userEvent.keyboard("{Home}");
  expect(screen.getByRole("tab", { name: "단계", selected: true })).toHaveFocus();
});

function resizePointer(handle: HTMLElement, type: string, x: number, id = 1) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { clientX: x, clientY: 0, pointerId: id, button: 0 }); fireEvent(handle, event);
}

test.each(["right", "left"] as const)("opt-in %s drawer resizes from its inner edge by drag and keyboard", side => {
  vi.stubGlobal("innerWidth", 1200); const close = vi.fn();
  render(<Drawer title="라이브" onClose={close} side={side} resizable storageKey={LIVE_DRAWER_STORAGE_KEY}><input aria-label="작성 중" defaultValue="유지" /></Drawer>);
  const drawer = screen.getByRole("dialog"); const input = screen.getByRole("textbox");
  const handle = screen.getByRole("separator", { name: "패널 너비 조절" });
  expect(handle).toHaveAttribute("aria-orientation", "vertical"); expect(handle).toHaveAttribute("tabindex", "0");
  expect(handle).toHaveClass(side === "right" ? "left-0" : "right-0"); expect(drawer).toHaveStyle({ width: "384px" });
  Object.assign(handle, { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() });
  resizePointer(handle, "pointerdown", 500); resizePointer(handle, "pointermove", 900, 2); expect(drawer).toHaveStyle({ width: "384px" });
  const x = side === "right" ? 420 : 580;
  resizePointer(handle, "pointermove", x); resizePointer(handle, "pointerup", x);
  expect(drawer).toHaveStyle({ width: "464px" }); expect(handle).toHaveAttribute("aria-valuenow", "464");
  expect(handle).toHaveFocus(); expect(handle.setPointerCapture).toHaveBeenCalledWith(1); expect(handle.releasePointerCapture).toHaveBeenCalledWith(1);
  expect(localStorage.getItem(LIVE_DRAWER_STORAGE_KEY)).toBe("464");
  fireEvent.keyDown(handle, { key: "ArrowLeft" }); expect(handle).toHaveAttribute("aria-valuenow", side === "right" ? "484" : "444");
  fireEvent.keyDown(handle, { key: "ArrowRight" }); expect(handle).toHaveAttribute("aria-valuenow", "464");
  fireEvent.keyDown(handle, { key: "Home" }); expect(drawer).toHaveStyle({ width: "320px" });
  fireEvent.keyDown(handle, { key: "End" }); expect(drawer).toHaveStyle({ width: "1168px" });
  resizePointer(handle, "pointerdown", 500); resizePointer(handle, "pointermove", side === "right" ? -20000 : 20000);
  resizePointer(handle, "pointercancel", 500); resizePointer(handle, "pointermove", side === "right" ? 20000 : -20000);
  expect(drawer).toHaveStyle({ width: "1168px" });
  fireEvent.doubleClick(handle); expect(drawer).toHaveStyle({ width: "384px" }); expect(localStorage.getItem(LIVE_DRAWER_STORAGE_KEY)).toBeNull();
  expect(screen.getByRole("textbox")).toBe(input); expect(input).toHaveValue("유지"); expect(close).not.toHaveBeenCalled();
});

test("drawer width persists across mounts and clamps stored and current values at 375px", () => {
  vi.stubGlobal("innerWidth", 1200); localStorage.setItem(LIVE_DRAWER_STORAGE_KEY, "9999");
  const first = render(<Drawer title="라이브" onClose={vi.fn()} resizable storageKey={LIVE_DRAWER_STORAGE_KEY}>내용</Drawer>);
  expect(screen.getByRole("dialog")).toHaveStyle({ width: "1168px" }); expect(localStorage.getItem(LIVE_DRAWER_STORAGE_KEY)).toBe("1168");
  fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowRight" }); expect(localStorage.getItem(LIVE_DRAWER_STORAGE_KEY)).toBe("1148");
  first.unmount(); const second = render(<Drawer title="라이브" onClose={vi.fn()} resizable storageKey={LIVE_DRAWER_STORAGE_KEY}>내용</Drawer>);
  expect(screen.getByRole("dialog")).toHaveStyle({ width: "1148px" });
  vi.stubGlobal("innerWidth", 375); fireEvent(window, new Event("resize"));
  expect(screen.getByRole("dialog")).toHaveStyle({ width: "343px" }); expect(screen.getByRole("separator")).toHaveAttribute("aria-valuemax", "343");
  expect(localStorage.getItem(LIVE_DRAWER_STORAGE_KEY)).toBe("343"); second.unmount();
  localStorage.setItem(LIVE_DRAWER_STORAGE_KEY, "100");
  render(<Drawer title="라이브" onClose={vi.fn()} resizable storageKey={LIVE_DRAWER_STORAGE_KEY}>내용</Drawer>);
  expect(screen.getByRole("dialog")).toHaveStyle({ width: "320px" });
});

test.each(["NaN", "Infinity", ""])('invalid drawer width "%s" uses the default', stored => {
  vi.stubGlobal("innerWidth", 1200); localStorage.setItem(LIVE_DRAWER_STORAGE_KEY, stored);
  render(<Drawer title="라이브" onClose={vi.fn()} resizable storageKey={LIVE_DRAWER_STORAGE_KEY}>내용</Drawer>);
  expect(screen.getByRole("dialog")).toHaveStyle({ width: "384px" });
});

test("blocked drawer storage still allows drag, keyboard and reset", () => {
  vi.stubGlobal("innerWidth", 1200);
  const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
  try {
    render(<Drawer title="라이브" onClose={vi.fn()} resizable storageKey={LIVE_DRAWER_STORAGE_KEY}>내용</Drawer>);
    const handle = screen.getByRole("separator"); expect(handle).toHaveAttribute("aria-valuenow", "384");
    resizePointer(handle, "pointerdown", 500); resizePointer(handle, "pointermove", 420); resizePointer(handle, "pointerup", 420);
    expect(handle).toHaveAttribute("aria-valuenow", "464"); fireEvent.keyDown(handle, { key: "ArrowLeft" }); expect(handle).toHaveAttribute("aria-valuenow", "484");
    fireEvent.doubleClick(handle); expect(handle).toHaveAttribute("aria-valuenow", "384");
  } finally { get.mockRestore(); set.mockRestore(); remove.mockRestore(); }
});

test("other drawers retain their fixed width and existing close focus", () => {
  render(<Drawer title="기기 정보" onClose={vi.fn()} storageKey={LIVE_DRAWER_STORAGE_KEY}>내용</Drawer>);
  expect(screen.queryByRole("separator")).not.toBeInTheDocument(); expect(screen.getByRole("dialog")).toHaveClass("w-96");
  expect(screen.getByRole("dialog").style.width).toBe(""); expect(screen.getByRole("button", { name: "닫기" })).toHaveFocus();
});
