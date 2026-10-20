import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation, useNavigate } from "react-router";

import type { RunSummary } from "../../../api/types";
import { formatTime } from "../../../lib/format";
import { apiErrorResponse, jsonResponse, mockApi, type MockRequest } from "../../../test/api";
import { runSummary, workspace } from "../../../test/fixtures";
import { renderPage } from "../../../test/render";
import { RunsPage } from "../RunsPage";

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="현재 주소">{location.pathname}{location.search}</output>
      <button onClick={() => navigate(-1)}>이전 화면</button>
    </>
  );
}

function renderRuns(route = "/runs") {
  return renderPage(<><RunsPage /><LocationProbe /></>, { route, path: "/runs" });
}

function runCalls(calls: MockRequest[]) {
  return calls.filter((call) => call.path === "/api/v1/runs");
}

test("renders each run's status, source, app, duration, author and CI links", async () => {
  const runs = [
    runSummary({
      id: "workspace-run-12345678", status: "failed", flow_source: "workspace", workspace_id: "ws1",
      commit_sha: "abcdef1234567890", created_by: "build-bot", mode: "matrix",
      ci_meta: { branch: "feature/runs", pr_url: "https://github.com/example-org/example-app/pull/1" },
    }),
    runSummary({ id: "draft-run-23456789", status: "running", origin: "editor", flow_source: "draft", workspace_id: "ws1", commit_sha: "abcdef1234567890" }),
    runSummary({ id: "upload-run-34567890", origin: "dashboard" }),
    runSummary({ id: "missing-ws-45678901", status: "queued", origin: "ai", flow_source: "workspace", workspace_id: "deleted-ws", commit_sha: null }),
  ];
  mockApi({ "GET /api/v1/runs": jsonResponse(200, runs), "GET /api/v1/workspaces": [workspace()] });
  renderRuns();

  const link = await screen.findByRole("link", { name: "12345678" });
  expect(link).toHaveAttribute("href", "/runs/workspace-run-12345678");
  expect(screen.getAllByRole("row")).toHaveLength(5);
  const row = within(link.closest("tr")!);
  for (const text of ["실패", "CI", "matrix", "example-app @ abcdef1", "com.example.app 1.0", "2m 0s", "build-bot", "feature/runs"]) {
    expect(row.getByText(text)).toBeInTheDocument();
  }
  expect(row.getByTitle(formatTime(runs[0]!.created_at))).toBeInTheDocument();
  expect(row.getByRole("link", { name: "PR" })).toHaveAttribute("href", runs[0]!.ci_meta.pr_url);
  expect(row.getByRole("link", { name: "PR" })).toHaveAttribute("target", "_blank");
  expect(row.getByRole("link", { name: "PR" })).toHaveAttribute("rel", expect.stringContaining("noopener"));
  expect(screen.getByText("example-app @ abcdef1 (초안)")).toBeInTheDocument();
  expect(screen.getByText("deleted-ws @ -")).toBeInTheDocument();
  for (const text of ["실행 중", "통과", "대기", "에디터", "대시보드", "AI", "업로드"]) {
    expect(screen.getByText(text, { selector: "td *" })).toBeInTheDocument();
  }
});

test("shows passed, failed and error counts in the results column", async () => {
  const run = runSummary();
  mockApi({
    "GET /api/v1/runs": [runSummary({ counts: { ...run.counts, total: 3, passed: 1, failed: 1, error: 1 } })],
    "GET /api/v1/workspaces": [],
  });
  renderRuns();
  expect(await screen.findByText("1/3 통과")).toBeInTheDocument();
  expect(screen.getByText("실패 1")).toHaveClass("text-red-600");
  expect(screen.getByText("오류 1")).toHaveClass("text-amber-600");
  expect(screen.queryByText("다음")).not.toBeInTheDocument();
});

test("omits zero failure and error counts", async () => {
  mockApi({ "GET /api/v1/runs": [runSummary()], "GET /api/v1/workspaces": [] });
  renderRuns();
  expect(await screen.findByText("2/2 통과")).toBeInTheDocument();
  expect(screen.queryByText("실패 0")).not.toBeInTheDocument();
  expect(screen.queryByText("오류 0")).not.toBeInTheDocument();
});

test("initializes all filters and the cursor from a shared URL with a fixed page size", async () => {
  const { calls } = mockApi({ "GET /api/v1/runs": [], "GET /api/v1/workspaces": [workspace()] });
  renderRuns("/runs?status=failed&origin=ci&workspace=example-app&before=older-run");
  await screen.findByRole("option", { name: "example-app" });
  expect(screen.getByRole("combobox", { name: "상태" })).toHaveValue("failed");
  expect(screen.getByRole("combobox", { name: "출처" })).toHaveValue("ci");
  expect(screen.getByRole("combobox", { name: "워크스페이스" })).toHaveValue("example-app");
  expect(Object.fromEntries(runCalls(calls)[0]!.search)).toEqual({ status: "failed", origin: "ci", workspace: "example-app", before: "older-run", limit: "50" });
});

