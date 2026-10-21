import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { Device, RunSummary, Workspace } from "../../../api/types";
import { apiErrorResponse, mockApi } from "../../../test/api";
import { device, runSummary, workspace } from "../../../test/fixtures";
import { renderPage } from "../../../test/render";
import { OverviewPage } from "../OverviewPage";

const now = new Date(2026, 9, 21, 12, 0, 0);
const today = new Date(2026, 9, 21, 11, 0, 0).toISOString();
const yesterday = new Date(2026, 9, 20, 23, 59, 59).toISOString();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(now);
});
afterEach(() => vi.useRealTimers());

function setup({ devices = [], runs = [], workspaces = [] }: {
  devices?: Device[]; runs?: RunSummary[]; workspaces?: Workspace[];
} = {}) {
  const api = mockApi({
    "GET /api/v1/devices": devices,
    "GET /api/v1/runs": runs,
    "GET /api/v1/workspaces": workspaces,
  });
  renderPage(<OverviewPage />, { path: "/" });
  return api;
}

test("derives KPIs from today's created runs and loads the latest 100 summaries", async () => {
  const devices = ["available", "available", "busy", "reserved", "offline", "unhealthy", "disabled"].map((state, i) =>
    device({ serial: `device-${i}`, state: state as Device["state"] }));
  const active = runSummary({
    id: "run-running1", status: "running", created_at: today, finished_at: null,
    counts: { total: 8, passed: 2, failed: 1, error: 1, cancelled: 1, running: 1, queued: 2 },
  });
  const failed = runSummary({ id: "run-failed01", status: "failed", created_at: today, counts: { ...active.counts, failed: 3, queued: 0 } });
  const { calls } = setup({ devices, workspaces: [workspace()], runs: [
    active, failed,
    runSummary({ id: "run-passed01", created_at: today }),
    runSummary({ id: "run-queued01", status: "queued", created_at: today, finished_at: null, counts: { ...active.counts, failed: 0, queued: 4 } }),
    runSummary({ id: "run-old00001", status: "failed", created_at: yesterday, finished_at: today, counts: { ...active.counts, failed: 20, queued: 0 } }),
  ] });

  expect(await screen.findByText("2 / 7")).toBeInTheDocument();
  expect(screen.getByLabelText("진행 중인 실행 수")).toHaveTextContent("1");
  expect(screen.getByText("대기 중인 task 6개")).toBeInTheDocument();
  expect(screen.getByLabelText("오늘 통과율")).toHaveTextContent("50%");
  expect(screen.getByText("완료된 run 2개 중 1개 통과")).toBeInTheDocument();
  expect(screen.getByLabelText("오늘 실패한 flow 수")).toHaveTextContent("4");
  expect(screen.getByText("실패한 run 1개")).toBeInTheDocument();
  const bar = screen.getByRole("progressbar", { name: "기기 상태: 사용 가능 2대 · 사용 중·예약 2대 · 사용 불가 3대" });
  expect([...bar.children].map((node) => (node as HTMLElement).style.width)).toEqual([
    `${2 / 7 * 100}%`, `${2 / 7 * 100}%`, `${3 / 7 * 100}%`,
  ]);
  expect(calls.find((call) => call.path === "/api/v1/runs")?.search.get("limit")).toBe("100");
  const date = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" }).format(now);
  expect(screen.getByText(`${date} · 기기 7대 · 워크스페이스 1개`)).toBeInTheDocument();
});

test("uses an em dash when no runs created today have finished", async () => {
  setup({ runs: [
    runSummary({ created_at: yesterday, finished_at: today }),
    runSummary({ id: "run-active01", status: "running", created_at: today, finished_at: null }),
  ] });
  expect(await screen.findByText("완료된 run 0개 중 0개 통과")).toBeInTheDocument();
  expect(screen.getByLabelText("오늘 통과율")).toHaveTextContent("—");
});

