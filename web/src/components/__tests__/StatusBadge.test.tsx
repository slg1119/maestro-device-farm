import { render, screen } from "@testing-library/react";

import { DeviceStateBadge, StatusBadge } from "../StatusBadge";

test("run and device status combine a Korean label with a dot", () => {
  render(<><StatusBadge status="error" /><DeviceStateBadge state="reserved" /></>);
  for (const label of ["오류", "예약됨"]) {
    expect(screen.getByText(label).querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  }
});
