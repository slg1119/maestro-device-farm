import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { CommitDialog } from "../../CommitDialog";
import { EditorProvider, useEditor, type EditorApi } from "../../../store";
import { saveSettings } from "../../../../lib/settings";
import { apiErrorResponse, jsonResponse, mockApi, type MockRequest } from "../../../../test/api";
import { workspace } from "../../../../test/fixtures";
import { renderPage } from "../../../../test/render";

vi.mock("@monaco-editor/react", () => ({ DiffEditor: (props: { original: string; modified: string; theme: string; options: { readOnly: boolean } }) => <pre data-testid="diff" data-theme={props.theme} data-readonly={String(props.options.readOnly)}>{props.original}{" → "}{props.modified}</pre> }));
vi.mock("../../../monacoSetup", () => ({ ensureMonaco: () => Promise.resolve({}) }));
const ws = workspace(); const next = "b".repeat(40); const remote = "c".repeat(40);
let editor: EditorApi;
function Probe() { editor = useEditor(); return <div data-testid="base">{editor.baseSha}</div>; }
function setup(overrides: Parameters<typeof mockApi>[0] = {}, author = true) {
  if (author) saveSettings({ token: "", authorName: "테스터", authorEmail: "tester@example.com" });
  const mock = mockApi({
    "GET /api/v1/workspaces/ws1/tree": { sha: ws.head_sha, files: [{ path: "flow.yaml", size: 10 }, { path: "old.yaml", size: 10 }] },
    "GET /api/v1/workspaces/ws1/files/flow.yaml": (r: MockRequest) => new Response(r.search.get("ref") === remote ? "- back\n" : "- scroll\n"),
    "GET /api/v1/workspaces/ws1/files/old.yaml": () => new Response("- back\n"),
    "POST /api/v1/workspaces/ws1/validate": { valid: true, issues: [] },
    "POST /api/v1/workspaces/ws1/commits": jsonResponse(201, { sha: next, parent: ws.head_sha }),
    "GET /api/v1/workspaces/ws1/diff": { from: ws.head_sha, to: next, files: [{ path: "flow.yaml", status: "modified" }] },
    ...overrides,
  });
  const rendered = renderPage(<EditorProvider workspace={ws}><Probe /><CommitDialog /></EditorProvider>);
  return { ...mock, ...rendered, user: userEvent.setup() };
}
async function open() {
  await waitFor(() => expect(editor.files).toHaveLength(2));
  act(() => { editor.setContent("flow.yaml", "- tapOn: 시작\n"); editor.openCommit(); });
  return screen.findByRole("dialog", { name: "커밋" });
}

test("stays closed until requested, validates puts, sends author and changes, rebases and clears drafts", async () => {
  const { calls, user } = setup();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await open();
  await screen.findByText("검증 통과 1/1");
  expect(await screen.findByTestId("diff")).toHaveTextContent("- scroll → - tapOn: 시작");
  expect(screen.getByTestId("diff")).toHaveAttribute("data-readonly", "true");
  expect(screen.getByText(/Co-authored-by: 테스터 <tester@example.com>/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "main에 커밋" })).toBeDisabled();
  await user.type(screen.getByRole("textbox", { name: "커밋 메시지" }), "시작 선택자 수정");
  await user.click(screen.getByRole("button", { name: "main에 커밋" }));
  await screen.findByText("커밋했습니다 (bbbbbbb)");
  expect(calls.find(c => c.path.endsWith("/commits"))?.body).toEqual({ base_sha: ws.head_sha, message: "시작 선택자 수정", author: { name: "테스터", email: "tester@example.com" }, changes: [{ op: "put", path: "flow.yaml", content: "- tapOn: 시작\n", encoding: "utf-8" }] });
  expect(editor.baseSha).toBe(next); expect(editor.changes()).toEqual([]);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("added and deleted files have empty diff sides and line counts, only puts are validated", async () => {
  const { user, calls } = setup(); await waitFor(() => expect(editor.files).toHaveLength(2));
  act(() => { editor.createFile("new.yaml", "- scroll\n- back\n"); editor.deleteFile("old.yaml"); editor.openCommit(); });
  await screen.findByText("검증 통과 1/1");
  expect(screen.getByRole("button", { name: /A.*new.yaml.*\+2.*−0/ })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /D.*old.yaml/ }));
  await waitFor(() => expect(screen.getByTestId("diff")).toHaveTextContent("- back →"));
  expect(calls.find(c => c.path.endsWith("/validate"))?.body).toEqual({ changes: [{ op: "put", path: "new.yaml", content: "- scroll\n- back\n", encoding: "utf-8" }] });
});

