import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import { apiFetch, apiJson, query } from "../api/client";
import { keys } from "../api/queries";
import type { Change, DiffResult, Issue, Reservation, ValidateResult, Workspace, WorkspaceTree } from "../api/types";
import { useCanWrite } from "../components/Layout";
import { getSettings } from "../lib/settings";

export type DraftStatus = "modified" | "added" | "deleted";
export interface DraftEntry { status: DraftStatus; content?: string; encoding?: "utf-8" | "base64"; movedFrom?: string }
export interface SelectorCandidate { kind: "id" | "text" | "accessibilityText"; value: string; note?: string }
export interface EditorApi {
  workspace: Workspace; baseSha: string; headSha: string | null;
  files: { path: string; size: number }[]; drafts: Record<string, DraftEntry>;
  openPaths: string[]; activePath: string | null; issues: Record<string, Issue[]>;
  readFile(path: string): Promise<string>; setContent(path: string, text: string): void;
  createFile(path: string, content?: string): void; deleteFile(path: string): void;
  renameFile(from: string, to: string): void; uploadMedia(path: string, file: File): Promise<void>;
  openFile(path: string): void; closeFile(path: string): void; changes(): Change[];
  discard(path?: string): void; applyChanges(changes: Change[]): void;
  rebase(newBaseSha: string): Promise<{ conflicts: string[] }>;
  insertAtCursor(text: string): void;
  snapshotSelectors: SelectorCandidate[]; setSnapshotSelectors(list: SelectorCandidate[]): void;
  reservation: Reservation | null; reserve(serial: string): Promise<void>; release(): Promise<void>;
  appChoice: { app_build_id?: string; app?: string }; setAppChoice(c: { app_build_id?: string; app?: string }): void;
  openCommit(): void;
}
export interface EditorAdapter { insert(text: string): void; reveal?(line: number, column: number): void }
interface Runtime {
  attachEditor(adapter: EditorAdapter | null): void; validateAll(): Promise<void>;
  validating: boolean; lastCheck: Date | null; error: unknown; treeLoading: boolean;
  cursor: { line: number; column: number }; setCursor(p: { line: number; column: number }): void;
  commitOpen: boolean; closeCommit(): void; revealIssue(issue: Issue): void;
}
const EditorContext = createContext<EditorApi | null>(null);
const RuntimeContext = createContext<Runtime | null>(null);
export function useEditor(): EditorApi { const value = useContext(EditorContext); if (!value) throw new Error("EditorProvider가 필요합니다"); return value; }
export function useEditorRuntime(): Runtime { return useContext(RuntimeContext)!; }
export const encodedPath = (path: string) => path.split("/").map(encodeURIComponent).join("/");
export function validPath(path: string): string {
  const value = path.trim();
  if (!value || value.startsWith("/") || /[\\\x00-\x1f]/.test(value) || value.split("/").some(p => !p || p === "." || p === ".." || p === ".git")) throw new Error("워크스페이스 안의 올바른 파일 경로를 입력하세요.");
  return value;
}
const draftKey = (id: string, sha: string) => `farm.drafts.${id}.${sha}`;
function restoreDrafts(key: string): Record<string, DraftEntry> {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    const result: Record<string, DraftEntry> = {};
    for (const [path, value] of Object.entries(data)) {
      validPath(path);
      if (!value || typeof value !== "object") continue;
      const entry = value as DraftEntry;
      if (!["modified", "added", "deleted"].includes(entry.status)) continue;
      if (entry.content !== undefined && typeof entry.content !== "string") continue;
      if (entry.movedFrom) validPath(entry.movedFrom);
      result[path] = entry;
    }
    return result;
  } catch { return {}; }
}
export function draftChanges(drafts: Record<string, DraftEntry>): Change[] {
  const moves = Object.entries(drafts).filter(([, d]) => d.movedFrom && d.content === undefined && d.status !== "deleted");
  const movedSources = new Set(moves.map(([, d]) => d.movedFrom));
  return Object.entries(drafts).flatMap(([path, d]): Change[] => {
    if (movedSources.has(path)) return [];
    if (d.status === "deleted") return [{ op: "delete", path }];
    if (d.movedFrom && d.content === undefined) return [{ op: "move", path: d.movedFrom, to: path }];
    return [{ op: "put", path, content: d.content ?? "", encoding: d.encoding ?? "utf-8" }];
  });
}

