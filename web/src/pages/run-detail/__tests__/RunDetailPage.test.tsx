import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { keys } from "../../../api/queries";
import type { RunDetail } from "../../../api/types";
import { saveSettings } from "../../../lib/settings";
import { apiErrorResponse, healthBody, mockApi } from "../../../test/api";
import { device, runDetail, runSummary, task, workspace } from "../../../test/fixtures";
import { renderPage } from "../../../test/render";
import { RunDetailPage } from "../RunDetailPage";

afterEach(() => vi.restoreAllMocks());

function mount(run: RunDetail = runDetail(), extra: Parameters<typeof mockApi>[0] = {}) {
  const api = mockApi({
    "GET /api/v1/runs/run1": run,
    "GET /api/v1/devices": [device()],
    "GET /api/v1/workspaces": [workspace()],
    "GET /api/v1/tasks/task1/artifacts": { task_id: "task1", attempt: 1, files: [] },
    "GET /api/v1/tasks/task2/artifacts": { task_id: "task2", attempt: 1, files: [] },
    ...extra,
  });
  return { ...api, ...renderPage(<RunDetailPage />, { path: "/runs/:runId", route: "/runs/run1" }) };
}

test("renders the matrix device headers and selecting a failed cell shows its failure", async () => {
  mount(runDetail({
    mode: "matrix", tasks: [task(), task({ id: "task2", seq: 1, device_serial: "unknown-serial" })],
    results: [{ task_id: "task1", device_serial: "emulator-5554", flow_name: "login", status: "failed", duration_ms: 1200, failure_message: "로그인 버튼이 없습니다." }],
  }));
  expect(await screen.findByRole("columnheader", { name: "Pixel 7 (emulator-5554)" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "unknown-serial" })).toBeInTheDocument();
  expect(screen.getByText("task를 선택하면 산출물을 볼 수 있습니다.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /login.*emulator-5554.*실패/ }));
  expect(await screen.findByText("로그인 버튼이 없습니다.")).toBeInTheDocument();
});

test("sorts split tasks by seq and requests encoded image artifacts only after selection", async () => {
  const { calls } = mount(runDetail({ tasks: [task({ id: "task2", seq: 2, flows: ["other.yaml"] }), task({ seq: 1, attempt: 2 })] }), {
    "GET /api/v1/tasks/task1/artifacts": { task_id: "task1", attempt: 2, files: [{ path: "maestro/shot 1.png", size: 1024 }] },
  });
  await screen.findByText("Run run1");
  const rows = screen.getAllByRole("row").slice(1);
  expect(within(rows[0]!).getByText("#1")).toBeInTheDocument();
  expect(within(rows[1]!).getByText("#2")).toBeInTheDocument();
  expect(within(rows[0]!).getByText("2회차")).toBeInTheDocument();
  expect(calls.some((c) => c.path.includes("/artifacts"))).toBe(false);
  await userEvent.click(rows[0]!);
  const image = await screen.findByRole("img", { name: "maestro/shot 1.png" });
  expect(image).toHaveAttribute("src", "/api/v1/tasks/task1/artifacts/maestro/shot%201.png");
  expect(image.closest("a")).toHaveAttribute("target", "_blank");
  expect(calls.some((c) => c.path === "/api/v1/tasks/task1/artifacts")).toBe(true);
  expect(screen.getByRole("link", { name: "maestro/shot 1.png 다운로드" })).toHaveAttribute("download");
});

test("allows keyboard task selection and shows task errors with default failed task selection", async () => {
  mount(runDetail({ tasks: [task(), task({ id: "task2", seq: 1, status: "error", error_code: "device_lost", error_message: "기기 연결이 끊겼습니다." })] }));
  expect(await screen.findByRole("heading", { name: /task2/ })).toBeInTheDocument();
  expect(screen.getAllByText(/기기 연결이 끊겼습니다./).length).toBeGreaterThan(0);
  const row = screen.getAllByRole("row")[1]!;
  row.focus();
  await userEvent.keyboard("{Enter}");
  expect(await screen.findByRole("heading", { name: /task1/ })).toBeInTheDocument();
  expect(await screen.findByText("산출물이 없습니다.")).toBeInTheDocument();
});

test("confirms cancellation, sends the token, and invalidates both run query keys", async () => {
  saveSettings({ token: "t", authorName: "Kim", authorEmail: "kim@x.io" });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  const { calls, client } = mount(runDetail({ status: "running", finished_at: null }), {
    "POST /api/v1/runs/run1/cancel": runSummary({ status: "running" }),
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  await userEvent.click(await screen.findByRole("button", { name: "취소" }));
  expect(confirm).toHaveBeenCalledWith("이 run을 취소할까요?");
  await waitFor(() => expect(calls.find((c) => c.method === "POST")?.path).toBe("/api/v1/runs/run1/cancel"));
  expect(calls.find((c) => c.method === "POST")?.headers.Authorization).toBe("Bearer t");
  await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.run("run1") }));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.runsAll });
});

