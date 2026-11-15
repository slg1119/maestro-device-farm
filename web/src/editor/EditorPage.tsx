import { t, tp } from "../lib/i18n";
import { formatClock } from "../lib/format";
import { CheckCheck, ChevronDown, FileCode2, GitBranch, PanelLeft, PanelRight, X } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { apiJson } from "../api/client";
import { keys, useWorkspaces } from "../api/queries";
import type { AiStatus, Workspace } from "../api/types";
import { useCanWrite } from "../components/Layout";
import { Badge, Button, Card, Empty, ErrorBox, IconButton, Loading, Menu, Modal, PageHeader, Tabs, cx } from "../components/ui";
import { languageFor } from "./code/adapter";
import { AiPanel } from "./panels/AiPanel";
import { CommitDialog } from "./panels/CommitDialog";
import { HistoryPanel } from "./panels/HistoryPanel";
import { ProblemsPanel } from "./panels/ProblemsPanel";
import { RunPanel } from "./panels/RunPanel";
import { ScreenPanel } from "./panels/ScreenPanel";
import { RecordingDraftImport } from "./panels/screen/RecordingDraftImport";
import { ResizeHandle } from "./ResizeHandle";
import { EditorProvider, useEditor, useEditorRuntime } from "./store";
import { FileTree } from "./tree/FileTree";

// Keep Monaco's module download/evaluation inside the code area, after the tree can paint.
const CodeEditor = lazy(() => import("./code/CodeEditor").then(module => ({ default: module.CodeEditor })));

