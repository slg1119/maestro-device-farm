import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { mockApi } from "../../test/api";
import { workspace } from "../../test/fixtures";
import { renderPage } from "../../test/render";
import { EditorProvider, useEditor, type EditorApi } from "../store";
import { CodeEditor } from "../code/CodeEditor";
import { editorAdapter } from "../code/adapter";
import type { editor } from "monaco-editor";

const markerApi = vi.hoisted(() => ({ setModelMarkers: vi.fn(), dispose: vi.fn() }));
vi.mock("monaco-editor/editor/contrib/codeAction/browser/codeActionContributions", () => ({}));
vi.mock("../monacoSetup", () => ({ ensureMonaco: async () => ({
  languages: { getLanguages: () => [{ id: "yaml" }], registerCompletionItemProvider: () => ({ dispose() {} }), registerHoverProvider: () => ({ dispose() {} }), registerCodeActionProvider: () => ({ dispose() {} }) },
  editor: { setModelMarkers: markerApi.setModelMarkers },
}) }));
vi.mock("@monaco-editor/react", async () => {
  const { useEffect } = await import("react");
  return { default: (props: { value: string; path: string; onChange(value: string): void; onMount: (instance: unknown, lib: unknown) => void }) => {
    useEffect(() => {
      const model = { uri: { toString: () => props.path }, dispose: markerApi.dispose };
      props.onMount({ getModel: () => model, onDidChangeCursorPosition: () => ({ dispose() {} }), onDidDispose() {}, addCommand() {} }, { KeyMod: { CtrlCmd: 1 }, KeyCode: { KeyS: 2 }, editor: { setModelMarkers: markerApi.setModelMarkers } });
    }, []);
    return <textarea aria-label="YAML 코드" value={props.value} onChange={e => props.onChange(e.target.value)} />;
  } };
});
let api: EditorApi;
function Probe() { api = useEditor(); return <CodeEditor />; }
test("debounced server validation becomes markers on the active model", async () => {
  const mock = mockApi({
    "GET /api/v1/workspaces/ws1/tree": { files: [{ path: "flow.yaml", size: 1 }] },
    "GET /api/v1/workspaces/ws1/files/flow.yaml": new Response("- scroll"),
    "POST /api/v1/workspaces/ws1/validate": { valid: false, issues: [{ path: "flow.yaml", message: "Invalid Command: scrol", line: 1, column: 3 }] },
  });
  const view = renderPage(<EditorProvider workspace={workspace()}><Probe /></EditorProvider>);
  act(() => api.openFile("flow.yaml"));
  const input = await screen.findByLabelText("YAML 코드");
  fireEvent.change(input, { target: { value: "- scrol" } });
  await waitFor(() => expect(markerApi.setModelMarkers).toHaveBeenCalledWith(expect.anything(), "farm-validation", [expect.objectContaining({ message: "Invalid Command: scrol", startColumn: 3 })]));
  expect(mock.calls.find(c => c.method === "POST")?.body).toEqual({ changes: [{ op: "put", path: "flow.yaml", content: "- scrol", encoding: "utf-8" }] });
  view.unmount(); expect(markerApi.dispose).toHaveBeenCalled();
});

test("Monaco insertion brackets exactly one edit with undo stops", () => {
  const fake = { getSelection: () => ({ startLineNumber: 2 }), pushUndoStop: vi.fn(), executeEdits: vi.fn(), focus: vi.fn() };
  editorAdapter(fake as unknown as editor.IStandaloneCodeEditor).insert("- back");
  expect(fake.pushUndoStop).toHaveBeenCalledTimes(2); expect(fake.executeEdits).toHaveBeenCalledExactlyOnceWith("farm-insert", [expect.objectContaining({ text: "- back" })]);
});