test("does not cancel when confirmation is declined", async () => {
  saveSettings({ token: "t", authorName: "Kim", authorEmail: "kim@x.io" });
  vi.spyOn(window, "confirm").mockReturnValue(false);
  const { calls } = mount(runDetail({ status: "queued" }));
  await userEvent.click(await screen.findByRole("button", { name: "취소" }));
  expect(calls.some((c) => c.method === "POST")).toBe(false);
});

test("disables cancellation without a token when the farm requires one", async () => {
  mount(runDetail({ status: "running", cancel_requested: true }), { "GET /api/v1/healthz": healthBody({ auth_required: true }) });
  expect(await screen.findByText("쓰기 작업에는 API 토큰이 필요합니다.")).toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "취소" })).toBeDisabled();
  expect(screen.getByText("취소 요청됨")).toBeInTheDocument();
});

test("has no cancellation button for a passed run and links the merged JUnit", async () => {
  mount();
  await screen.findByText("Run run1");
  expect(screen.queryByRole("button", { name: "취소" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "JUnit 다운로드" })).toHaveAttribute("href", "/api/v1/runs/run1/junit");
  expect(screen.getByText("업로드한 flow")).toBeInTheDocument();
  expect(screen.getByText("통과 2")).toBeInTheDocument();
  expect(screen.queryByText("실패 0")).not.toBeInTheDocument();
});

test.each(["workspace", "draft"] as const)("links %s source and CI metadata", async (flow_source) => {
  const sha = "a".repeat(40);
  mount(runDetail({ flow_source, workspace_id: "ws1", commit_sha: sha, ref: "release", ci_meta: { branch: "feature", commit: "b".repeat(40), pr_url: "https://github.com/example-org/example-app/pull/1", workflow_url: "https://github.com/example-org/example-app/actions/runs/1" } }));
  const link = await screen.findByRole("link", { name: "example-app @ aaaaaaa" });
  expect(link).toHaveAttribute("href", `https://github.com/example-org/example-app/commit/${sha}`);
  expect(link).toHaveAttribute("target", "_blank");
  expect(screen.getByText(/release/)).toBeInTheDocument();
  expect(screen.getByText(/feature/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "PR" })).toHaveAttribute("href", "https://github.com/example-org/example-app/pull/1");
  expect(screen.getByRole("link", { name: "워크플로" })).toHaveAttribute("target", "_blank");
  if (flow_source === "draft") expect(screen.getByText("(초안, 기준 커밋)")).toBeInTheDocument();
});

test("renders all run options and masks env values even if an unmasked value arrives", async () => {
  mount(runDetail({ device_selector: { serials: ["emulator-5554"], tags: ["smoke"], models: ["Pixel 7"], min_sdk: 24, max_sdk: 35 }, flow_paths: ["flows/login.yaml"], include_tags: ["include-me"], exclude_tags: ["exclude-me"], env: { PASSWORD: "do-not-render" }, task_timeout_sec: 123 }));
  await screen.findByText("Run run1");
  fireEvent.click(screen.getByText("실행 옵션"));
  expect(screen.getByText("flows/login.yaml")).toBeInTheDocument();
  expect(screen.getByText(/PASSWORD.*\*\*\*/)).toBeInTheDocument();
  expect(screen.queryByText(/do-not-render/)).not.toBeInTheDocument();
  expect(screen.getByText("include-me")).toBeInTheDocument();
  expect(screen.getByText("exclude-me")).toBeInTheDocument();
  expect(screen.getByText(/24.*35/)).toBeInTheDocument();
  expect(screen.getByText("123초")).toBeInTheDocument();
});