test.each([
  { label: "상태", value: "failed", key: "status" },
  { label: "출처", value: "dashboard", key: "origin" },
  { label: "워크스페이스", value: "example-app", key: "workspace" },
])("changing $label updates its URL filter and clears before while preserving other params", async ({ label, value, key }) => {
  const { calls } = mockApi({ "GET /api/v1/runs": [], "GET /api/v1/workspaces": [workspace()] });
  renderRuns("/runs?status=running&origin=ci&workspace=other&before=older-run&view=compact");
  await screen.findByRole("option", { name: "example-app" });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: label }), value);
  const expected = { status: "running", origin: "ci", workspace: "other", [key]: value, limit: "50" };
  await waitFor(() => expect(Object.fromEntries(runCalls(calls).at(-1)!.search)).toEqual(expected));
  const search = new URLSearchParams(screen.getByLabelText("현재 주소").textContent!.split("?")[1]);
  expect(Object.fromEntries(search)).toEqual({ status: "running", origin: "ci", workspace: "other", [key]: value, view: "compact" });
});

test("selecting 전체 removes the filter and browser back restores it", async () => {
  const { calls } = mockApi({ "GET /api/v1/runs": [], "GET /api/v1/workspaces": [] });
  renderRuns("/runs?status=failed&before=older-run");
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "상태" }), "");
  await waitFor(() => expect(Object.fromEntries(runCalls(calls).at(-1)!.search)).toEqual({ limit: "50" }));
  expect(screen.getByLabelText("현재 주소")).toHaveTextContent(/^\/runs$/);
  await userEvent.click(screen.getByRole("button", { name: "이전 화면" }));
  await waitFor(() => expect(screen.getByRole("combobox", { name: "상태" })).toHaveValue("failed"));
  expect(screen.getByLabelText("현재 주소")).toHaveTextContent("before=older-run");
});

test("pages using the last row id and returns to the first page without losing filters", async () => {
  const runs = Array.from({ length: 50 }, (_, i) => runSummary({ id: `run-${String(i).padStart(8, "0")}` }));
  const { calls } = mockApi({
    "GET /api/v1/runs": (req: MockRequest) => req.search.has("before") ? [] : runs,
    "GET /api/v1/workspaces": [],
  });
  renderRuns("/runs?origin=ci");
  await userEvent.click(await screen.findByRole("button", { name: "다음" }));
  await waitFor(() => expect(Object.fromEntries(runCalls(calls).at(-1)!.search)).toEqual({ origin: "ci", limit: "50", before: "run-00000049" }));
  expect(await screen.findByText("실행 기록이 없습니다.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "다음" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "처음으로" }));
  await screen.findByRole("link", { name: "00000000" });
  expect(screen.getByLabelText("현재 주소")).toHaveTextContent(/^\/runs\?origin=ci$/);
  expect(screen.queryByRole("button", { name: "처음으로" })).not.toBeInTheDocument();
});

test("shows a loading state while runs are pending", () => {
  mockApi({ "GET /api/v1/runs": () => new Promise<RunSummary[]>(() => {}), "GET /api/v1/workspaces": [] });
  renderRuns();
  expect(screen.getByText("불러오는 중…")).toBeInTheDocument();
  expect(screen.queryByText("실행 기록이 없습니다.")).not.toBeInTheDocument();
});

test("shows an empty state for an empty response", async () => {
  mockApi({ "GET /api/v1/runs": [], "GET /api/v1/workspaces": [] });
  renderRuns();
  expect(await screen.findByText("실행 기록이 없습니다.")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

test("shows the API error instead of an empty state", async () => {
  mockApi({ "GET /api/v1/runs": apiErrorResponse(400, "invalid_cursor", "이전 실행을 찾을 수 없습니다."), "GET /api/v1/workspaces": [] });
  renderRuns("/runs?before=missing");
  expect(await screen.findByRole("alert")).toHaveTextContent("이전 실행을 찾을 수 없습니다. (invalid_cursor)");
  expect(screen.queryByText("실행 기록이 없습니다.")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "처음으로" })).toBeInTheDocument();
});

test("keeps runs readable using workspace ids when the workspace request fails", async () => {
  mockApi({
    "GET /api/v1/runs": [runSummary({ flow_source: "workspace", workspace_id: "ws1", commit_sha: "abcdef1234" })],
    "GET /api/v1/workspaces": apiErrorResponse(503, "unavailable", "워크스페이스를 불러오지 못했습니다."),
  });
  renderRuns();
  expect(await screen.findByText("ws1 @ abcdef1")).toBeInTheDocument();
  expect(await screen.findByRole("alert")).toHaveTextContent("워크스페이스를 불러오지 못했습니다.");
});

test("navigates to a new run and shows the token notice without a token", async () => {
  mockApi({ "GET /api/v1/runs": [], "GET /api/v1/workspaces": [] });
  renderRuns();
  expect(screen.getByRole("heading", { name: "실행" })).toBeInTheDocument();
  expect(screen.getByText("쓰기 작업에는 API 토큰이 필요합니다.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "새 실행" }));
  expect(await screen.findByTestId("navigated")).toBeInTheDocument();
});

test("navigates to the selected run's detail", async () => {
  mockApi({ "GET /api/v1/runs": [runSummary({ id: "run-12345678" })], "GET /api/v1/workspaces": [] });
  renderRuns();
  await userEvent.click(await screen.findByRole("link", { name: "12345678" }));
  expect(await screen.findByTestId("navigated")).toBeInTheDocument();
});
