import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router";

import { getSettings } from "../../lib/settings";
import { routes } from "../../router";
import { mockApi } from "../../test/api";

test("renders the nav, redirects / to devices and saves settings", async () => {
  mockApi({ "GET /api/v1/healthz": { status: "ok", agent: null, workspace_sync_errors: [], disk_free_bytes: 1 },
            "GET /api/v1/devices": [] });
  const router = createMemoryRouter(routes, { initialEntries: ["/"] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  expect(router.state.location.pathname).toBe("/devices");
  for (const label of ["기기", "실행", "새 실행", "앱", "워크스페이스"]) {
    expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
  }
  expect(await screen.findByText("agent 없음")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "토큰 설정 필요" }));
  const dialog = screen.getByRole("dialog", { name: "설정" });
  await userEvent.type(dialog.querySelector("input[type=password]")!, "farm_abc");
  await userEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(getSettings().token).toBe("farm_abc");
  expect(screen.getByRole("button", { name: "설정" })).toBeInTheDocument();
});