test("renders video, encoded downloads and lazy logs with only the final 200 KB", async () => {
  const log = "discard-prefix\n" + "가".repeat(80_000) + "\n마지막 줄";
  const { calls, container } = mount(runDetail({ tasks: [task({ status: "failed" })] }), {
    "GET /api/v1/tasks/task1/artifacts": { task_id: "task1", attempt: 1, files: [{ path: "maestro/maestro.log", size: 250_000 }, { path: "recording #1.webm", size: 2048 }, { path: "logcat.txt", size: 5 }] },
    "GET /api/v1/tasks/task1/artifacts/maestro/maestro.log": () => new Response(log),
    "GET /api/v1/tasks/task1/artifacts/logcat.txt": () => new Response("짧은 로그"),
  });
  const toggle = await screen.findByRole("button", { name: "maestro/maestro.log 로그 보기" });
  expect(calls.some((c) => c.path.endsWith("/maestro.log"))).toBe(false);
  expect(container.querySelector("video")).toHaveAttribute("src", "/api/v1/tasks/task1/artifacts/recording%20%231.webm");
  expect(container.querySelector("video")).toHaveAttribute("controls");
  await userEvent.click(toggle);
  expect(await screen.findByText("마지막 200KB만 표시")).toBeInTheDocument();
  const pre = screen.getByText(/마지막 줄/);
  expect(pre.tagName).toBe("PRE");
  expect(new TextEncoder().encode(pre.textContent ?? "").length).toBeLessThanOrEqual(200 * 1024);
  expect(pre.textContent).not.toContain("discard-prefix");
  expect(pre.textContent).not.toContain("�");
  await userEvent.click(screen.getByRole("button", { name: "maestro/maestro.log 로그 닫기" }));
  expect(screen.queryByText(/마지막 줄/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "logcat.txt 로그 보기" }));
  expect(await screen.findByText("짧은 로그")).toBeInTheDocument();
});

test("refreshes selected task artifacts after an SSE-driven run update", async () => {
  const original = runDetail({ status: "running", tasks: [task({ status: "running" })] });
  let finished = false;
  const { client, calls } = mount(original, {
    "GET /api/v1/runs/run1": () => finished ? { ...original, status: "passed", tasks: [task()] } : original,
    "GET /api/v1/tasks/task1/artifacts": () => ({ task_id: "task1", attempt: 1, files: finished ? [{ path: "shot.jpg", size: 1 }] : [] }),
  });
  await userEvent.click((await screen.findAllByRole("row"))[1]!);
  expect(await screen.findByText("산출물이 없습니다.")).toBeInTheDocument();
  finished = true;
  await act(() => client.invalidateQueries({ queryKey: keys.run("run1") }));
  expect(await screen.findByRole("img", { name: "shot.jpg" })).toBeInTheDocument();
  expect(calls.filter((c) => c.path === "/api/v1/tasks/task1/artifacts")).toHaveLength(2);
});

test("renders loading then run_not_found as an empty state", async () => {
  mount(runDetail(), { "GET /api/v1/runs/run1": apiErrorResponse(404, "run_not_found") });
  expect(screen.getByText("불러오는 중…")).toBeInTheDocument();
  expect(await screen.findByText("run을 찾을 수 없습니다.")).toBeInTheDocument();
});

test("surfaces run fetch failures", async () => {
  mount(runDetail(), { "GET /api/v1/runs/run1": apiErrorResponse(503, "unavailable", "서버에 연결할 수 없습니다.") });
  expect(await screen.findByRole("alert")).toHaveTextContent("서버에 연결할 수 없습니다.");
});

test("surfaces artifact and cancellation errors", async () => {
  saveSettings({ token: "t", authorName: "Kim", authorEmail: "kim@x.io" });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  mount(runDetail({ status: "running", tasks: [task({ status: "error" })] }), {
    "GET /api/v1/tasks/task1/artifacts": apiErrorResponse(503, "artifacts_unavailable", "산출물 조회 실패"),
    "POST /api/v1/runs/run1/cancel": apiErrorResponse(409, "already_finished", "이미 종료된 실행입니다."),
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("산출물 조회 실패");
  await userEvent.click(screen.getByRole("button", { name: "취소" }));
  expect(await screen.findByText(/이미 종료된 실행입니다./)).toBeInTheDocument();
});
