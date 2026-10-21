import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { keys } from "../../../../api/queries";
import type { AiJob, AiStatus } from "../../../../api/types";
import { saveSettings } from "../../../../lib/settings";
import { apiErrorResponse, mockApi } from "../../../../test/api";
import { aiJob, device, workspace } from "../../../../test/fixtures";
import { renderPage } from "../../../../test/render";
import { EditorProvider, useEditor, type EditorApi } from "../../../store";
import { AiPanel } from "../../AiPanel";

vi.mock("../../../monacoSetup", () => ({ ensureMonaco: async () => ({}) }));
vi.mock("@monaco-editor/react", () => ({
  default: ({ value, options, theme }: { value: string; options: { readOnly: boolean }; theme: string }) => <textarea aria-label="AI 제안 코드" value={value} readOnly={options.readOnly} data-theme={theme} />,
  DiffEditor: ({ original, modified, options }: { original: string; modified: string; options: { readOnly: boolean } }) => <div data-testid="ai-diff" data-readonly={options.readOnly}><pre data-testid="original">{original}</pre><pre data-testid="modified">{modified}</pre></div>,
}));

const ws = workspace();
const reservation = { id: "res1", device_serial: "d1", holder_name: "테스터", status: "active", created_at: "2026-10-21", expires_at: "2026-10-22", released_at: null };
const status: AiStatus & { max_repairs: number } = { enabled: true, model: "gpt-6.1-sol", month: "2026-10", month_input_tokens: 12_000, month_output_tokens: 3_000, month_jobs: 2, max_repairs: 5 };
let editor: EditorApi;
function Probe() { editor = useEditor(); return <AiPanel />; }
function setup({ job = aiJob(), route = "/editor/example-app", enabled = true, routes = {} }: { job?: AiJob; route?: string; enabled?: boolean; routes?: Parameters<typeof mockApi>[0] } = {}) {
  const mock = mockApi({
    "GET /api/v1/ai/status": { ...status, enabled },
    "GET /api/v1/ai/jobs": [job],
    [`GET /api/v1/ai/jobs/${job.id}`]: job,
    "POST /api/v1/ai/jobs": job,
    [`POST /api/v1/ai/jobs/${job.id}/cancel`]: { ...job, status: "cancelled" },
    "GET /api/v1/devices": [device({ serial: "d1", model: "Pixel 7" })],
    "GET /api/v1/workspaces/ws1/tree": { sha: ws.head_sha, files: [{ path: "flows/login.yaml", size: 12 }, { path: "flows/other.yaml", size: 12 }] },
    "GET /api/v1/workspaces/ws1/files/flows/login.yaml": () => new Response("- launchApp\n- back\n"),
    "GET /api/v1/workspaces/ws1/files/flows/other.yaml": () => new Response("- back\n"),
    "POST /api/v1/workspaces/ws1/validate": { valid: true, issues: [] },
    "POST /api/v1/devices/d1/reservations": reservation,
    "DELETE /api/v1/reservations/res1": { ...reservation, status: "released" },
    ...routes,
  });
  const view = renderPage(<EditorProvider workspace={ws}><Probe /></EditorProvider>, { route });
  return { ...view, ...mock, user: userEvent.setup() };
}
const resultJob = () => aiJob({ status: "succeeded", result: { summary: "로그인 단계를 보완했습니다", assumptions: ["테스트 계정이 준비되어 있습니다"], files: [{ path: "flows/login.yaml", content: "- launchApp\n- scroll\n" }, { path: "flows/new.yaml", content: "- back\n" }], passed_run_id: "run1" } });

test("submits generation with drafts, reservation, selected app and author using the server contract", async () => {
  saveSettings({ token: "", authorName: "테스터", authorEmail: "test@example.com" });
  const view = setup();
  await screen.findByText(/이번 달 15K 토큰/);
  await act(async () => { await editor.reserve("d1"); });
  act(() => editor.setContent("flows/login.yaml", "- scroll"));
  await view.user.clear(screen.getByLabelText("대상 경로"));
  await view.user.type(screen.getByLabelText("대상 경로"), "flows/booking.yaml");
  await view.user.type(screen.getByLabelText("설명"), "예약 플로우를 만들어 주세요");
  await view.user.click(screen.getByRole("checkbox", { name: /현재 화면 포함.*Pixel 7/ }));
  await view.user.click(screen.getByRole("checkbox", { name: /자동 보정/ }));
  expect(screen.getByText(/최대 5회/)).toBeInTheDocument();
  await view.user.click(screen.getByRole("button", { name: "생성" }));
  await waitFor(() => expect(view.calls.find(c => c.method === "POST" && c.path === "/api/v1/ai/jobs")?.body).toEqual({
    kind: "generate", workspace: "example-app", base_sha: ws.head_sha, prompt: "예약 플로우를 만들어 주세요", target_path: "flows/booking.yaml",
    draft_changes: [{ op: "put", path: "flows/login.yaml", content: "- scroll", encoding: "utf-8" }],
    include_screen: true, auto_repair: true, reservation_id: "res1", app: "com.example.app@latest", author_name: "테스터",
  }));
});

