import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";

import { keys } from "../../../api/queries";
import type { RunDetail } from "../../../api/types";
import { apiErrorResponse, mockApi } from "../../../test/api";
import { aiJob, device, runDetail, task, taskSteps, workspace } from "../../../test/fixtures";
import { renderPage } from "../../../test/render";
import { RunDetailPage } from "../RunDetailPage";

const sha = "a".repeat(40);
const aiStatus = { enabled: true, model: "gpt-6.1-sol", month: "2026-10", month_input_tokens: 0, month_output_tokens: 0, month_jobs: 0 };
const failedRun = (overrides: Partial<RunDetail> = {}) => runDetail({
  flow_source: "workspace", workspace_id: "ws1", commit_sha: sha, status: "failed",
  tasks: [task({ status: "failed", flows: ["flows/login.yaml"] })],
  ...overrides,
});
function mount(run = failedRun(), extra: Parameters<typeof mockApi>[0] = {}) {
  const api = mockApi({
    "GET /api/v1/runs/run1": run,
    "GET /api/v1/devices": [device()],
    "GET /api/v1/workspaces": [workspace()],
    "GET /api/v1/ai/status": aiStatus,
    "GET /api/v1/tasks/task1/steps": taskSteps(),
    "GET /api/v1/tasks/task1/artifacts": { task_id: "task1", attempt: 1, files: [] },
    ...extra,
  });
  return { ...api, ...renderPage(<RunDetailPage />, { path: "/runs/:runId", route: "/runs/run1" }) };
}

test.each([["다시 실행", false], ["실패만 다시 실행", true]] as const)("%s posts the exact re-run payload and navigates", async (name, failed_only) => {
  const { calls } = mount(failedRun(), { "POST /api/v1/runs/run1/rerun": { id: "new-run", url: "/runs/new-run" }, "GET /api/v1/runs/new-run": runDetail({ id: "new-run" }) });
  await userEvent.click(await screen.findByRole("button", { name }));
  await screen.findByText("Run new-run");
  expect(calls.find((call) => call.method === "POST")).toMatchObject({ path: "/api/v1/runs/run1/rerun", body: { failed_only } });
});