test("includes error and cancelled terminal runs in the finished-run denominator", async () => {
  setup({ runs: ["passed", "failed", "error", "cancelled"].map((status, i) => runSummary({
    id: `run-${i}`, status: status as RunSummary["status"], created_at: today,
  })) });
  expect(await screen.findByText("완료된 run 4개 중 1개 통과")).toBeInTheDocument();
  expect(screen.getByLabelText("오늘 통과율")).toHaveTextContent("25%");
  expect(screen.getByText("실패한 run 2개")).toBeInTheDocument();
});

test("shows active runs with sources, all count segments, queued state and live elapsed time", async () => {
  setup({ workspaces: [workspace()], runs: [
    runSummary({
      id: "active-run-12345678", status: "running", origin: "editor", flow_source: "draft", workspace_id: "ws1",
      commit_sha: "abcdef1234", started_at: new Date(now.getTime() - 10_000).toISOString(), finished_at: null,
      counts: { total: 8, passed: 2, failed: 1, error: 1, cancelled: 1, running: 1, queued: 2 },
    }),
    runSummary({ id: "queued-run-87654321", status: "queued", started_at: null, finished_at: null }),
  ] });
  const section = within(screen.getByRole("region", { name: "진행 중인 실행" }));
  expect(await section.findByRole("link", { name: "12345678" })).toHaveAttribute("href", "/runs/active-run-12345678");
  expect(section.getByText("에디터")).toBeInTheDocument();
  expect(section.getByText("example-app @ abcdef1 (초안)")).toBeInTheDocument();
  expect(section.getByText("2 통과 · 1 실패 · 1 실행 중 · 2 대기")).toBeInTheDocument();
  expect(section.getByText("1 오류 · 1 취소")).toBeInTheDocument();
  const bar = section.getByRole("progressbar", { name: /12345678/ });
  expect([...bar.children].map((node) => (node as HTMLElement).style.width)).toEqual(["25%", "12.5%", "12.5%", "12.5%", "25%", "12.5%"]);
  expect(section.getByText("10s 경과")).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(1_000));
  expect(section.getByText("11s 경과")).toBeInTheDocument();
  expect(section.getByText("대기")).toBeInTheDocument();
  expect(section.getByText("실행 대기 중")).toBeInTheDocument();
});

test("links only the five most recent failed or error runs, ordered by creation time", async () => {
  setup({ runs: [
    ...Array.from({ length: 6 }, (_, i) => runSummary({
      id: `failed-run-0000000${i}`, status: i === 5 ? "error" : "failed",
      created_at: new Date(now.getTime() - (6 - i) * 60_000).toISOString(),
      counts: { total: 3, failed: 2, error: 1, passed: 0, queued: 0, running: 0, cancelled: 0 },
    })),
    runSummary({ id: "passed-run-99999999", created_at: now.toISOString() }),
  ] });
  const section = within(screen.getByRole("region", { name: "최근 실패" }));
  await section.findByRole("link", { name: "00000005" });
  const links = section.getAllByRole("link").filter((link) => link.getAttribute("href")?.startsWith("/runs/"));
  expect(links.map((link) => link.getAttribute("href"))).toEqual([5, 4, 3, 2, 1].map((i) => `/runs/failed-run-0000000${i}`));
  expect(section.queryByText("00000000")).not.toBeInTheDocument();
  expect(section.getAllByText("실패 2 · 오류 1")).toHaveLength(5);
});

test("shows current run, reservation holder and battery device details", async () => {
  setup({ devices: [
    device({ serial: "busy", model: "Busy phone", state: "busy", current_run_id: "run-12345678" }),
    device({ serial: "reserved", model: "Reserved phone", state: "reserved", reservation: {
      id: "res1", device_serial: "reserved", holder_name: "테스터", status: "active", created_at: today, expires_at: today, released_at: null,
    } }),
    device({ serial: "available", model: "Available phone", battery: 12 }),
    device({ serial: "offline", model: "Offline phone", state: "offline", battery: null }),
  ] });
  const section = within(screen.getByRole("region", { name: "기기" }));
  expect(await section.findByRole("link", { name: "실행 12345678" })).toHaveAttribute("href", "/runs/run-12345678");
  expect(section.getByText("테스터 예약 중")).toBeInTheDocument();
  expect(section.getByText("배터리 12%")).toHaveClass("text-warning-fg");
  expect(section.getByText("배터리 정보 없음")).toBeInTheDocument();
  for (const state of ["실행 중", "예약됨", "사용 가능", "오프라인"]) expect(section.getByText(state)).toBeInTheDocument();
});

