import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { keys } from "../../../api/queries";
import { saveSettings } from "../../../lib/settings";
import { apiErrorResponse, jsonResponse, mockApi } from "../../../test/api";
import { workspace } from "../../../test/fixtures";
import { renderPage } from "../../../test/render";
import { WorkspacesPage } from "../WorkspacesPage";

const SHA = "abcdef1234567890abcdef1234567890abcdef12";
const CONFIRM_REMOVE = "팜에서만 등록을 해제합니다. GitHub 레포는 그대로입니다. 계속할까요?";

function authorize() {
  saveSettings({ token: "t", authorName: "Kim", authorEmail: "kim@x.io" });
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

async function fillRegistration(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "등록" }));
  const dialog = within(screen.getByRole("dialog", { name: "워크스페이스 등록" }));
  await user.type(dialog.getByRole("textbox", { name: /^이름/ }), "example-app");
  await user.type(dialog.getByRole("textbox", { name: /^레포/ }), "example-org/example-app");
  expect(dialog.getByRole("textbox", { name: /^브랜치/ })).toHaveValue("main");
  await user.type(dialog.getByRole("textbox", { name: /^경로/ }), ".maestro");
  return dialog;
}

afterEach(() => vi.restoreAllMocks());

test("renders sorted workspace cards with repository, head link, package and sync error", async () => {
  mockApi({ "GET /api/v1/workspaces": [
    workspace({ id: "ws2", name: "z-workspace", path: "", head_sha: null }),
    workspace({ head_sha: SHA, sync_error: "브랜치를 찾을 수 없습니다." }),
  ] });
  renderPage(<WorkspacesPage />);

  expect(await screen.findByRole("heading", { name: "example-app" })).toBeInTheDocument();
  expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["example-app", "z-workspace"]);
  for (const link of screen.getAllByRole("link", { name: "example-org/example-app" })) {
    expect(link).toHaveAttribute("href", "https://github.com/example-org/example-app");
    expect(link).toHaveAttribute("target", "_blank");
  }
  expect(screen.getByRole("link", { name: "abcdef1" })).toHaveAttribute("href", `https://github.com/example-org/example-app/commit/${SHA}`);
  expect(screen.getByText("브랜치를 찾을 수 없습니다.")).toBeVisible();
  expect(screen.getAllByText("com.example.app")).toHaveLength(2);
  expect(screen.getByText(".maestro")).toBeInTheDocument();
  expect(screen.getByText("/", { exact: true })).toBeInTheDocument();
});

