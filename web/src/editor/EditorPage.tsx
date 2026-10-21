import { CheckCheck, ChevronDown, FileCode2, GitBranch, PanelLeft, PanelRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useAiStatus, useWorkspaces } from "../api/queries";
import type { Workspace } from "../api/types";
import { useCanWrite } from "../components/Layout";
import { Badge, Button, Card, Empty, ErrorBox, IconButton, Loading, Menu, Modal, PageHeader, Tabs, cx } from "../components/ui";
import { CodeEditor } from "./code/CodeEditor";
import { languageFor } from "./code/adapter";
import { AiPanel } from "./panels/AiPanel";
import { CommitDialog } from "./panels/CommitDialog";
import { HistoryPanel } from "./panels/HistoryPanel";
import { ProblemsPanel } from "./panels/ProblemsPanel";
import { RunPanel } from "./panels/RunPanel";
import { ScreenPanel } from "./panels/ScreenPanel";
import { ResizeHandle } from "./ResizeHandle";
import { EditorProvider, useEditor, useEditorRuntime } from "./store";
import { FileTree } from "./tree/FileTree";

function lastWorkspace(): string | null { try { return localStorage.getItem("farm.editor.workspace"); } catch { return null; } }
export function EditorPage() {
  const { workspace: selected } = useParams(); const [params] = useSearchParams(); const workspaces = useWorkspaces();
  if (workspaces.isLoading) return <Loading />;
  if (workspaces.error) return <ErrorBox error={workspaces.error} />;
  const all = workspaces.data ?? [];
  if (!selected) return <div className="min-h-0 overflow-y-auto p-4 md:p-8"><PageHeader title="에디터" description="워크스페이스를 선택해 플로우를 편집하세요." /><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[...all].sort((a, b) => Number(b.id === lastWorkspace()) - Number(a.id === lastWorkspace())).map(ws => <Link key={ws.id} to={`/editor/${encodeURIComponent(ws.name)}`} className="rounded-[10px] focus-visible:outline-accent"><Card className="h-full p-5 hover:border-accent"><FileCode2 className="mb-3 size-6 text-accent" /><h2 className="font-semibold text-fg">{ws.name}</h2><p className="mt-2 break-all text-xs text-fg-muted">{ws.repo} · {ws.branch}</p><p className="mt-2 text-xs text-fg-subtle">{ws.id === lastWorkspace() ? "최근 사용 · " : ""}{ws.head_sha?.slice(0, 7) ?? "동기화 대기"}</p></Card></Link>)}</div>{!all.length && <Empty>등록된 워크스페이스가 없습니다. <Link className="text-accent" to="/workspaces">워크스페이스 등록</Link></Empty>}</div>;
  const ws = all.find(w => w.name === selected || w.id === selected);
  if (!ws) return <Empty>워크스페이스를 찾을 수 없습니다. <Link to="/editor" className="text-accent">다시 선택</Link></Empty>;
  if (!ws.head_sha && !params.get("base")) return <Empty>워크스페이스 동기화가 필요합니다. <Link to="/workspaces" className="text-accent">워크스페이스 관리</Link></Empty>;
  return <EditorProvider key={`${ws.id}:${params.get("base") ?? "head"}`} workspace={ws} baseSha={params.get("base") ?? undefined}><Workbench workspaces={all} initialFile={params.get("file")} /></EditorProvider>;
}
function Workbench({ workspaces, initialFile }: { workspaces: Workspace[]; initialFile: string | null }) {
  const api = useEditor(); const runtime = useEditorRuntime(); const canWrite = useCanWrite(); const navigate = useNavigate(); const ai = useAiStatus();
  const [panel, setPanel] = useState("run"); const [mobile, setMobile] = useState("code");
  const [treeWidth, setTreeWidth] = useState(248); const [panelWidth, setPanelWidth] = useState(360);
  const [conflicts, setConflicts] = useState<string[]>([]); const [fetching, setFetching] = useState(false); const [error, setError] = useState<unknown>(null);
  const [pendingWorkspace, setPendingWorkspace] = useState<string | null>(null);
  const count = Object.keys(api.drafts).length; const problemCount = Object.values(api.issues).flat().length;
  const remote = api.headSha && api.headSha !== api.baseSha;
  useEffect(() => { try { localStorage.setItem("farm.editor.workspace", api.workspace.id); } catch { /* Optional preference. */ } }, [api.workspace.id]);
  useEffect(() => { if (initialFile) { try { api.openFile(initialFile); } catch (e) { setError(e); } } }, [initialFile]);
  useEffect(() => { const save = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") event.preventDefault(); }; window.addEventListener("keydown", save); return () => window.removeEventListener("keydown", save); }, []);
  const fetchHead = async () => { if (!api.headSha) return; setFetching(true); setError(null); try { setConflicts((await api.rebase(api.headSha)).conflicts); } catch (e) { setError(e); } finally { setFetching(false); } };
  const resolve = (path: string, useRemote: boolean) => { if (useRemote) api.discard(path); setConflicts(items => items.filter(p => p !== path)); };
  const switchWorkspace = (name: string) => { if (count) setPendingWorkspace(name); else navigate(`/editor/${encodeURIComponent(name)}`); };
  const options = [{ value: "run", label: "실행" }, { value: "screen", label: "화면" }, ...(ai.data?.enabled ? [{ value: "ai", label: "AI" }] : []), { value: "history", label: "이력" }, { value: "problems", label: `문제 ${problemCount}` }];
  return <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface text-fg">
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2 md:px-4">
      <Menu label={api.workspace.name} icon={<ChevronDown />} items={workspaces.map(ws => ({ label: ws.name, onClick: () => switchWorkspace(ws.name) }))} />
      <span className="order-last min-w-0 basis-full truncate text-xs text-fg-muted md:order-none md:flex-1 md:basis-auto">{api.workspace.repo} · <GitBranch className="inline size-3" /> {api.workspace.branch} · {api.workspace.path}</span>
      <Badge><span className="font-mono">{api.baseSha.slice(0, 7)}</span></Badge>
      {!remote && !conflicts.length && <span className="hidden items-center gap-1 text-xs text-fg-muted xl:flex"><CheckCheck className="size-3.5" />원격과 같음</span>}
      <Badge tone={count ? "warning" : "neutral"}>변경 {count}개</Badge>
      <Button size="sm" onClick={() => { void runtime.validateAll(); }} disabled={!canWrite || !count || runtime.validating}>{runtime.validating ? "검증 중…" : "검증"}</Button>
      <Button size="sm" variant="primary" disabled={!canWrite || !count || Boolean(conflicts.length)} onClick={api.openCommit}>커밋…</Button>
    </header>
    {(remote || conflicts.length > 0) && <div className="shrink-0 border-b border-warning/25 bg-warning-bg px-4 py-2 text-xs text-warning-fg" role="status">{remote && <div className="flex flex-wrap items-center justify-between gap-2"><span>원격 {api.workspace.branch}에 새 커밋이 있습니다 ({api.headSha?.slice(0, 7)})</span><Button size="sm" onClick={() => { void fetchHead(); }} disabled={fetching}>{fetching ? "가져오는 중…" : "가져오기"}</Button></div>}{conflicts.map(path => <div key={path} className="mt-1 flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 break-all">충돌 · {path}</span><Button size="sm" onClick={() => resolve(path, false)}>내 변경 유지</Button><Button size="sm" onClick={() => resolve(path, true)}>원격 내용으로 바꾸기</Button></div>)}</div>}
    {Boolean(runtime.error || error) && <div className="shrink-0 p-2"><ErrorBox error={error ?? runtime.error} /></div>}
    <nav className="flex shrink-0 gap-2 border-b border-border p-2 md:hidden" aria-label="에디터 보기"><Button size="sm" icon={<PanelLeft />} aria-pressed={mobile === "files"} onClick={() => setMobile(mobile === "files" ? "code" : "files")}>파일</Button><Button size="sm" aria-pressed={mobile === "code"} onClick={() => setMobile("code")}>코드</Button><Button size="sm" icon={<PanelRight />} aria-pressed={mobile === "panel"} onClick={() => setMobile(mobile === "panel" ? "code" : "panel")}>패널</Button></nav>
    <div className="flex min-h-0 min-w-0 flex-1">
      <aside aria-label="파일 탐색기" className={cx("min-h-0 shrink-0 max-md:!w-full md:block", mobile !== "files" && "hidden")} style={{ width: treeWidth }}><FileTree onOpen={() => setMobile("code")} /></aside>
      <ResizeHandle label="파일 탐색기 너비" value={treeWidth} min={200} max={400} onChange={setTreeWidth} />
      <section aria-label="코드" className={cx("min-h-0 min-w-0 flex-1 flex-col md:flex", mobile !== "code" ? "hidden" : "flex")}>
        <div role="tablist" aria-label="열린 파일" className="flex min-h-10 shrink-0 overflow-x-auto border-b border-border bg-surface-2">{api.openPaths.map(path => <div key={path} className={cx("flex shrink-0 items-center border-r border-border", path === api.activePath && "bg-surface")}><button role="tab" aria-selected={path === api.activePath} onClick={() => api.openFile(path)} className="max-w-56 truncate px-3 py-2 text-xs focus-visible:outline-accent max-md:min-h-11">{path.split("/").at(-1)}{api.drafts[path] && <span className="ml-2 text-warning-fg" aria-label="변경됨">●</span>}</button><IconButton aria-label={`${path} 닫기`} onClick={() => api.closeFile(path)}><X /></IconButton></div>)}</div>
        <div className="shrink-0 truncate border-b border-border px-4 py-2 font-mono text-[11px] text-fg-subtle">{api.workspace.name} / {api.activePath ?? "파일 선택"}</div>
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"><CodeEditor /></div>
      </section>
      <ResizeHandle label="패널 너비" value={panelWidth} min={300} max={640} reverse onChange={setPanelWidth} />
      <aside aria-label="에디터 패널" className={cx("min-h-0 min-w-0 shrink-0 flex-col max-md:!w-full md:flex", mobile !== "panel" ? "hidden" : "flex")} style={{ width: panelWidth }}><Tabs label="에디터 패널" options={options} value={panel} onChange={setPanel} /><div className="min-h-0 flex-1 overflow-auto">{panel === "run" ? <RunPanel onShowScreen={() => { setPanel("screen"); setMobile("panel"); }} /> : panel === "screen" ? <ScreenPanel /> : panel === "ai" && ai.data?.enabled ? <AiPanel /> : panel === "history" ? <HistoryPanel /> : <ProblemsPanel />}</div></aside>
    </div>
    <footer className="flex min-h-7 shrink-0 items-center gap-3 overflow-x-auto border-t border-border bg-surface-2 px-3 text-[11px] whitespace-nowrap text-fg-muted"><button onClick={() => { setPanel("problems"); setMobile("panel"); }} className="min-h-7 focus-visible:outline-accent max-md:min-h-11">문제 {problemCount}</button><span>{api.activePath ? languageFor(api.activePath).toUpperCase() : "—"}</span><span className="font-mono">Ln {runtime.cursor.line}, Col {runtime.cursor.column}</span><span className="ml-auto font-mono">{api.baseSha.slice(0, 7)}</span><span>임시 저장됨</span><span>{runtime.lastCheck ? `검사 ${runtime.lastCheck.toLocaleTimeString("ko-KR")}` : "검사 대기"}</span></footer>
    {runtime.commitOpen && <Modal title="커밋" onClose={runtime.closeCommit} size="xl"><CommitDialog /></Modal>}
    {pendingWorkspace && <Modal title="워크스페이스 이동" onClose={() => setPendingWorkspace(null)}><p className="mb-4 text-sm">현재 변경은 브라우저에 임시 저장됩니다. 워크스페이스를 이동할까요?</p><div className="flex justify-end gap-2"><Button onClick={() => setPendingWorkspace(null)}>취소</Button><Button variant="primary" onClick={() => { navigate(`/editor/${encodeURIComponent(pendingWorkspace)}`); setPendingWorkspace(null); }}>이동</Button></div></Modal>}
  </div>;
}