test("shows workspace sync status, repository, branch, head and sync errors", async () => {
  setup({ workspaces: [
    workspace({ synced_at: today }),
    workspace({ id: "ws2", name: "sync-broken", sync_error: "저장소에 연결할 수 없습니다." }),
    workspace({ id: "ws3", name: "sync-pending", synced_at: null, head_sha: null }),
  ] });
  const section = within(screen.getByRole("region", { name: "워크스페이스" }));
  expect(await section.findByText("동기화됨 · 1시간 전")).toBeInTheDocument();
  expect(section.getAllByText("example-org/example-app · main · aaaaaaa")).toHaveLength(2);
  expect(section.getByRole("alert")).toHaveTextContent("저장소에 연결할 수 없습니다.");
  expect(section.getByRole("alert")).toHaveClass("bg-failed-bg", "text-failed-fg");
  expect(section.getByText("아직 동기화되지 않음")).toBeInTheDocument();
});

test("gives every card its own loading and empty states", async () => {
  let resolveDevices!: (value: Device[]) => void;
  let resolveRuns!: (value: RunSummary[]) => void;
  let resolveWorkspaces!: (value: Workspace[]) => void;
  mockApi({
    "GET /api/v1/devices": () => new Promise<Device[]>((resolve) => { resolveDevices = resolve; }),
    "GET /api/v1/runs": () => new Promise<RunSummary[]>((resolve) => { resolveRuns = resolve; }),
    "GET /api/v1/workspaces": () => new Promise<Workspace[]>((resolve) => { resolveWorkspaces = resolve; }),
  });
  renderPage(<OverviewPage />);
  for (const title of ["진행 중인 실행", "최근 실패", "기기", "워크스페이스"]) {
    expect(within(screen.getByRole("region", { name: title })).getByRole("status")).toHaveTextContent("불러오는 중");
  }
  expect(screen.queryByText("0 / 0")).not.toBeInTheDocument();
  await act(async () => { resolveDevices([]); resolveRuns([]); resolveWorkspaces([]); });
  for (const text of ["진행 중인 실행이 없습니다.", "최근 실패한 실행이 없습니다.", "연결된 기기가 없습니다.", "등록된 워크스페이스가 없습니다."]) {
    expect(await screen.findByText(text)).toBeInTheDocument();
  }
  expect(screen.getByText("0 / 0")).toBeInTheDocument();
});

test("keeps successful cards readable when a separate request fails", async () => {
  mockApi({
    "GET /api/v1/devices": apiErrorResponse(503, "unavailable", "기기를 불러오지 못했습니다."),
    "GET /api/v1/runs": [runSummary({ id: "run-12345678", status: "running", finished_at: null, flow_source: "workspace", workspace_id: "removed-ws" })],
    "GET /api/v1/workspaces": [],
  });
  renderPage(<OverviewPage />);
  expect(await screen.findByText("removed-ws @ -")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "기기" })).getByRole("alert")).toHaveTextContent("기기를 불러오지 못했습니다.");
  expect(screen.queryByText("0 / 0")).not.toBeInTheDocument();
});

test.each([
  ["에디터 열기", "/editor"], ["새 실행", "/runs/new"],
])("%s navigates to %s", async (name, destination) => {
  setup();
  const action = screen.getByRole("link", { name });
  expect(action).toHaveAttribute("href", destination);
  await userEvent.click(action);
  expect(await screen.findByTestId("navigated")).toBeInTheDocument();
});
