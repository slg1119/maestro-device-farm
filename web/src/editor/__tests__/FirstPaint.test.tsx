import { screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";
import { mockApi } from "../../test/api";
import { workspace } from "../../test/fixtures";
import { renderPage } from "../../test/render";

const code = vi.hoisted(() => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  return { pending, release };
});
vi.mock("../code/CodeEditor", async () => {
  await code.pending;
  return { CodeEditor: () => <div>코드 준비됨</div> };
});

test("tree and breadcrumb render while the Monaco module and AI status are pending", async () => {
  mockApi({
    "GET /api/v1/workspaces": [workspace()],
    "GET /api/v1/workspaces/ws1/tree": { files: [{ path: "flow.yaml", size: 1 }] },
    "GET /api/v1/ai/status": () => new Promise(() => {}),
  });
  let page: typeof import("../EditorPage") | undefined;
  const loaded = import("../EditorPage").then(value => { page = value; });
  try {
    await waitFor(() => expect(page).toBeDefined());
    const EditorPage = page!.EditorPage;
    renderPage(<EditorPage />, { route: "/editor/example-app?file=flow.yaml", path: "/editor/:workspace" });
    expect(await within(await screen.findByRole("tree", { name: "파일" })).findByRole("button", { name: "flow.yaml" })).toBeInTheDocument();
    expect(screen.getByText("example-app / flow.yaml")).toBeInTheDocument();
    expect(screen.getByText("편집기를 불러오는 중…")).toBeInTheDocument();
    expect(screen.queryByText("코드 준비됨")).not.toBeInTheDocument();
  } finally {
    code.release();
    await loaded;
  }
});
