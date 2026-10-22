import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { Drawer, Modal, ProgressBar, Tabs } from "../ui";

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
