import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { useLocation } from "react-router";
import { expect, test, vi } from "vitest";
import { apiErrorResponse, mockApi } from "../../../test/api";
import { workspace } from "../../../test/fixtures";
import { renderPage } from "../../../test/render";
import { EditorProvider, useEditor, type EditorApi } from "../../store";
import { RecordingDraftImport } from "./RecordingDraftImport";
import { RecordingLiveView } from "./RecordingLiveView";

const ts = "2026-10-21T05:00:00Z";
const done = { id: "rec1", device_serial: "s1", status: "done", workspace_id: "ws1", steps: [], yaml: "appId: org.example\n---\n- back\n", ai_job_id: null, created_at: ts, finished_at: ts };
let api: EditorApi;
function Probe() { api = useEditor(); const location = useLocation(); return <span aria-label="주소">{location.search}</span>; }
vi.mock("../../../components/live/LiveView", () => ({ LiveView: (props: { serial: string; workspace: { name: string }; appPackage?: string; onRecordingComplete: (recording: unknown) => void }) => <><span>{props.serial} · {props.workspace.name} · {props.appPackage}</span><button onClick={() => props.onRecordingComplete(done)}>YAML 결과</button><button onClick={() => props.onRecordingComplete({ ...done, ai_job_id: "ai1" })}>AI 결과</button></> }));

function setup(recording: unknown = done, route = "/editor/example-app?draft=rec1") {
  const mock = mockApi({ "GET /api/v1/workspaces/ws1/tree": { files: [] }, "GET /api/v1/recordings/rec1": recording });
  const onImported = vi.fn();
  const view = renderPage(<EditorProvider workspace={workspace({ default_app_package: "org.example" })}><Probe /><RecordingDraftImport onImported={onImported} /><RecordingLiveView serial="s1" onImported={onImported} /></EditorProvider>, { route });
  return { ...view, ...mock, onImported };
}

test("draft query fetches the recording, imports YAML once, opens its tab and consumes the parameter", async () => {
  const view = setup();
  await waitFor(() => expect(api.activePath).toMatch(/^flows\/recorded-\d{8}-\d{4}\.yaml$/));
  expect(await api.readFile(api.activePath!)).toBe(done.yaml);
  expect(api.openPaths).toContain(api.activePath);
  expect(screen.getByLabelText("주소")).not.toHaveTextContent("draft=");
  expect(view.calls.filter(c => c.path.endsWith("/rec1"))).toHaveLength(1);
  expect(view.onImported).toHaveBeenCalledOnce();
});

test.each([
  ["unknown", () => apiErrorResponse(404, "recording_not_found")],
  ["not done", { ...done, status: "active", yaml: null }],
  ["foreign workspace", { ...done, workspace_id: "other" }],
])("%s recordings show Korean feedback without importing anything", async (_name, recording) => {
  setup(recording);
  expect(await screen.findByRole("status")).toHaveTextContent(/녹화/);
  expect(api.drafts).toEqual({}); expect(api.openPaths).toEqual([]);
  expect(screen.getByLabelText("주소")).not.toHaveTextContent("draft=");
});

test("editor live recording uses the workspace/app and opens either a draft or the existing AI job flow", async () => {
  const view = setup(done, "/editor/example-app");
  await waitFor(() => expect(api.files).toEqual([]));
  expect(screen.getByText("s1 · example-app · org.example")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "YAML 결과" }));
  await waitFor(() => expect(api.activePath).toMatch(/^flows\/recorded-/));
  expect(await api.readFile(api.activePath!)).toBe(done.yaml);
  expect(view.onImported).toHaveBeenCalledOnce();
  act(() => api.discard());
  fireEvent.click(screen.getByRole("button", { name: "AI 결과" }));
  expect(screen.getByLabelText("주소")).toHaveTextContent("aiJob=ai1");
  expect(api.drafts).toEqual({});
});
