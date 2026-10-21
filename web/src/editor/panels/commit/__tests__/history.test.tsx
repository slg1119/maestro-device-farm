import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import type { WorkspaceCommit } from "../../../../api/types";
import { saveSettings } from "../../../../lib/settings";
import { apiErrorResponse, jsonResponse, mockApi, type MockRequest } from "../../../../test/api";
import { workspace } from "../../../../test/fixtures";
import { renderPage } from "../../../../test/render";
import { EditorProvider, useEditor, type EditorApi } from "../../../store";
import { HistoryPanel } from "../../HistoryPanel";

vi.mock("@monaco-editor/react", () => ({ DiffEditor: (props: { original: string; modified: string; options: { readOnly: boolean } }) => <pre data-testid="diff" data-readonly={String(props.options.readOnly)}>{props.original}{" → "}{props.modified}</pre> }));
vi.mock("../../../monacoSetup", () => ({ ensureMonaco: () => Promise.resolve({}) }));
const ws = workspace(); const old = "b".repeat(40); const restored = "c".repeat(40);
let editor: EditorApi;
function Probe() { editor = useEditor(); return null; }
function commit(n: number, overrides: Partial<WorkspaceCommit> = {}): WorkspaceCommit { return { sha: n.toString(16).padStart(40, "0"), author_name: "maestro-device-farm", author_email: "farm@example.com", authored_at: "2026-10-20T10:00:00+09:00", message: `변경 ${n}\n\nCo-authored-by: 작업자 <human@example.com>`, co_authors: [{ name: "작업자", email: "human@example.com" }], files_changed: 2, ...overrides }; }
function setup(overrides: Parameters<typeof mockApi>[0] = {}) {
  saveSettings({ token: "", authorName: "테스터", authorEmail: "tester@example.com" });
  const mock = mockApi({
    "GET /api/v1/workspaces/ws1/tree": { sha: ws.head_sha, files: [{ path: "flow.yaml", size: 10 }] },
    "GET /api/v1/workspaces/ws1/history": { sha: ws.head_sha, commits: [commit(1, { sha: old })] },
    "GET /api/v1/workspaces/ws1/diff": (r: MockRequest) => ({ from: r.search.get("from"), to: r.search.get("to"), files: [{ path: "flow.yaml", status: "modified" }, { path: "new.yaml", status: "added" }, { path: "gone.yaml", status: "deleted" }] }),
    "GET /api/v1/workspaces/ws1/files/flow.yaml": (r: MockRequest) => new Response(r.search.get("ref") === old ? "- back" : "- scroll"),
    "GET /api/v1/workspaces/ws1/files/new.yaml": () => new Response("- scroll"),
    "GET /api/v1/workspaces/ws1/files/gone.yaml": () => new Response("- back"),
    "POST /api/v1/workspaces/ws1/restore": jsonResponse(201, { sha: restored, parent: ws.head_sha }),
    "POST /api/v1/workspaces/ws1/validate": { valid: true, issues: [] },
    ...overrides,
  });
  return { ...mock, ...renderPage(<EditorProvider workspace={ws}><Probe /><HistoryPanel /></EditorProvider>), user: userEvent.setup() };
}

test("history pages at 50 with human co-author for the bot, preserves human authors", async () => {
  const { user, calls } = setup({ "GET /api/v1/workspaces/ws1/history": (r: MockRequest) => ({ sha: ws.head_sha, commits: r.search.get("offset") === "50" ? [commit(51, { author_name: "직접 작성자" })] : Array.from({ length: 50 }, (_, i) => commit(i + 1)) }) });
  await screen.findByText("변경 1"); expect(screen.getAllByText("작업자")).toHaveLength(50);
  await user.click(screen.getByRole("button", { name: "더 보기" }));
  await screen.findByText("변경 51"); expect(screen.getByText("직접 작성자")).toBeInTheDocument();
  expect(calls.filter(c => c.path.endsWith("/history")).map(c => [c.search.get("limit"), c.search.get("offset"), c.search.get("ref")])).toEqual([["50", "0", ws.head_sha], ["50", "50", ws.head_sha]]);
  expect(screen.queryByRole("button", { name: "더 보기" })).not.toBeInTheDocument();
});