test("hides failed-only re-run for successful runs and surfaces re-run errors", async () => {
  mount(runDetail(), { "POST /api/v1/runs/run1/rerun": apiErrorResponse(409, "snapshot_purged", "실행 스냅샷이 없습니다.") });
  await screen.findByRole("button", { name: "다시 실행" });
  expect(screen.queryByRole("button", { name: "실패만 다시 실행" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "다시 실행" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("실행 스냅샷이 없습니다.");
});

test("steps show labels, duration, depth and expandable failed and warned artifacts", async () => {
  mount(failedRun(), {
    "GET /api/v1/tasks/task1/steps": taskSteps({ flows: [{ flow: "login", steps: [
      { seq: 0, command: "launchApp", label: "launchApp com.example.app", status: "passed", duration_ms: 779, depth: 0, screenshot: null, hierarchy: null },
      { seq: 1, command: "tapOn", label: "tapOn 로그인", status: "failed", duration_ms: 1200, depth: 2, screenshot: "screens/shot 1.png", hierarchy: "hierarchy/step 1.json" },
      { seq: 2, command: "tapOn", label: "tapOn optional", status: "warned", duration_ms: 20, depth: 1, screenshot: null, hierarchy: null },
    ] }] }),
  });
  expect(await screen.findByRole("tab", { name: "단계" })).toHaveAttribute("aria-selected", "true");
  expect(await screen.findByText("launchApp com.example.app")).toBeInTheDocument();
  const failed = screen.getByRole("button", { name: /tapOn 로그인/ });
  expect(failed).toHaveStyle({ paddingLeft: "40px" });
  expect(failed).toHaveTextContent("1.2초");
  expect(failed).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("img", { name: "tapOn 로그인 스크린샷" })).toHaveAttribute("src", "/api/v1/tasks/task1/artifacts/screens/shot%201.png");
  expect(screen.getByRole("link", { name: "화면 계층 보기" })).toHaveAttribute("href", "/api/v1/tasks/task1/artifacts/hierarchy/step%201.json");
  expect(screen.getByRole("button", { name: /tapOn optional/ })).toHaveTextContent("경고");
  await userEvent.click(failed);
  expect(screen.queryByRole("img", { name: "tapOn 로그인 스크린샷" })).not.toBeInTheDocument();
});

test.each([
  ["passed", "workspace", true, false], ["failed", "upload", true, false],
  ["failed", "workspace", false, false], ["failed", "workspace", true, true],
  ["error", "draft", true, true],
] as const)("AI fix visibility: task %s, source %s, AI %s", async (status, flow_source, enabled, visible) => {
  mount(failedRun({ flow_source, tasks: [task({ status })] }), { "GET /api/v1/ai/status": { ...aiStatus, enabled } });
  if (status === "passed") await userEvent.click((await screen.findAllByRole("row"))[1]!);
  await screen.findByRole("heading", { name: /task1/ });
  await waitFor(() => expect(screen.queryByRole("button", { name: "AI 수정 제안" }) !== null).toBe(visible));
});

test("AI fix progresses from create to running to success, diffs original files and links the editor", async () => {
  const running = aiJob({ kind: "fix", status: "running", source_task_id: "task1" });
  let current = running;
  const { calls, client } = mount(failedRun(), {
    "POST /api/v1/ai/jobs": running,
    "GET /api/v1/ai/jobs/ai1": () => current,
    "GET /api/v1/workspaces/ws1/files/flows/login.yaml": () => new Response("appId: com.example.app\n- tapOn: Old\n"),
  });
  const editor = await screen.findByRole("link", { name: "에디터에서 열기" });
  const href = new URL(editor.getAttribute("href")!, "http://farm.test");
  expect(href.pathname).toBe("/editor/ws1");
  expect(href.searchParams.get("base")).toBe(sha);
  expect(href.searchParams.get("file")).toBe("flows/login.yaml");
  await userEvent.click(await screen.findByRole("button", { name: "AI 수정 제안" }));
  expect(await screen.findByText("AI 수정안을 만들고 있습니다.")).toBeInTheDocument();
  expect(calls.find((call) => call.method === "POST")).toMatchObject({ body: { kind: "fix", source_task_id: "task1" } });
  current = aiJob({ ...running, status: "succeeded", result: {
    files: [{ path: "flows/login.yaml", content: "appId: com.example.app\n- tapOn: New\n" }],
    summary: "로그인 선택자를 수정했습니다.", assumptions: ["로그인 버튼 문구가 변경되었습니다."], passed_run_id: null,
  } });
  await act(() => client.invalidateQueries({ queryKey: keys.aiJob("ai1") }));
  expect(await screen.findByText("로그인 선택자를 수정했습니다.")).toBeInTheDocument();
  expect(screen.getByText("로그인 버튼 문구가 변경되었습니다.")).toBeInTheDocument();
  expect(await screen.findByText("- - tapOn: Old")).toHaveClass("text-failed-fg");
  expect(screen.getByText("+ - tapOn: New")).toHaveClass("text-passed-fg");
  const diff = screen.getByRole("region", { name: "flows/login.yaml 변경 내용" });
  expect(within(diff).getByText("appId: com.example.app")).toBeInTheDocument();
  const original = calls.find((call) => call.path.includes("/files/"));
  expect(original?.search.get("ref")).toBe(sha);
  const jobLink = screen.getByRole("link", { name: "AI 수정안을 에디터에서 열기" });
  const jobUrl = new URL(jobLink.getAttribute("href")!, "http://farm.test");
  expect(jobUrl.pathname).toBe("/editor/ws1");
  expect(jobUrl.searchParams.get("base")).toBe(sha);
  expect(jobUrl.searchParams.get("aiJob")).toBe("ai1");
});

test("shows AI job failure without an editor apply link", async () => {
  mount(failedRun(), { "POST /api/v1/ai/jobs": aiJob({ kind: "fix", status: "failed", error_message: "수정안을 생성할 수 없습니다." }),
    "GET /api/v1/ai/jobs/ai1": aiJob({ status: "failed", error_message: "수정안을 생성할 수 없습니다." }) });
  await userEvent.click(await screen.findByRole("button", { name: "AI 수정 제안" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("수정안을 생성할 수 없습니다.");
  expect(screen.queryByRole("link", { name: "AI 수정안을 에디터에서 열기" })).not.toBeInTheDocument();
});

test("matrix selects one flow cell per device and opens that flow's committed file", async () => {
  mount(failedRun({ mode: "matrix", tasks: [task({ status: "failed", flows: ["flows/login.yaml", "flows/payment.yaml"] })], results: [
    { task_id: "task1", device_serial: "emulator-5554", flow_name: "login", status: "failed", duration_ms: 1, failure_message: "로그인 실패" },
    { task_id: "task1", device_serial: "emulator-5554", flow_name: "payment", status: "passed", duration_ms: 1, failure_message: null },
  ] }));
  await userEvent.click(await screen.findByRole("button", { name: /payment.*emulator-5554/ }));
  expect(screen.getByRole("button", { name: /payment.*emulator-5554/ })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: /login.*emulator-5554/ })).toHaveAttribute("aria-pressed", "false");
  expect(new URL(screen.getByRole("link", { name: "에디터에서 열기" }).getAttribute("href")!, "http://farm.test").searchParams.get("file")).toBe("flows/payment.yaml");
});

test("disables re-run and AI writes when the server requires a missing token", async () => {
  mount(failedRun(), { "GET /api/v1/healthz": { status: "ok", agent: null, auth_required: true, workspace_sync_errors: [], disk_free_bytes: 1 } });
  await screen.findByText("쓰기 작업에는 API 토큰이 필요합니다.");
  expect(screen.getByRole("button", { name: "다시 실행" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "실패만 다시 실행" })).toBeDisabled();
  expect(await screen.findByRole("button", { name: "AI 수정 제안" })).toBeDisabled();
});