export function EditorProvider({ workspace, baseSha: initialBase, children }: { workspace: Workspace; baseSha?: string; children: ReactNode }): JSX.Element {
  const client = useQueryClient(); const canWrite = useCanWrite();
  const [baseSha, setBaseSha] = useState(initialBase ?? workspace.head_sha ?? "");
  const [drafts, setDrafts] = useState(() => restoreDrafts(draftKey(workspace.id, initialBase ?? workspace.head_sha ?? "")));
  const activeStorageKey = useRef(draftKey(workspace.id, baseSha)); activeStorageKey.current = draftKey(workspace.id, baseSha);
  const draftRef = useRef(drafts); draftRef.current = drafts;
  const [openPaths, setOpenPaths] = useState<string[]>([]); const [activePath, setActivePath] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, Issue[]>>({});
  const [error, setError] = useState<unknown>(null); const [validating, setValidating] = useState(false);
  const [lastCheck, setLastCheck] = useState<Date | null>(null); const [commitOpen, setCommitOpen] = useState(false);
  const [snapshotSelectors, setSnapshotSelectors] = useState<SelectorCandidate[]>([]);
  const [cursor, setCursor] = useState({ line: 1, column: 1 }); const adapter = useRef<EditorAdapter | null>(null);
  const [appChoice, setAppChoice] = useState<{ app_build_id?: string; app?: string }>(() => workspace.default_app_package ? { app: `${workspace.default_app_package}@latest` } : {});
  const tree = useQuery({ queryKey: keys.workspaceTree(workspace.id, baseSha), queryFn: () => apiJson<WorkspaceTree>(`/workspaces/${encodeURIComponent(workspace.id)}/tree${query({ ref: baseSha })}`), enabled: Boolean(baseSha) });
  const originalPaths = new Set(tree.data?.files.map(f => f.path));
  const originalRef = useRef(originalPaths); originalRef.current = originalPaths;
  const files = [...(tree.data?.files ?? []), ...Object.keys(drafts).filter(path => !originalPaths.has(path)).map(path => ({ path, size: drafts[path]?.content?.length ?? 0 }))].sort((a, b) => a.path.localeCompare(b.path));
  const update = (next: Record<string, DraftEntry>) => { draftRef.current = next; setDrafts(next); };
  const openFile = (path: string) => { validPath(path); setOpenPaths(paths => paths.includes(path) ? paths : [...paths, path]); setActivePath(path); };
  const closeFile = (path: string) => { setOpenPaths(paths => { const remaining = paths.filter(p => p !== path); setActivePath(active => active === path ? remaining.at(-1) ?? null : active); return remaining; }); };
  const readFile = async (path: string): Promise<string> => {
    const d = draftRef.current[path];
    if (d?.status === "deleted") throw new Error("삭제된 파일입니다.");
    if (d?.content !== undefined) return d.content;
    const source = d?.movedFrom ?? path;
    return client.fetchQuery({ queryKey: keys.workspaceFile(workspace.id, baseSha, source), staleTime: Infinity,
      queryFn: async () => (await apiFetch(`/workspaces/${encodeURIComponent(workspace.id)}/files/${encodedPath(source)}${query({ ref: baseSha })}`)).text() });
  };
  const setContent = (path: string, content: string) => {
    validPath(path); const prior = draftRef.current[path];
    if (prior?.content === content && prior.status !== "deleted") return;
    const baseContent = client.getQueryData<string>(keys.workspaceFile(workspace.id, baseSha, path));
    if (!prior?.movedFrom && originalRef.current.has(path) && baseContent === content) {
      const next = { ...draftRef.current }; delete next[path]; update(next); setIssues(all => ({ ...all, [path]: [] })); return;
    }
    update({ ...draftRef.current, [path]: { ...prior, status: originalRef.current.has(path) ? "modified" : "added", content, encoding: "utf-8" } });
  };
  const createFile = (path: string, content = "") => {
    validPath(path); if (files.some(f => f.path === path && draftRef.current[path]?.status !== "deleted")) throw new Error("같은 경로의 파일이 있습니다.");
    setContent(path, content); openFile(path);
  };
  const deleteFile = (path: string) => {
    const next = { ...draftRef.current };
    if (originalRef.current.has(path)) next[path] = { status: "deleted" }; else delete next[path];
    update(next); setIssues(all => ({ ...all, [path]: [] })); closeFile(path);
  };
  const renameFile = (from: string, to: string) => {
    validPath(to); if (from === to) return;
    if (files.some(f => f.path === to && draftRef.current[to]?.status !== "deleted")) throw new Error("같은 경로의 파일이 있습니다.");
    const source = draftRef.current[from]; const next = { ...draftRef.current };
    next[to] = { ...source, status: originalRef.current.has(to) ? "modified" : "added", movedFrom: source?.movedFrom ?? (originalRef.current.has(from) ? from : undefined) };
    if (next[to]?.movedFrom === to) {
      if (next[to]?.content === undefined) delete next[to];
      else delete next[to]!.movedFrom;
    }
    if (originalRef.current.has(from)) next[from] = { status: "deleted" }; else delete next[from];
    update(next); setIssues(all => ({ ...all, [from]: [], [to]: [] })); closeFile(from); openFile(to);
  };
  const applyChanges = (changes: Change[]) => {
    for (const c of changes) {
      if (c.op === "delete") deleteFile(c.path);
      else if (c.op === "move" && c.to) renameFile(c.path, c.to);
      else if (c.op === "put") { validPath(c.path); update({ ...draftRef.current, [c.path]: { status: originalRef.current.has(c.path) ? "modified" : "added", content: c.content ?? "", encoding: c.encoding ?? "utf-8" } }); }
    }
  };
  const discard = (path?: string) => {
    if (!path) { update({}); setIssues({}); return; }
    const next = { ...draftRef.current }; const source = next[path]?.movedFrom;
    delete next[path]; if (source) delete next[source];
    for (const [p, d] of Object.entries(next)) if (d.movedFrom === path) delete next[p];
    update(next); setIssues(all => ({ ...all, [path]: [] }));
  };
  const uploadMedia = async (path: string, file: File) => {
    validPath(path); if (file.size > 10 * 1024 * 1024) throw new Error("미디어는 10 MB 이하여야 합니다.");
    if (!/\.(png|jpe?g|gif|webp|mp4|mov|mp3|wav)$/i.test(path)) throw new Error("지원하는 이미지, 동영상, 오디오 파일을 선택하세요.");
    const content = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error("파일을 읽지 못했습니다.")); reader.onload = () => resolve(String(reader.result).split(",")[1] ?? ""); reader.readAsDataURL(file); });
    applyChanges([{ op: "put", path, content, encoding: "base64" }]); openFile(path);
  };
  const validate = async (entries: Record<string, DraftEntry>) => {
    const changes = draftChanges(entries); if (!changes.length || !canWrite) return;
    setValidating(true); setError(null);
    try {
      const result = await apiJson<ValidateResult>(`/workspaces/${encodeURIComponent(workspace.id)}/validate`, { method: "POST", json: { changes } });
      setIssues(previous => { const next = { ...previous }; for (const [path, entry] of Object.entries(entries)) if (draftRef.current[path] === entry) next[path] = result.issues.filter(i => i.path === path); return next; });
      setLastCheck(new Date());
    } catch (e) { setError(e); } finally { setValidating(false); }
  };
  const validateRef = useRef(validate); validateRef.current = validate;
  const previousValidation = useRef<Record<string, DraftEntry>>({});
  useEffect(() => {
    const timer = setTimeout(() => {
      const changed = Object.fromEntries(Object.entries(drafts).filter(([p, d]) => d !== previousValidation.current[p] && d.status !== "deleted" && d.content !== undefined));
      previousValidation.current = drafts;
      for (const [path, entry] of Object.entries(changed)) void validateRef.current({ [path]: entry });
    }, 600);
    return () => clearTimeout(timer);
  }, [drafts]);
  const persist = () => { try { if (Object.keys(draftRef.current).length) localStorage.setItem(activeStorageKey.current, JSON.stringify(draftRef.current)); else localStorage.removeItem(activeStorageKey.current); } catch { setError(new Error("임시 변경을 브라우저에 저장하지 못했습니다.")); } };
  const persistRef = useRef(persist); persistRef.current = persist;
  useEffect(() => {
    const timer = setTimeout(() => persistRef.current(), 250);
    return () => clearTimeout(timer);
  }, [drafts, baseSha]);
  useEffect(() => {
    const flush = () => persistRef.current();
    window.addEventListener("pagehide", flush);
    return () => { window.removeEventListener("pagehide", flush); flush(); };
  }, [workspace.id]);
  useEffect(() => {
    const leaving = (event: BeforeUnloadEvent) => { if (Object.keys(draftRef.current).length) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", leaving); return () => window.removeEventListener("beforeunload", leaving);
  }, []);
  const rebase = async (newBaseSha: string) => {
    const diff = await apiJson<DiffResult>(`/workspaces/${encodeURIComponent(workspace.id)}/diff${query({ from: baseSha, to: newBaseSha })}`);
    const upstream = new Set(diff.files.map(f => f.path));
    const conflicts = Object.entries(draftRef.current).filter(([path, d]) => upstream.has(path) || (d.movedFrom && upstream.has(d.movedFrom))).map(([path]) => path);
    await client.fetchQuery({ queryKey: keys.workspaceTree(workspace.id, newBaseSha), queryFn: () => apiJson<WorkspaceTree>(`/workspaces/${encodeURIComponent(workspace.id)}/tree${query({ ref: newBaseSha })}`) });
    try { localStorage.setItem(draftKey(workspace.id, newBaseSha), JSON.stringify(draftRef.current)); localStorage.removeItem(draftKey(workspace.id, baseSha)); } catch { /* Existing in-memory drafts remain available. */ }
    activeStorageKey.current = draftKey(workspace.id, newBaseSha); setBaseSha(newBaseSha); setIssues({}); return { conflicts };
  };

  const [reservation, setReservation] = useState<Reservation | null>(null);
  const reservationRef = useRef<Reservation | null>(null); const reserving = useRef(false);
  const mounted = useRef(true);
  const sessionKey = `farm.reservation.${workspace.id}`;
  const rememberReservation = (value: Reservation | null) => { reservationRef.current = value; setReservation(value); try { if (value) sessionStorage.setItem(sessionKey, JSON.stringify(value)); else sessionStorage.removeItem(sessionKey); } catch { /* Session storage may be blocked. */ } };
  const release = async () => { const current = reservationRef.current; if (!current) return; await apiJson(`/reservations/${encodeURIComponent(current.id)}`, { method: "DELETE" }); rememberReservation(null); void client.invalidateQueries({ queryKey: keys.devices }); };
  const reserve = async (serial: string) => {
    if (!canWrite) throw new Error("쓰기 작업에는 API 토큰이 필요합니다.");
    if (reserving.current) return; reserving.current = true;
    try { await release(); const value = await apiJson<Reservation>(`/devices/${encodeURIComponent(serial)}/reservations`, { method: "POST", json: { holder_name: getSettings().authorName || "에디터" } }); if (!mounted.current) { await apiFetch(`/reservations/${encodeURIComponent(value.id)}`, { method: "DELETE", keepalive: true }); return; } rememberReservation(value); void client.invalidateQueries({ queryKey: keys.devices }); }
    finally { reserving.current = false; }
  };
  const rememberRef = useRef(rememberReservation); rememberRef.current = rememberReservation;
  useEffect(() => {
    let alive = true; mounted.current = true;
    try { const saved = sessionStorage.getItem(sessionKey); if (saved) { const stored = JSON.parse(saved) as Reservation; if (stored.id && stored.status === "active") { rememberRef.current(stored); void apiJson<Reservation>(`/reservations/${encodeURIComponent(stored.id)}/renew`, { method: "POST" }).then(r => { if (alive && reservationRef.current?.id === stored.id) rememberRef.current(r); }).catch(() => { if (alive && reservationRef.current?.id === stored.id) rememberRef.current(null); }); } } } catch { /* Ignore corrupt session data. */ }
    const timer = setInterval(() => { const current = reservationRef.current; if (current) void apiJson<Reservation>(`/reservations/${encodeURIComponent(current.id)}/renew`, { method: "POST" }).then(r => { if (alive && reservationRef.current?.id === current.id) rememberRef.current(r); }).catch(e => { if (alive) { setError(e); rememberRef.current(null); } }); }, 60_000);
    const releaseOnLeave = () => { const current = reservationRef.current; if (current) { reservationRef.current = null; void apiFetch(`/reservations/${encodeURIComponent(current.id)}`, { method: "DELETE", keepalive: true }).catch(() => {}); try { sessionStorage.removeItem(sessionKey); } catch { /* Best effort. */ } } };
    window.addEventListener("pagehide", releaseOnLeave);
    return () => { alive = false; mounted.current = false; clearInterval(timer); window.removeEventListener("pagehide", releaseOnLeave); releaseOnLeave(); };
  }, [sessionKey]);
  const api: EditorApi = { workspace, baseSha, headSha: workspace.head_sha, files, drafts, openPaths, activePath, issues, readFile, setContent, createFile, deleteFile, renameFile, uploadMedia, openFile, closeFile, changes: () => draftChanges(draftRef.current), discard, applyChanges, rebase, insertAtCursor: text => { if (activePath) adapter.current?.insert(text); }, snapshotSelectors, setSnapshotSelectors, reservation, reserve, release, appChoice, setAppChoice, openCommit: () => setCommitOpen(true) };
  const runtime: Runtime = { attachEditor: value => { adapter.current = value; }, validateAll: () => validateRef.current(draftRef.current), validating, lastCheck, error: error ?? tree.error, treeLoading: tree.isLoading, cursor, setCursor, commitOpen, closeCommit: () => setCommitOpen(false), revealIssue: issue => { openFile(issue.path); setTimeout(() => adapter.current?.reveal?.(issue.line ?? 1, issue.column ?? 1), 0); } };
  return <EditorContext.Provider value={api}><RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider></EditorContext.Provider>;
}