test("one selection compares to head; two selections compare their files read-only", async () => {
  const { user, calls } = setup({ "GET /api/v1/workspaces/ws1/history": { sha: ws.head_sha, commits: [commit(1, { sha: old }), commit(2)] } });
  await user.click(await screen.findByRole("checkbox", { name: /bbbbbbb.*변경 1/ }));
  await screen.findByRole("button", { name: /M.*flow.yaml/ });
  expect(await screen.findByTestId("diff")).toHaveTextContent("- back → - scroll");
  expect(screen.getByTestId("diff")).toHaveAttribute("data-readonly", "true");
  await user.click(screen.getByRole("checkbox", { name: /0000000.*변경 2/ }));
  await waitFor(() => expect(calls.filter(c => c.path.endsWith("/diff")).at(-1)?.search.get("to")).toBe(commit(2).sha));
  await user.click(screen.getByRole("button", { name: /A.*new.yaml/ }));
  await waitFor(() => expect(screen.getByTestId("diff")).toHaveTextContent("→ - scroll"));
  await user.click(screen.getByRole("button", { name: /D.*gone.yaml/ }));
  await waitFor(() => expect(screen.getByTestId("diff")).toHaveTextContent("- back →"));
});

test("file scope resets paging, filters history and restore sends just the active path", async () => {
  const { user, calls } = setup(); await screen.findByText("변경 1");
  act(() => editor.openFile("flow.yaml"));
  await user.click(screen.getByRole("radio", { name: "현재 파일" }));
  await waitFor(() => expect(calls.filter(c => c.path.endsWith("/history")).at(-1)?.search.get("path")).toBe("flow.yaml"));
  await user.click(await screen.findByRole("button", { name: "이 커밋으로 되돌리기" }));
  const dialog = screen.getByRole("dialog", { name: "커밋 복원" });
  expect(dialog).toHaveTextContent("flow.yaml");
  expect(calls.some(c => c.path.endsWith("/restore"))).toBe(false);
  await user.click(within(dialog).getByRole("button", { name: "되돌리기" }));
  await screen.findByText("복원했습니다 (ccccccc)");
  expect(calls.find(c => c.path.endsWith("/restore"))?.body).toEqual({ sha: old, paths: ["flow.yaml"], author: { name: "테스터", email: "tester@example.com" } });
  expect(editor.baseSha).toBe(restored);
});

test("workspace restore confirms and keeps local drafts, cancel never writes", async () => {
  const { user, calls } = setup(); await screen.findByText("변경 1");
  act(() => editor.setContent("flow.yaml", "- tapOn: 시작"));
  await user.click(screen.getByRole("button", { name: "이 커밋으로 되돌리기" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "취소" }));
  expect(calls.some(c => c.path.endsWith("/restore"))).toBe(false);
  await user.click(screen.getByRole("button", { name: "이 커밋으로 되돌리기" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("임시 변경");
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "되돌리기" }));
  await screen.findByText(/복원했습니다 \(ccccccc\).*임시 변경 확인: flow.yaml/);
  expect(calls.find(c => c.path.endsWith("/restore"))?.body).toEqual({ sha: old, paths: null, author: { name: "테스터", email: "tester@example.com" } });
  expect(editor.changes()).toHaveLength(1);
});

test("history errors and restore failures are inline", async () => {
  const { user } = setup({ "POST /api/v1/workspaces/ws1/restore": apiErrorResponse(403, "branch_protected", "보호된 브랜치") });
  await user.click(await screen.findByRole("button", { name: "이 커밋으로 되돌리기" }));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "되돌리기" }));
  await screen.findByText(/branch_protected/); expect(editor.baseSha).toBe(ws.head_sha);
});