test("current-file mode submits generate for the active file with a read-only target and explicit build", async () => {
  const view = setup(); await screen.findByLabelText("설명");
  act(() => { editor.openFile("flows/login.yaml"); editor.setAppChoice({ app_build_id: "build1" }); });
  await view.user.click(screen.getByRole("radio", { name: "현재 파일 고치기" }));
  expect(screen.getByLabelText("대상 경로")).toHaveValue("flows/login.yaml");
  expect(screen.getByLabelText("대상 경로")).toHaveAttribute("readonly");
  await view.user.type(screen.getByLabelText("설명"), "스크롤을 추가하세요");
  await view.user.click(screen.getByRole("button", { name: "생성" }));
  await waitFor(() => expect(view.calls.find(c => c.method === "POST" && c.path === "/api/v1/ai/jobs")?.body).toMatchObject({ kind: "generate", target_path: "flows/login.yaml", app_build_id: "build1", include_screen: false, auto_repair: false, reservation_id: null }));
  expect(view.calls.find(c => c.method === "POST" && c.path === "/api/v1/ai/jobs")?.body).not.toHaveProperty("source_task_id");
});

test("gates options by reservation/app and clears options when their prerequisites disappear", async () => {
  const view = setup(); await screen.findByLabelText("설명");
  expect(screen.getByRole("checkbox", { name: /현재 화면 포함/ })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: /자동 보정/ })).toBeDisabled();
  expect(screen.getByRole("radio", { name: "현재 파일 고치기" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "생성" })).toBeDisabled();
  await act(async () => { await editor.reserve("d1"); });
  await view.user.click(screen.getByRole("checkbox", { name: /현재 화면 포함/ }));
  await view.user.click(screen.getByRole("checkbox", { name: /자동 보정/ }));
  act(() => editor.setAppChoice({}));
  expect(screen.getByRole("checkbox", { name: /자동 보정/ })).toBeDisabled();
  expect(screen.getByRole("checkbox", { name: /자동 보정/ })).not.toBeChecked();
  await act(async () => { await editor.release(); });
  expect(screen.getByRole("checkbox", { name: /현재 화면 포함/ })).not.toBeChecked();
});

test("rejects blank descriptions and paths outside the workspace", async () => {
  const view = setup(); await screen.findByLabelText("설명");
  await view.user.type(screen.getByLabelText("설명"), "   ");
  expect(screen.getByRole("button", { name: "생성" })).toBeDisabled();
  await view.user.type(screen.getByLabelText("설명"), "플로우");
  await view.user.clear(screen.getByLabelText("대상 경로"));
  await view.user.type(screen.getByLabelText("대상 경로"), "../unsafe.yaml");
  expect(screen.getByRole("button", { name: "생성" })).toBeDisabled();
});

test("renders all attempt kinds, tokens, issues, failures and run links and refreshes on invalidation", async () => {
  let job = aiJob({ status: "running", attempts: [
    { n: 1, kind: "generate", status: "ok", detail: "", run_id: null, issues: [], input_tokens: 1000, output_tokens: 200 },
    { n: 1, kind: "validation", status: "failed", detail: "", run_id: null, issues: [{ path: "flows/login.yaml", message: "Invalid Command: tapO", line: 3, column: 1 }], input_tokens: 0, output_tokens: 0 },
    { n: 2, kind: "validation", status: "ok", detail: "", run_id: null, issues: [], input_tokens: 0, output_tokens: 0 },
    { n: 2, kind: "run", status: "failed", detail: "요소를 찾지 못했습니다", run_id: "run1", issues: [], input_tokens: 0, output_tokens: 0 },
  ] });
  const view = setup({ job, route: "/editor/example-app?aiJob=ai1", routes: { "GET /api/v1/ai/jobs/ai1": () => job } });
  await screen.findByText("변경안 생성");
  expect(screen.getByText("문법 검사 실패 → 다시 요청")).toBeInTheDocument();
  expect(screen.getByText("문법 검사 통과")).toBeInTheDocument();
  expect(screen.getByText(/입력 1,000.*출력 200/)).toBeInTheDocument();
  expect(screen.getByText(/Invalid Command: tapO/)).toBeInTheDocument();
  expect(screen.getByText(/실행 2\/6.*예약 기기.*실패/)).toBeInTheDocument();
  expect(screen.getByText("요소를 찾지 못했습니다")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /실행 보기/ })).toHaveAttribute("href", "/runs/run1");
  job = { ...job, status: "failed", error_message: "reservation ended" };
  await act(async () => { await view.client.invalidateQueries({ queryKey: keys.aiJob("ai1") }); });
  await screen.findByRole("alert"); expect(screen.getByRole("alert")).toHaveTextContent("reservation ended");
});

