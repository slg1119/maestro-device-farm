import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router";

import { getSettings } from "../../lib/settings";
import { routes } from "../../router";
import { healthBody, mockApi } from "../../test/api";

test("renders six nav links and the overview at / and saves settings", async () => {
  mockApi({ "GET /api/v1/healthz": healthBody({ auth_required: true }), "GET /api/v1/devices": [] });
  const router = createMemoryRouter(routes, { initialEntries: ["/"] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  expect(router.state.location.pathname).toBe("/");
  expect(screen.getByRole("heading", { name: "개요" })).toBeInTheDocument();
  for (const label of ["개요", "기기", "실행", "에디터", "앱", "워크스페이스"]) {
    expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
  }
  expect(await screen.findByText("agent 응답 없음")).toBeInTheDocument();
  await userEvent.click(await screen.findByRole("button", { name: "토큰 설정 필요" }));
  const dialog = screen.getByRole("dialog", { name: "설정" });
  await userEvent.type(dialog.querySelector("input[type=password]")!, "farm_abc");
  await userEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(getSettings().token).toBe("farm_abc");
  expect(screen.getByRole("button", { name: "설정" })).toBeInTheDocument();
});


test("collapses to a persistent rail and forces a full-bleed rail on editor routes", async () => {
  mockApi({});
  const router = createMemoryRouter(routes, { initialEntries: ["/"] });
  const view = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "사이드바 접기" }));
  expect(localStorage.getItem("farm.sidebar")).toBe("collapsed");
  expect(screen.getByRole("button", { name: "사이드바 펼치기" })).toHaveAttribute("aria-expanded", "false");
  view.unmount();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/editor/example-app"] })} />
    </QueryClientProvider>,
  );
  expect(screen.getByRole("complementary", { name: "사이드바" })).toHaveClass("w-14");
  expect(screen.getByRole("main")).toHaveClass("p-0");
  expect(screen.queryByRole("button", { name: "사이드바 펼치기" })).not.toBeInTheDocument();
});

test("opens mobile navigation and closes it with Escape, returning focus", async () => {
  mockApi({});
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/"] })} />
    </QueryClientProvider>,
  );
  const trigger = screen.getByRole("button", { name: "메뉴 열기" });
  await userEvent.click(trigger);
  expect(screen.getByRole("dialog", { name: "메뉴" })).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "메뉴" })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});


test("opens settings from mobile navigation without stacking dialogs", async () => {
  mockApi({});
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/"] })} />
    </QueryClientProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));
  await userEvent.click(within(screen.getByRole("dialog", { name: "메뉴" })).getByRole("button", { name: "설정" }));
  expect(screen.queryByRole("dialog", { name: "메뉴" })).not.toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "설정" })).toBeInTheDocument();
});

test("switches the dashboard language and persists the choice", async () => {
  mockApi({ "GET /api/v1/healthz": healthBody(), "GET /api/v1/devices": [] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/"] })} />
    </QueryClientProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "영어로 전환" }));
  expect(localStorage.getItem("farm.language")).toBe("en");
  expect(screen.getByRole("link", { name: "Overview" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Overview" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Switch to Korean" }));
  expect(localStorage.getItem("farm.language")).toBe("ko");
  expect(screen.getByRole("link", { name: "개요" })).toBeInTheDocument();
});
