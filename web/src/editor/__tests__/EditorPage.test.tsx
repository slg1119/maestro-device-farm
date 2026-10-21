import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { EditorPage } from "../EditorPage";
import { apiErrorResponse, mockApi } from "../../test/api";
import { workspace } from "../../test/fixtures";
import { renderPage } from "../../test/render";
vi.mock("../code/CodeEditor", () => ({ CodeEditor: () => <div>코드 편집기</div> }));
const ws = workspace();
function setup(head = ws.head_sha!, route = "/editor/example-app?file=flow.yaml") {
  mockApi({
    "GET /api/v1/workspaces": [{ ...ws, head_sha: head }],
    "GET /api/v1/ai/status": { enabled: false },
    "GET /api/v1/workspaces/ws1/tree": { sha: ws.head_sha, files: [{ path: "flow.yaml", size: 1 }] },
    "GET /api/v1/workspaces/ws1/diff": { files: [{ path: "flow.yaml", status: "modified" }] },
    "POST /api/v1/workspaces/ws1/validate": { valid: false, issues: [{ path: "new.yaml", message: "YAML: bad", line: 1, column: 1 }] },
  });
  return renderPage(<EditorPage />, { route, path: "/editor/:workspace" });
}
test("tree actions create badges, rename and delete without committing; AI stays hidden", async () => {
  const user = userEvent.setup(); setup();
  await screen.findByRole("button", { name: "새 파일" });
  expect(screen.queryByRole("tab", { name: "AI" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "새 파일" }));
  await user.type(screen.getByLabelText("파일 경로"), "new.yaml");
  await user.click(screen.getByRole("button", { name: "만들기" }));
  const tree = screen.getByRole("tree", { name: "파일" });
  expect(within(tree).getByText("A")).toBeInTheDocument();
  await user.click(within(tree).getByRole("button", { name: "flow.yaml 메뉴" }));
  await user.click(screen.getByRole("menuitem", { name: "삭제" }));
  expect(within(tree).getByText("D")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "검증" }));
  await waitFor(() => expect(screen.getByRole("tab", { name: "문제 1" })).toBeInTheDocument());
});
test("remote banner fetches a new head and exposes per-file conflict choices", async () => {
  localStorage.setItem(`farm.drafts.ws1.${ws.head_sha}`, JSON.stringify({ "flow.yaml": { status: "modified", content: "- back" } }));
  setup("b".repeat(40), `/editor/example-app?base=${ws.head_sha}`);
  await screen.findByText(/원격 main에 새 커밋/);
  fireEvent.click(screen.getByRole("button", { name: "가져오기" }));
  await screen.findByRole("button", { name: "내 변경 유지" });
  fireEvent.click(screen.getByRole("button", { name: "원격 내용으로 바꾸기" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "내 변경 유지" })).not.toBeInTheDocument());
});

test("an unavailable AI endpoint disables AI after one request even when queries retry", async () => {
  const mock = mockApi({
    "GET /api/v1/workspaces": [ws],
    "GET /api/v1/workspaces/ws1/tree": { files: [{ path: "flow.yaml", size: 1 }] },
    "GET /api/v1/ai/status": () => apiErrorResponse(404, "not_found"),
  });
  const view = renderPage(<EditorPage />, { route: "/editor/example-app", path: "/editor/:workspace" });
  view.client.setDefaultOptions({ queries: { retry: 3, retryDelay: 1 } });
  await screen.findByRole("tree", { name: "파일" });
  await waitFor(() => expect(view.client.getQueryState(["ai-status"])?.fetchStatus).toBe("idle"));
  expect(mock.calls.filter(call => call.path === "/api/v1/ai/status")).toHaveLength(1);
  expect(screen.queryByRole("tab", { name: "AI" })).not.toBeInTheDocument();
});

test("file menus remain reachable with the keyboard", async () => {
  const user = userEvent.setup(); setup();
  const row = await screen.findByRole("treeitem", { name: "flow.yaml" });
  within(row).getByRole("button", { name: "flow.yaml" }).focus();
  await user.tab();
  expect(within(row).getByRole("button", { name: "flow.yaml 메뉴" })).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(screen.getByRole("menuitem", { name: "이름 변경" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(within(row).getByRole("button", { name: "flow.yaml 메뉴" })).toHaveFocus();
});