test("blocking validation issues disable commit and jump to the issue", async () => {
  const { user, calls } = setup({ "POST /api/v1/workspaces/ws1/validate": { valid: false, issues: [{ path: "flow.yaml", message: "잘못된 명령", line: 2, column: 3 }] } });
  await open(); await screen.findByText(/잘못된 명령/);
  await user.type(screen.getByRole("textbox", { name: "커밋 메시지" }), "수정");
  expect(screen.getByRole("button", { name: "main에 커밋" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: /flow.yaml:2:3.*잘못된 명령/ }));
  expect(editor.activePath).toBe("flow.yaml");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(calls.some(c => c.path.endsWith("/commits"))).toBe(false);
});

test("validation failure is fail closed and missing author prompts settings", async () => {
  const { user } = setup({ "POST /api/v1/workspaces/ws1/validate": apiErrorResponse(503, "unavailable", "검증 서버 오류") }, false);
  await open(); await screen.findByText(/검증 서버 오류/);
  await user.type(screen.getByRole("textbox", { name: "커밋 메시지" }), "수정");
  expect(screen.getByRole("button", { name: "main에 커밋" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "설정 열기" })).toBeInTheDocument();
});

test("conflict previews remote versus draft, then rebases keeping drafts for retry", async () => {
  let attempt = 0;
  const { user, calls } = setup({ "POST /api/v1/workspaces/ws1/commits": () => ++attempt === 1 ? apiErrorResponse(409, "conflict", "충돌", { paths: ["flow.yaml"], remote_head: remote }) : jsonResponse(201, { sha: next, parent: remote }) });
  await open(); await screen.findByText("검증 통과 1/1");
  await user.type(screen.getByRole("textbox", { name: "커밋 메시지" }), "수정");
  await user.click(screen.getByRole("button", { name: "main에 커밋" }));
  await user.click(await screen.findByRole("button", { name: "원격 내용 보기" }));
  await waitFor(() => expect(screen.getByTestId("diff")).toHaveTextContent("- back → - tapOn: 시작"));
  await user.click(screen.getByRole("button", { name: "내 변경으로 다시 적용" }));
  await waitFor(() => expect(editor.baseSha).toBe(remote));
  expect(editor.changes()).toHaveLength(1);
  await waitFor(() => expect(screen.getByRole("button", { name: "main에 커밋" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "main에 커밋" }));
  await screen.findByText("커밋했습니다 (bbbbbbb)");
  expect((calls.filter(c => c.path.endsWith("/commits"))[1]?.body as { base_sha: string }).base_sha).toBe(remote);
});

test.each([[409, "push_contended"], [403, "branch_protected"], [422, "invalid_flow"]])("commit error %s %s is inline and preserves drafts", async (status, code) => {
  const { user } = setup({ "POST /api/v1/workspaces/ws1/commits": apiErrorResponse(status, code, "커밋 실패") });
  await open(); await screen.findByText("검증 통과 1/1");
  await user.type(screen.getByRole("textbox", { name: "커밋 메시지" }), "수정");
  await user.click(screen.getByRole("button", { name: "main에 커밋" }));
  await screen.findByText(new RegExp(code)); expect(editor.changes()).toHaveLength(1);
});

test("reapplying a remotely deleted file compares an empty base with the retained draft", async () => {
  const { user } = setup({
    "POST /api/v1/workspaces/ws1/commits": apiErrorResponse(409, "conflict", "충돌", { paths: ["flow.yaml"], remote_head: remote }),
    "GET /api/v1/workspaces/ws1/files/flow.yaml": (r: MockRequest) => r.search.get("ref") === remote ? apiErrorResponse(404, "file_not_found") : new Response("- scroll\n"),
  });
  await open(); await screen.findByText("검증 통과 1/1");
  await user.type(screen.getByRole("textbox", { name: "커밋 메시지" }), "삭제된 플로우 복구");
  await user.click(screen.getByRole("button", { name: "main에 커밋" }));
  await user.click(await screen.findByRole("button", { name: "내 변경으로 다시 적용" }));
  await waitFor(() => expect(editor.baseSha).toBe(remote));
  await screen.findByRole("button", { name: /A.*flow.yaml.*\+1.*−0/ });
  await waitFor(() => expect(screen.getByTestId("diff")).toHaveTextContent("→ - tapOn: 시작"));
  expect(editor.changes()).toHaveLength(1);
});

test("sync retry after a successful commit never creates a second commit", async () => {
  let syncAttempts = 0;
  const { user, calls } = setup({
    "GET /api/v1/workspaces/ws1/diff": () => ++syncAttempts === 1 ? apiErrorResponse(503, "unavailable", "동기화 실패") : { from: ws.head_sha, to: next, files: [] },
  });
  await open(); await screen.findByText("검증 통과 1/1");
  await user.type(screen.getByRole("textbox", { name: "커밋 메시지" }), "수정");
  await user.click(screen.getByRole("button", { name: "main에 커밋" }));
  await user.click(await screen.findByRole("button", { name: "에디터 동기화" }));
  await screen.findByText("커밋했습니다 (bbbbbbb)");
  expect(calls.filter(c => c.path.endsWith("/commits"))).toHaveLength(1);
  expect(editor.changes()).toEqual([]);
});