test("registers with an empty optional package as null, invalidates workspaces and closes on 201", async () => {
  authorize();
  const user = userEvent.setup();
  const { calls } = mockApi({
    "GET /api/v1/workspaces": [],
    "POST /api/v1/workspaces": jsonResponse(201, workspace()),
  });
  const { client } = renderPage(<WorkspacesPage />);
  await screen.findByText("등록된 워크스페이스가 없습니다.");
  const dialog = await fillRegistration(user);
  await user.click(dialog.getByRole("button", { name: "등록" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  const request = calls.find((call) => call.method === "POST");
  expect(request?.body).toEqual({ name: "example-app", repo: "example-org/example-app", branch: "main", path: ".maestro", default_app_package: null });
  expect(request?.headers.Authorization).toBe("Bearer t");
  await waitFor(() => expect(calls.filter((call) => call.method === "GET")).toHaveLength(2));
  expect(client.getQueryData(keys.workspaces)).toEqual([]);
});

test.each(["invalid_name", "repo_unreachable", "branch_not_found", "workspace_exists"])("keeps registration values and shows %s in the modal", async (code) => {
  authorize();
  const user = userEvent.setup();
  mockApi({
    "GET /api/v1/workspaces": [],
    "POST /api/v1/workspaces": apiErrorResponse(400, code, "등록할 수 없습니다."),
  });
  renderPage(<WorkspacesPage />);
  const dialog = await fillRegistration(user);
  await user.click(dialog.getByRole("button", { name: "등록" }));

  expect(await dialog.findByRole("alert")).toHaveTextContent(`등록할 수 없습니다. (${code})`);
  expect(dialog.getByRole("textbox", { name: /^이름/ })).toHaveValue("example-app");
  expect(dialog.getByRole("textbox", { name: /^경로/ })).toHaveValue(".maestro");
});

test("shows the registration pending state and prevents duplicate submissions", async () => {
  authorize();
  const user = userEvent.setup();
  const pending = deferredResponse();
  const { calls } = mockApi({ "GET /api/v1/workspaces": [], "POST /api/v1/workspaces": () => pending.promise });
  renderPage(<WorkspacesPage />);
  const dialog = await fillRegistration(user);
  await user.click(dialog.getByRole("button", { name: "등록" }));
  expect(await dialog.findByRole("button", { name: "확인 중…" })).toBeDisabled();
  await user.click(dialog.getByRole("button", { name: "확인 중…" }));
  expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  await act(async () => pending.resolve(jsonResponse(201, workspace())));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

test("a completed registration does not close a new modal opened after cancelling the pending one", async () => {
  authorize();
  const user = userEvent.setup();
  const pending = deferredResponse();
  const { calls } = mockApi({ "GET /api/v1/workspaces": [], "POST /api/v1/workspaces": () => pending.promise });
  renderPage(<WorkspacesPage />);
  const dialog = await fillRegistration(user);
  await user.click(dialog.getByRole("button", { name: "등록" }));
  await user.click(dialog.getByRole("button", { name: "취소" }));
  await user.click(screen.getByRole("button", { name: "등록" }));
  await act(async () => pending.resolve(jsonResponse(201, workspace())));
  await waitFor(() => expect(calls.filter((call) => call.method === "GET")).toHaveLength(2));
  expect(screen.getByRole("dialog", { name: "워크스페이스 등록" })).toBeInTheDocument();
  expect(within(screen.getByRole("dialog")).getByRole("textbox", { name: /^이름/ })).toHaveValue("");
});

test("syncs a workspace, displays pending state and refreshes the list", async () => {
  authorize();
  const user = userEvent.setup();
  const pending = deferredResponse();
  const { calls } = mockApi({ "GET /api/v1/workspaces": [workspace()], "POST /api/v1/workspaces/ws1/sync": () => pending.promise });
  renderPage(<WorkspacesPage />);
  await user.click(await screen.findByRole("button", { name: "동기화" }));
  expect(await screen.findByRole("button", { name: "동기화 중…" })).toBeDisabled();
  expect(calls.find((call) => call.method === "POST")?.path).toBe("/api/v1/workspaces/ws1/sync");
  await act(async () => pending.resolve(jsonResponse(200, workspace())));
  await waitFor(() => expect(calls.filter((call) => call.method === "GET")).toHaveLength(2));
});

test("edits only changed fields and clears the optional package with null", async () => {
  authorize();
  const user = userEvent.setup();
  const { calls } = mockApi({
    "GET /api/v1/workspaces": [workspace()],
    "PATCH /api/v1/workspaces/ws1": workspace({ branch: "develop", default_app_package: null }),
  });
  renderPage(<WorkspacesPage />);
  await user.click(await screen.findByRole("button", { name: "수정" }));
  const dialog = within(screen.getByRole("dialog", { name: "워크스페이스 수정" }));
  expect(dialog.queryByRole("textbox", { name: /^이름/ })).not.toBeInTheDocument();
  expect(dialog.queryByRole("textbox", { name: /^레포/ })).not.toBeInTheDocument();
  const branch = dialog.getByRole("textbox", { name: /^브랜치/ });
  await user.clear(branch);
  await user.type(branch, "develop");
  await user.clear(dialog.getByRole("textbox", { name: /^기본 앱 패키지/ }));
  await user.click(dialog.getByRole("button", { name: "저장" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({ branch: "develop", default_app_package: null });
  await waitFor(() => expect(calls.filter((call) => call.method === "GET")).toHaveLength(2));
});

test("shows edit and sync errors without losing the current workspace or draft", async () => {
  authorize();
  const user = userEvent.setup();
  mockApi({
    "GET /api/v1/workspaces": [workspace()],
    "POST /api/v1/workspaces/ws1/sync": apiErrorResponse(502, "git_unavailable", "동기화 실패"),
    "PATCH /api/v1/workspaces/ws1": apiErrorResponse(400, "branch_not_found", "없는 브랜치"),
  });
  renderPage(<WorkspacesPage />);
  await user.click(await screen.findByRole("button", { name: "동기화" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("동기화 실패");
  await user.click(screen.getByRole("button", { name: "수정" }));
  const dialog = within(screen.getByRole("dialog"));
  await user.type(dialog.getByRole("textbox", { name: /^브랜치/ }), "-missing");
  await user.click(dialog.getByRole("button", { name: "저장" }));
  expect(await dialog.findByRole("alert")).toHaveTextContent("없는 브랜치");
  expect(dialog.getByRole("textbox", { name: /^브랜치/ })).toHaveValue("main-missing");
});

test("refreshes expanded file previews when editing the path without changing the head", async () => {
  authorize();
  const user = userEvent.setup();
  let currentPath = ".maestro";
  const { calls } = mockApi({
    "GET /api/v1/workspaces": () => [workspace({ path: currentPath })],
    "GET /api/v1/workspaces/ws1/tree": () => ({ sha: SHA, files: [{ path: currentPath === ".maestro" ? "old.yaml" : "new.yaml", size: 1 }] }),
    "GET /api/v1/workspaces/ws1/history": { sha: SHA, commits: [] },
    "PATCH /api/v1/workspaces/ws1": () => {
      currentPath = "flows";
      return workspace({ path: currentPath });
    },
  });
  renderPage(<WorkspacesPage />);
  await user.click(await screen.findByText("파일과 최근 커밋"));
  expect(await screen.findByText("old.yaml")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "수정" }));
  const dialog = within(screen.getByRole("dialog"));
  await user.clear(dialog.getByRole("textbox", { name: /^경로/ }));
  await user.type(dialog.getByRole("textbox", { name: /^경로/ }), "flows");
  await user.click(dialog.getByRole("button", { name: "저장" }));
  expect(await screen.findByText("new.yaml")).toBeInTheDocument();
  expect(screen.queryByText("old.yaml")).not.toBeInTheDocument();
  expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({ path: "flows" });
});

test.each([true, false])("only unregisters when confirmation is %s", async (confirmed) => {
  authorize();
  const user = userEvent.setup();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(confirmed);
  const { calls } = mockApi({
    "GET /api/v1/workspaces": [workspace()],
    "DELETE /api/v1/workspaces/ws1": new Response(null, { status: 204 }),
  });
  renderPage(<WorkspacesPage />);
  await user.click(await screen.findByRole("button", { name: "등록 해제" }));
  expect(confirm).toHaveBeenCalledWith(CONFIRM_REMOVE);
  if (confirmed) {
    await waitFor(() => expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(1));
    expect(calls.find((call) => call.method === "DELETE")?.path).toBe("/api/v1/workspaces/ws1");
    await waitFor(() => expect(calls.filter((call) => call.method === "GET")).toHaveLength(2));
  } else {
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(0);
  }
});

test("disables every write action without a token but keeps previews available", async () => {
  const user = userEvent.setup();
  const { calls } = mockApi({
    "GET /api/v1/workspaces": [workspace()],
    "GET /api/v1/workspaces/ws1/tree": { sha: SHA, files: [] },
    "GET /api/v1/workspaces/ws1/history": { sha: SHA, commits: [] },
  });
  renderPage(<WorkspacesPage />);
  await screen.findByRole("heading", { name: "example-app" });
  expect(screen.getByText("쓰기 작업에는 API 토큰이 필요합니다.")).toBeInTheDocument();
  for (const name of ["등록", "동기화", "수정", "등록 해제"]) {
    expect(screen.getByRole("button", { name })).toBeDisabled();
  }
  await user.click(screen.getByText("파일과 최근 커밋"));
  await waitFor(() => expect(calls.some((call) => call.path.endsWith("/tree"))).toBe(true));
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("loads file and recent commit previews only on expansion, using the human co-author and offset timestamp", async () => {
  const user = userEvent.setup();
  const authoredAt = "2026-10-20T14:31:00+09:00";
  const { calls } = mockApi({
    "GET /api/v1/workspaces": [workspace({ head_sha: SHA })],
    "GET /api/v1/workspaces/ws1/tree": { sha: SHA, files: [{ path: "login.yaml", size: 2048 }] },
    "GET /api/v1/workspaces/ws1/history": { sha: SHA, commits: [{
      sha: "1234567890abcdef1234567890abcdef12345678", author_name: "maestro-device-farm", author_email: "bot@example.test",
      authored_at: authoredAt, message: "로그인 테스트 추가\n\n자세한 본문", co_authors: [{ name: "Kim", email: "kim@example.test" }], files_changed: 1,
    }] },
  });
  renderPage(<WorkspacesPage />);
  await screen.findByRole("heading", { name: "example-app" });
  expect(calls).toHaveLength(1);
  await user.click(screen.getByText("파일과 최근 커밋"));
  expect(await screen.findByText("login.yaml")).toBeInTheDocument();
  expect(screen.getByText("2.0 KB")).toBeInTheDocument();
  expect(await screen.findByText("로그인 테스트 추가")).toBeInTheDocument();
  expect(screen.queryByText(/자세한 본문/)).not.toBeInTheDocument();
  expect(screen.getByText("Kim")).toBeInTheDocument();
  expect(screen.getByText(new Date(authoredAt).toLocaleString("ko-KR", { hour12: false }))).toBeInTheDocument();
  expect(calls.find((call) => call.path.endsWith("/history"))?.search.get("limit")).toBe("5");
  expect(screen.getByRole("link", { name: "1234567" })).toHaveAttribute("href", "https://github.com/example-org/example-app/commit/1234567890abcdef1234567890abcdef12345678");
});

test("refetches expanded previews when the workspace head changes", async () => {
  const user = userEvent.setup();
  let head = SHA;
  const nextHead = "f".repeat(40);
  const { calls } = mockApi({
    "GET /api/v1/workspaces": () => [workspace({ head_sha: head })],
    "GET /api/v1/workspaces/ws1/tree": () => ({ sha: head, files: [{ path: head === SHA ? "old.yaml" : "new.yaml", size: 1 }] }),
    "GET /api/v1/workspaces/ws1/history": () => ({ sha: head, commits: [] }),
  });
  const { client } = renderPage(<WorkspacesPage />);
  await user.click(await screen.findByText("파일과 최근 커밋"));
  expect(await screen.findByText("old.yaml")).toBeInTheDocument();
  expect(client.getQueryData(["workspace-tree", "ws1", SHA])).toBeDefined();
  expect(client.getQueryData(["workspace-history", "ws1", SHA])).toBeDefined();
  head = nextHead;
  await act(async () => { await client.invalidateQueries({ queryKey: keys.workspaces }); });
  expect(await screen.findByText("new.yaml")).toBeInTheDocument();
  expect(screen.queryByText("old.yaml")).not.toBeInTheDocument();
  expect(client.getQueryData(["workspace-tree", "ws1", nextHead])).toBeDefined();
  await waitFor(() => expect(calls.filter((call) => call.path.endsWith("/history"))).toHaveLength(2));
});

test("shows independent preview errors", async () => {
  const user = userEvent.setup();
  mockApi({
    "GET /api/v1/workspaces": [workspace()],
    "GET /api/v1/workspaces/ws1/tree": apiErrorResponse(502, "git_unavailable", "파일을 불러올 수 없습니다."),
    "GET /api/v1/workspaces/ws1/history": { sha: SHA, commits: [] },
  });
  renderPage(<WorkspacesPage />);
  await user.click(await screen.findByText("파일과 최근 커밋"));
  expect(await screen.findByRole("alert")).toHaveTextContent("파일을 불러올 수 없습니다.");
  expect(await screen.findByText("최근 커밋이 없습니다.")).toBeInTheDocument();
});

test("shows loading then the empty state", async () => {
  const pending = deferredResponse();
  mockApi({ "GET /api/v1/workspaces": () => pending.promise });
  renderPage(<WorkspacesPage />);
  expect(screen.getByText("불러오는 중…")).toBeInTheDocument();
  await act(async () => pending.resolve(jsonResponse(200, [])));
  expect(await screen.findByText("등록된 워크스페이스가 없습니다.")).toBeInTheDocument();
});

test("shows workspace query errors", async () => {
  mockApi({ "GET /api/v1/workspaces": apiErrorResponse(500, "server_error", "목록을 불러올 수 없습니다.") });
  renderPage(<WorkspacesPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent("목록을 불러올 수 없습니다. (server_error)");
});