test("query-param result stays read-only until selected files are applied to the real store", async () => {
  const view = setup({ job: resultJob(), route: "/editor/example-app?aiJob=ai1" });
  await screen.findByText("로그인 단계를 보완했습니다");
  expect(screen.getByText("테스트 계정이 준비되어 있습니다")).toBeInTheDocument();
  expect(await screen.findAllByRole("tab", { name: /AI 제안 · 반영 전/ })).toHaveLength(2);
  expect(await screen.findByLabelText("AI 제안 코드")).toHaveAttribute("readonly");
  expect(editor.changes()).toEqual([]);
  await screen.findByLabelText("flows/login.yaml 추가 1줄 삭제 1줄");
  act(() => editor.setContent("flows/login.yaml", "- launchApp\n- swipe\n"));
  await view.user.click(screen.getByRole("button", { name: "flows/login.yaml diff" }));
  const dialog = await screen.findByRole("dialog", { name: /diff/ });
  expect(within(dialog).getByTestId("original")).toHaveTextContent("- swipe");
  expect(within(dialog).getByTestId("modified")).toHaveTextContent("- scroll");
  expect(within(dialog).getByTestId("ai-diff")).toHaveAttribute("data-readonly", "true");
  await view.user.click(within(dialog).getByRole("button", { name: "닫기" }));
  await view.user.click(screen.getByRole("checkbox", { name: "flows/login.yaml 반영" }));
  await view.user.click(screen.getByRole("button", { name: "선택한 파일을 에디터에 반영" }));
  expect(editor.drafts["flows/login.yaml"]?.content).toContain("- swipe");
  expect(editor.drafts["flows/new.yaml"]?.content).toBe("- back\n");
  expect(editor.activePath).toBe("flows/new.yaml");
  expect(screen.queryByRole("tab", { name: /AI 제안 · 반영 전/ })).not.toBeInTheDocument();
  expect(view.calls.some(c => c.path.endsWith("/commits"))).toBe(false);
});

test.each([
  ["queued", "ok", "대기"],
  ["running", "ok", "실행 중"],
  ["passed", "ok", "통과"],
  ["error", "failed", "오류"],
  ["cancelled", "failed", "취소"],
] as const)("shows the actual %s run state from the server detail field", async (detail, status, label) => {
  setup({ job: aiJob({ status: "running", attempts: [
    { n: 1, kind: "run", status, detail, run_id: "run1", issues: [], input_tokens: 0, output_tokens: 0 },
  ] }), route: "/editor/example-app?aiJob=ai1" });
  const list = await screen.findByRole("list", { name: "AI 시도 이력" });
  expect(within(list).getByText(`실행 1/6 · 예약 기기 · ${label}`)).toBeInTheDocument();
});

test("zero repairs still allows the initial run and displays its total correctly", async () => {
  setup({ job: aiJob({ status: "running", attempts: [
    { n: 1, kind: "run", status: "ok", detail: "running", run_id: "run1", issues: [], input_tokens: 0, output_tokens: 0 },
  ] }), route: "/editor/example-app?aiJob=ai1", routes: { "GET /api/v1/ai/status": { ...status, max_repairs: 0 } } });
  expect(await screen.findByText("실행 1/1 · 예약 기기 · 실행 중")).toBeInTheDocument();
  expect(screen.getByText(/최대 0회/)).toBeInTheDocument();
});

