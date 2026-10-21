import { screen } from "@testing-library/react";
import { vi } from "vitest";
import { mockApi } from "../../../../test/api";
import { aiJob, workspace } from "../../../../test/fixtures";
import { renderPage } from "../../../../test/render";
import { EditorPage } from "../../../EditorPage";

vi.mock("../../../code/CodeEditor", () => ({ CodeEditor: () => <div>코드 편집기</div> }));
vi.mock("../../../monacoSetup", () => ({ ensureMonaco: async () => ({}) }));
vi.mock("@monaco-editor/react", () => ({ default: () => null, DiffEditor: () => null }));

test("an aiJob deep link opens the AI panel without requiring a tab click", async () => {
  mockApi({
    "GET /api/v1/workspaces": [workspace()],
    "GET /api/v1/workspaces/ws1/tree": { files: [] },
    "GET /api/v1/ai/status": { enabled: true, model: "gpt-6.1-sol", month_input_tokens: 0, month_output_tokens: 0 },
    "GET /api/v1/ai/jobs": [],
    "GET /api/v1/ai/jobs/ai1": aiJob({ status: "failed", error_message: "테스트 작업 실패" }),
  });
  renderPage(<EditorPage />, { route: "/editor/example-app?aiJob=ai1", path: "/editor/:workspace" });
  await screen.findByText(/테스트 작업 실패/);
  expect(screen.getByRole("tab", { name: "AI" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("button", { name: "패널" })).toHaveAttribute("aria-pressed", "true");
});