function lastWorkspace(): string | null { try { return localStorage.getItem("farm.editor.workspace"); } catch { return null; } }
export function EditorPage() {
  const { workspace: selected } = useParams(); const [params] = useSearchParams(); const workspaces = useWorkspaces();
  if (workspaces.isLoading) return <Loading />;
  if (workspaces.error) return <ErrorBox error={workspaces.error} />;
  const all = workspaces.data ?? [];
  if (!selected) return <div className="min-h-0 overflow-y-auto p-4 md:p-8"><PageHeader title={t("m_4e9bc12abe")} description={t("m_09cb30f2e5")} /><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[...all].sort((a, b) => Number(b.id === lastWorkspace()) - Number(a.id === lastWorkspace())).map(ws => <Link key={ws.id} to={`/editor/${encodeURIComponent(ws.name)}`} className="rounded-[10px] focus-visible:outline-accent"><Card className="h-full p-5 hover:border-accent"><FileCode2 className="mb-3 size-6 text-accent" /><h2 className="font-semibold text-fg">{ws.name}</h2><p className="mt-2 break-all text-xs text-fg-muted">{ws.repo} · {ws.branch}</p><p className="mt-2 text-xs text-fg-subtle">{ws.id === lastWorkspace() ? t("m_71ac04c17e") : ""}{ws.head_sha?.slice(0, 7) ?? t("m_a17b167895")}</p></Card></Link>)}</div>{!all.length && <Empty>{t("m_b264129a9e")} <Link className="text-accent" to="/workspaces">{t("m_4a2c1eb5cc")}</Link></Empty>}</div>;
  const ws = all.find(w => w.name === selected || w.id === selected);
  if (!ws) return <Empty>{t("m_a890ac6de9")} <Link to="/editor" className="text-accent">{t("m_1918d6f644")}</Link></Empty>;
  if (!ws.head_sha && !params.get("base")) return <Empty>{t("m_255dab4a6e")} <Link to="/workspaces" className="text-accent">{t("m_adb8cdf033")}</Link></Empty>;
  return <EditorProvider key={`${ws.id}:${params.get("base") ?? "head"}`} workspace={ws} baseSha={params.get("base") ?? undefined}><Workbench workspaces={all} initialFile={params.get("file")} /></EditorProvider>;
}
function Workbench({ workspaces, initialFile }: { workspaces: Workspace[]; initialFile: string | null }) {
  const api = useEditor(); const runtime = useEditorRuntime(); const canWrite = useCanWrite(); const navigate = useNavigate();
  // Older servers have no AI endpoint. Capability discovery must not retry or delay editing.
  const ai = useQuery({ queryKey: keys.aiStatus, queryFn: async () => {
    try { return await apiJson<AiStatus>("/ai/status"); } catch { return { enabled: false }; }
  }, retry: false });
  const [params] = useSearchParams();
  const [panel, setPanel] = useState(params.has("aiJob") ? "ai" : "run"); const [mobile, setMobile] = useState(params.has("aiJob") ? "panel" : "code");
  const aiJobId = params.get("aiJob");
  useEffect(() => { if (aiJobId) { setPanel("ai"); setMobile("panel"); } }, [aiJobId]);
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
  const options = [{ value: "run", label: t("m_74a23ff796") }, { value: "screen", label: t("m_43c786f1c1") }, ...(ai.data?.enabled ? [{ value: "ai", label: "AI" }] : []), { value: "history", label: t("m_47c5b6b51c") }, { value: "problems", label: t("m_00ada35451", [problemCount]) }];
  return <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface text-fg">
    <RecordingDraftImport onImported={() => setMobile("code")} />
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2 md:px-4">
      <Menu label={api.workspace.name} icon={<ChevronDown />} items={workspaces.map(ws => ({ label: ws.name, onClick: () => switchWorkspace(ws.name) }))} />
      <span className="order-last min-w-0 basis-full truncate text-xs text-fg-muted md:order-none md:flex-1 md:basis-auto">{api.workspace.repo} · <GitBranch className="inline size-3" /> {api.workspace.branch} · {api.workspace.path}</span>
      <Badge><span className="font-mono">{api.baseSha.slice(0, 7)}</span></Badge>
      {!remote && !conflicts.length && <span className="hidden items-center gap-1 text-xs text-fg-muted xl:flex"><CheckCheck className="size-3.5" />{t("m_9816030e86")}</span>}
      <Badge tone={count ? "warning" : "neutral"}>{tp("editor.changeCount", count)}</Badge>
      <Button size="sm" onClick={() => { void runtime.validateAll(); }} disabled={!canWrite || !count || runtime.validating}>{runtime.validating ? t("m_d4d7dbfbec") : t("m_d2a74d7785")}</Button>
      <Button size="sm" variant="primary" disabled={!canWrite || !count || Boolean(conflicts.length)} onClick={api.openCommit}>{t("m_0db1394657")}</Button>
    </header>
    {(remote || conflicts.length > 0) && <div className="shrink-0 border-b border-warning/25 bg-warning-bg px-4 py-2 text-xs text-warning-fg" role="status">{remote && <div className="flex flex-wrap items-center justify-between gap-2"><span>{t("editor.remoteAhead", [api.workspace.branch, api.headSha?.slice(0, 7) ?? ""])}</span><Button size="sm" onClick={() => { void fetchHead(); }} disabled={fetching}>{fetching ? t("m_5ccca43f19") : t("m_7cf2b30a55")}</Button></div>}{conflicts.map(path => <div key={path} className="mt-1 flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 break-all">{t("m_88bae7d2ac")} {path}</span><Button size="sm" onClick={() => resolve(path, false)}>{t("m_eb1d399950")}</Button><Button size="sm" onClick={() => resolve(path, true)}>{t("m_de7afd5e6a")}</Button></div>)}</div>}
    {Boolean(runtime.error || error) && <div className="shrink-0 p-2"><ErrorBox error={error ?? runtime.error} /></div>}
    <nav className="flex shrink-0 gap-2 border-b border-border p-2 md:hidden" aria-label={t("m_22a6ba59c9")}><Button size="sm" icon={<PanelLeft />} aria-pressed={mobile === "files"} onClick={() => setMobile(mobile === "files" ? "code" : "files")}>{t("m_68b8eecb19")}</Button><Button size="sm" aria-pressed={mobile === "code"} onClick={() => setMobile("code")}>{t("m_e94a043c5f")}</Button><Button size="sm" icon={<PanelRight />} aria-pressed={mobile === "panel"} onClick={() => setMobile(mobile === "panel" ? "code" : "panel")}>{t("m_2fa92e95a2")}</Button></nav>
    <div className="flex min-h-0 min-w-0 flex-1">
      <aside aria-label={t("m_d90c18245f")} className={cx("min-h-0 shrink-0 max-md:!w-full md:block", mobile !== "files" && "hidden")} style={{ width: treeWidth }}><FileTree onOpen={() => setMobile("code")} /></aside>
      <ResizeHandle label={t("m_659f361031")} value={treeWidth} min={200} max={400} onChange={setTreeWidth} />
      <section aria-label={t("m_e94a043c5f")} className={cx("min-h-0 min-w-0 flex-1 flex-col md:flex", mobile !== "code" ? "hidden" : "flex")}>
        <div role="tablist" aria-label={t("m_78765de2da")} className="flex min-h-10 shrink-0 overflow-x-auto border-b border-border bg-surface-2">{api.openPaths.map(path => <div key={path} className={cx("flex shrink-0 items-center border-r border-border", path === api.activePath && "bg-surface")}><button role="tab" aria-selected={path === api.activePath} onClick={() => api.openFile(path)} className="max-w-56 truncate px-3 py-2 text-xs focus-visible:outline-accent max-md:min-h-11">{path.split("/").at(-1)}{api.drafts[path] && <span className="ml-2 text-warning-fg" aria-label={t("m_72b57f60a5")}>●</span>}</button><IconButton aria-label={t("m_d3aee1ac9a", [path])} onClick={() => api.closeFile(path)}><X /></IconButton></div>)}</div>
        <div className="shrink-0 truncate border-b border-border px-4 py-2 font-mono text-[11px] text-fg-subtle">{api.workspace.name} / {api.activePath ?? t("m_a3d68212dd")}</div>
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"><Suspense fallback={<Loading label={t("m_8934fcf01e")} />}><CodeEditor /></Suspense></div>
      </section>
      <ResizeHandle label={t("m_513a93fc7e")} value={panelWidth} min={300} max={640} reverse onChange={setPanelWidth} />
      <aside aria-label={t("m_a8f2be800d")} className={cx("min-h-0 min-w-0 shrink-0 flex-col max-md:!w-full md:flex", mobile !== "panel" ? "hidden" : "flex")} style={{ width: panelWidth }}><Tabs label={t("m_a8f2be800d")} options={options} value={panel} onChange={setPanel} /><div className="min-h-0 flex-1 overflow-auto">{panel === "run" ? <RunPanel onShowScreen={() => { setPanel("screen"); setMobile("panel"); }} /> : panel === "screen" ? <ScreenPanel onReserve={() => setPanel("run")} onDraftImported={() => setMobile("code")} /> : panel === "ai" && ai.data?.enabled ? <AiPanel /> : panel === "history" ? <HistoryPanel /> : <ProblemsPanel />}</div></aside>
    </div>
    <footer className="flex min-h-7 shrink-0 items-center gap-3 overflow-x-auto border-t border-border bg-surface-2 px-3 text-[11px] whitespace-nowrap text-fg-muted"><button onClick={() => { setPanel("problems"); setMobile("panel"); }} className="min-h-7 focus-visible:outline-accent max-md:min-h-11">{t("m_4b30e4b84a")} {problemCount}</button><span>{api.activePath ? languageFor(api.activePath).toUpperCase() : "—"}</span><span className="font-mono">{t("e_143be00a35")} {runtime.cursor.line}{t("e_ec5cf9d819")} {runtime.cursor.column}</span><span className="ml-auto font-mono">{api.baseSha.slice(0, 7)}</span><span>{t("m_3e5ea03e02")}</span><span>{runtime.lastCheck ? t("m_903f29bc36", [formatClock(runtime.lastCheck)]) : t("m_41bd86ae51")}</span></footer>
    <CommitDialog />
    {pendingWorkspace && <Modal title={t("m_fe81429da2")} onClose={() => setPendingWorkspace(null)}><p className="mb-4 text-sm">{t("m_b23648d154")}</p><div className="flex justify-end gap-2"><Button onClick={() => setPendingWorkspace(null)}>{t("m_19b2d19bc1")}</Button><Button variant="primary" onClick={() => { navigate(`/editor/${encodeURIComponent(pendingWorkspace)}`); setPendingWorkspace(null); }}>{t("m_c686d05434")}</Button></div></Modal>}
  </div>;
}