test("does not pretend a failed original read is an empty file in the diff", async () => {
  const view = setup({ job: resultJob(), route: "/editor/example-app?aiJob=ai1", routes: { "GET /api/v1/workspaces/ws1/files/flows/login.yaml": apiErrorResponse(500, "read_failed", "원본 읽기 실패") } });
  await view.user.click(await screen.findByRole("button", { name: "flows/login.yaml diff" }));
  const dialog = screen.getByRole("dialog", { name: /diff/ });
  await within(dialog).findByRole("alert");
  expect(within(dialog).queryByTestId("ai-diff")).not.toBeInTheDocument();
});

test("older server statuses fall back to the documented three repairs", async () => {
  setup({ routes: { "GET /api/v1/ai/status": { ...status, max_repairs: undefined } } });
  await screen.findByText(/최대 3회/);
});

test("discarding a result makes no drafts and a new history selection resets the file checklist", async () => {
  const view = setup({ job: resultJob(), route: "/editor/example-app?aiJob=ai1" });
  await screen.findByText("로그인 단계를 보완했습니다");
  await view.user.click(screen.getByRole("button", { name: "버리기" }));
  expect(editor.changes()).toEqual([]);
  expect(screen.queryByText("로그인 단계를 보완했습니다")).not.toBeInTheDocument();
  await view.user.click(screen.getByRole("button", { name: "지난 작업" }));
  await view.user.click(screen.getByRole("menuitem", { name: /로그인 플로우 작성/ }));
  await screen.findByText("로그인 단계를 보완했습니다");
  expect(screen.getByRole("checkbox", { name: "flows/login.yaml 반영" })).toBeChecked();
});

test("cancels a running job and stops showing cancel after the returned state is terminal", async () => {
  const view = setup({ job: aiJob({ status: "running" }), route: "/editor/example-app?aiJob=ai1" });
  await view.user.click(await screen.findByRole("button", { name: "취소" }));
  await waitFor(() => expect(view.calls.some(c => c.method === "POST" && c.path === "/api/v1/ai/jobs/ai1/cancel")).toBe(true));
  await screen.findByText("취소됨");
  expect(screen.queryByRole("button", { name: "취소" })).not.toBeInTheDocument();
});

test("keeps failed submits inline and preserves entered text for a retry", async () => {
  const view = setup({ routes: { "POST /api/v1/ai/jobs": apiErrorResponse(503, "ai_disabled", "AI가 비활성화되었습니다") } });
  await view.user.type(await screen.findByLabelText("설명"), "로그인 확인");
  await view.user.click(screen.getByRole("button", { name: "생성" }));
  await screen.findByRole("alert"); expect(screen.getByRole("alert")).toHaveTextContent("ai_disabled");
  expect(screen.getByLabelText("설명")).toHaveValue("로그인 확인");
});

test("hides disabled AI entirely and never requests jobs", async () => {
  const view = setup({ enabled: false }); await waitFor(() => expect(view.calls.some(c => c.path === "/api/v1/ai/status")).toBe(true));
  expect(screen.queryByLabelText("설명")).not.toBeInTheDocument();
  expect(view.calls.some(c => c.path === "/api/v1/ai/jobs")).toBe(false);
});

test("requires a token for mutations when configured", async () => {
  setup({ job: resultJob(), route: "/editor/example-app?aiJob=ai1", routes: { "GET /api/v1/healthz": { auth_required: true }, "GET /api/v1/ai/jobs/ai1": resultJob() } });
  await screen.findByText("로그인 단계를 보완했습니다");
  expect(screen.getByRole("button", { name: "선택한 파일을 에디터에 반영" })).toBeDisabled();
});

test("does not expose another workspace's proposal or enable apply", async () => {
  setup({ job: { ...resultJob(), workspace_id: "ws2" }, route: "/editor/example-app?aiJob=ai1" });
  await screen.findByRole("alert");
  expect(screen.getByRole("alert")).toHaveTextContent("다른 워크스페이스");
  expect(screen.queryByRole("button", { name: "선택한 파일을 에디터에 반영" })).not.toBeInTheDocument();
});

test("shows the exact data notice and uses the selected Monaco theme", async () => {
  localStorage.setItem("farm.theme", "dark");
  setup({ job: resultJob(), route: "/editor/example-app?aiJob=ai1" });
  await screen.findByLabelText("AI 제안 코드");
  expect(screen.getByLabelText("AI 제안 코드")).toHaveAttribute("data-theme", "farm-dark");
  expect(screen.getByText("flow 파일, 스크린샷, 화면 hierarchy, 실패 로그와 설명이 OpenAI로 전송됩니다. 환경 변수 값과 토큰은 보내지 않으며, AI 결과는 자동으로 커밋되지 않습니다.")).toBeInTheDocument();
});
