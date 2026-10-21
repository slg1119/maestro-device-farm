import { act, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { EditorProvider, useEditor, useEditorRuntime, type EditorApi } from "../store";
import { mockApi } from "../../test/api";
import { workspace } from "../../test/fixtures";
import { renderPage } from "../../test/render";

const ws = workspace();
let api: EditorApi;
let runtime: ReturnType<typeof useEditorRuntime>;
function Probe() { api = useEditor(); runtime = useEditorRuntime(); return <div>{api.files.length}개 파일</div>; }
function setup() {
  const mock = mockApi({
    "GET /api/v1/workspaces/ws1/tree": { sha: ws.head_sha, files: [{ path: "flow.yaml", size: 12 }, { path: "old.yaml", size: 12 }] },
    "GET /api/v1/workspaces/ws1/files/flow.yaml": new Response("- scroll"),
    "GET /api/v1/workspaces/ws1/files/old.yaml": new Response("- back"),
    "POST /api/v1/workspaces/ws1/validate": { valid: true, issues: [] },
    "GET /api/v1/workspaces/ws1/diff": { from: ws.head_sha, to: "b".repeat(40), files: [{ path: "flow.yaml", status: "modified" }] },
    "POST /api/v1/devices/d1/reservations": reservation,
    "POST /api/v1/reservations/r1/renew": reservation,
    "DELETE /api/v1/reservations/r1": { ...reservation, status: "released" },
  });
  const result = renderPage(<EditorProvider workspace={ws}><Probe /></EditorProvider>);
  return { ...result, ...mock };
}
const reservation = { id: "r1", device_serial: "d1", holder_name: "에디터", status: "active", created_at: "2026-10-21", expires_at: "2026-10-22", released_at: null };

test("draft add, modify, delete and rename become non-overlapping server changes", async () => {
  setup(); await waitFor(() => expect(api.files).toHaveLength(2));
  await act(async () => { await api.readFile("flow.yaml"); });
  act(() => { api.setContent("flow.yaml", "- swipe"); api.createFile("new.yaml", "- back"); api.renameFile("flow.yaml", "renamed.yaml"); api.deleteFile("old.yaml"); });
  await waitFor(() => expect(api.changes()).toEqual(expect.arrayContaining([
    { op: "delete", path: "flow.yaml" }, { op: "delete", path: "old.yaml" },
    { op: "put", path: "renamed.yaml", content: "- swipe", encoding: "utf-8" },
    { op: "put", path: "new.yaml", content: "- back", encoding: "utf-8" },
  ])));
  expect(await api.readFile("renamed.yaml")).toBe("- swipe");
  act(() => api.discard()); expect(api.changes()).toEqual([]);
});

test("persists drafts across remount and protects leaving with drafts", async () => {
  const first = setup(); await waitFor(() => expect(api.files).toHaveLength(2));
  act(() => api.createFile("new.yaml", "- back"));
  await waitFor(() => expect(localStorage.getItem(`farm.drafts.ws1.${ws.head_sha}`)).toContain("new.yaml"));
  const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
  first.unmount(); setup(); await waitFor(() => expect(api.drafts["new.yaml"]?.content).toBe("- back"));
});

test("rebase detects upstream edits to drafts and preserves local content", async () => {
  setup(); await waitFor(() => expect(api.files).toHaveLength(2));
  act(() => api.setContent("flow.yaml", "- back"));
  let conflicts: string[] = [];
  await act(async () => { conflicts = (await api.rebase("b".repeat(40))).conflicts; });
  expect(conflicts).toEqual(["flow.yaml"]); expect(api.baseSha).toBe("b".repeat(40)); expect(await api.readFile("flow.yaml")).toBe("- back");
});

test("reservation renews every minute and releases on unmount", async () => {
  vi.useFakeTimers();
  const view = setup(); await act(async () => { await vi.advanceTimersByTimeAsync(10); });
  await act(async () => api.reserve("d1"));
  try { await act(async () => { await vi.advanceTimersByTimeAsync(60_000); }); expect(view.calls.some(c => c.path === "/api/v1/reservations/r1/renew")).toBe(true); }
  finally { vi.useRealTimers(); }
  view.unmount(); await waitFor(() => expect(view.calls.some(c => c.method === "DELETE" && c.path.endsWith("/r1"))).toBe(true));
});

test("cursor insertion delegates one undoable edit to the active editor adapter", async () => {
  setup(); await waitFor(() => expect(api.files).toHaveLength(2));
  const insert = vi.fn(); act(() => { api.openFile("flow.yaml"); runtime.attachEditor({ insert }); });
  act(() => api.insertAtCursor("- tapOn: 로그인")); expect(insert).toHaveBeenCalledExactlyOnceWith("- tapOn: 로그인");
});

test("renaming an untouched base file back to its original path clears the move", async () => {
  setup(); await waitFor(() => expect(api.files).toHaveLength(2));
  act(() => api.renameFile("flow.yaml", "renamed.yaml"));
  expect(api.changes()).toEqual([{ op: "move", path: "flow.yaml", to: "renamed.yaml" }]);
  act(() => api.renameFile("renamed.yaml", "flow.yaml"));
  expect(api.changes()).toEqual([]); expect(api.drafts).toEqual({});
});

test("rebase migrates persistence and remote discard survives a remount", async () => {
  const view = setup(); await waitFor(() => expect(api.files).toHaveLength(2));
  act(() => api.setContent("flow.yaml", "- back"));
  await act(async () => { await api.rebase("b".repeat(40)); });
  act(() => api.discard("flow.yaml"));
  view.unmount();
  expect(localStorage.getItem(`farm.drafts.ws1.${ws.head_sha}`)).toBeNull();
  expect(localStorage.getItem(`farm.drafts.ws1.${"b".repeat(40)}`)).toBeNull();
});

test("late reservation creation releases its device after workspace unmount", async () => {
  let resolve!: (value: unknown) => void;
  const pending = new Promise(r => { resolve = r; });
  mockApi({ "GET /api/v1/workspaces/ws1/tree": { files: [] }, "POST /api/v1/devices/d1/reservations": () => pending, "DELETE /api/v1/reservations/r1": reservation });
  const view = renderPage(<EditorProvider workspace={ws}><Probe /></EditorProvider>);
  let reserving!: Promise<void>;
  act(() => { reserving = api.reserve("d1"); });
  view.unmount(); await act(async () => { resolve(reservation); await reserving; });
  expect(fetch).toHaveBeenCalledWith("/api/v1/reservations/r1", expect.objectContaining({ method: "DELETE", keepalive: true }));
});

test("base-content undo clears the draft and media uploads use base64 with a 10 MB limit", async () => {
  setup(); await waitFor(() => expect(api.files).toHaveLength(2));
  await act(async () => { await api.readFile("flow.yaml"); });
  act(() => api.setContent("flow.yaml", "- back"));
  act(() => api.setContent("flow.yaml", "- scroll")); expect(api.drafts).toEqual({});
  await act(async () => api.uploadMedia("media/pixel.png", new File(["png"], "pixel.png", { type: "image/png" })));
  expect(api.changes()).toEqual([{ op: "put", path: "media/pixel.png", content: btoa("png"), encoding: "base64" }]);
  await expect(api.uploadMedia("media/big.png", new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.png"))).rejects.toThrow("10 MB");
});

test("session reservations resume through renew and are cleared by explicit release", async () => {
  sessionStorage.setItem("farm.reservation.ws1", JSON.stringify(reservation));
  const view = setup();
  await waitFor(() => expect(api.reservation?.id).toBe("r1"));
  expect(view.calls.some(c => c.path.endsWith("/r1/renew"))).toBe(true);
  await act(async () => api.release());
  expect(api.reservation).toBeNull(); expect(sessionStorage.getItem("farm.reservation.ws1")).toBeNull();
});

test("draft storage is debounced across consecutive edits", async () => {
  vi.useFakeTimers(); const write = vi.spyOn(Storage.prototype, "setItem"); const view = setup();
  try {
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    act(() => api.createFile("draft.yaml", "- back"));
    act(() => api.setContent("draft.yaml", "- scroll"));
    expect(write).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(write).toHaveBeenCalledTimes(1); expect(write.mock.calls[0]?.[1]).toContain("- scroll");
  } finally { view.unmount(); write.mockRestore(); vi.useRealTimers(); }
});

test("importDraft creates and opens recorded YAML while preserving existing files and drafts", async () => {
  setup(); await waitFor(() => expect(api.files).toHaveLength(2));
  let imported = "";
  act(() => { imported = api.importDraft("flows/recorded-20261021-1435.yaml", "- launchApp"); });
  expect(imported).toBe("flows/recorded-20261021-1435.yaml");
  expect(api.activePath).toBe(imported); expect(api.openPaths).toContain(imported);
  expect(await api.readFile(imported)).toBe("- launchApp");
  act(() => { imported = api.importDraft("flows/recorded-20261021-1435.yaml", "- back"); });
  expect(imported).toBe("flows/recorded-20261021-1435-2.yaml");
  expect(await api.readFile("flows/recorded-20261021-1435.yaml")).toBe("- launchApp");
  act(() => { imported = api.importDraft("flow.yaml", "- back"); });
  expect(imported).toBe("flow-2.yaml"); expect(api.drafts["flow.yaml"]).toBeUndefined();
  expect(() => api.importDraft("../escape.yaml", "- back")).toThrow();
});
