import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { ProgressBar, Tabs } from "../ui";

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
