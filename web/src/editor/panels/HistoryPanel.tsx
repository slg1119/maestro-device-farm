import { t, tp } from "../../lib/i18n";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitCompareArrows, History, RotateCcw } from "lucide-react";
import { useState } from "react";
import { apiJson, query } from "../../api/client";
import { keys } from "../../api/queries";
import type { CommitResult, DiffResult, WorkspaceCommit, WorkspaceHistory } from "../../api/types";
import { TokenNotice, useCanWrite, useOpenSettings } from "../../components/Layout";
import { Badge, Button, Checkbox, Empty, ErrorBox, Loading, Modal, Segmented } from "../../components/ui";
import { formatTime, timeAgo } from "../../lib/format";
import { useSettings } from "../../lib/settings";
import { useEditor } from "../store";
import { authorDetails, binaryPath, fileAt } from "./commit/data";
import { DiffView, FileChoice } from "./commit/DiffView";

export function HistoryPanel() {
  const api = useEditor(); const [scope, setScope] = useState("workspace"); const [notice, setNotice] = useState("");
  const path = scope === "file" ? api.activePath : null;
  const head = api.headSha ?? api.baseSha;
  return <div className="min-w-0 space-y-4 p-4">
    <div className="flex flex-wrap items-center gap-2"><History className="size-4 text-fg-muted" /><h2 className="text-sm font-semibold">{t("m_79637552f6")}</h2></div>
    <Segmented label={t("m_6115d6e616")} value={scope} onChange={setScope} options={[{ value: "workspace", label: t("m_3291059946") }, { value: "file", label: t("m_9e633f54f0") }]} />
    {notice && <div role="status" className="break-all rounded-lg bg-passed-bg px-3 py-2 text-xs text-passed-fg">{notice}</div>}
    {scope === "file" && !path ? <Empty>{t("m_bc347044c0")}</Empty> : <HistoryContent key={`${api.workspace.id}:${head}:${scope}:${path}`} path={path} head={head} onSuccess={setNotice} />}
  </div>;
}

function humanAuthor(commit: WorkspaceCommit) {
  const bot = /\[bot\]$|(?:^|[-_\s])bot(?:$|[-_\s])/i.test(commit.author_name) || ["Device Farm", "maestro-device-farm"].includes(commit.author_name);
  return bot && commit.co_authors[0] ? commit.co_authors[0].name : commit.author_name;
}

function HistoryContent({ path, head, onSuccess }: { path: string | null; head: string; onSuccess(message: string): void }) {
  const api = useEditor(); const client = useQueryClient(); const canWrite = useCanWrite(); const openSettings = useOpenSettings();
  const settings = useSettings(); const author = authorDetails(settings.authorName, settings.authorEmail);
  const root = `/workspaces/${encodeURIComponent(api.workspace.id)}`;
  const [selected, setSelected] = useState<string[]>([]); const [activePath, setActivePath] = useState<string | null>(null);
  const [restore, setRestore] = useState<WorkspaceCommit | null>(null); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null); const [restoredSha, setRestoredSha] = useState<string | null>(null);
  const history = useInfiniteQuery({ queryKey: keys.workspaceHistory(api.workspace.id, head, path ?? undefined), initialPageParam: 0,
    queryFn: ({ pageParam }) => apiJson<WorkspaceHistory>(`${root}/history${query({ ref: head, path, limit: 50, offset: pageParam })}`),
    getNextPageParam: (page, _pages, offset) => page.commits.length === 50 ? offset + 50 : undefined });
  const commits = history.data?.pages.flatMap(page => page.commits) ?? [];
  const from = selected[0] ?? ""; const to = selected[1] ?? head;
  const diff = useQuery({ queryKey: [...keys.workspaceHistory(api.workspace.id, head, path ?? undefined), "diff", from, to],
    queryFn: () => apiJson<DiffResult>(`${root}/diff${query({ from, to })}`), enabled: Boolean(from) });
  const files = (diff.data?.files ?? []).filter(file => !path || file.path === path);
  const active = files.find(file => file.path === activePath) ?? files[0];
  const preview = useQuery({ queryKey: [...keys.workspaceFile(api.workspace.id, to, active?.path ?? ""), "history-diff", from],
    queryFn: async () => ({ ...active!, binary: binaryPath(active!.path),
      original: active!.status === "added" || binaryPath(active!.path) ? "" : await fileAt(client, api.workspace.id, from, active!.path),
      modified: active!.status === "deleted" || binaryPath(active!.path) ? "" : await fileAt(client, api.workspace.id, to, active!.path) }), enabled: Boolean(from && active) });
  const select = (sha: string) => { setSelected(values => values.includes(sha) ? values.filter(value => value !== sha) : values.length < 2 ? [...values, sha] : [values[1]!, sha]); setActivePath(null); };
  const syncRestore = async (sha: string) => {
    const result = await api.rebase(sha);
    onSuccess(t("m_e1b3c89ef4", [sha.slice(0, 7), result.conflicts.length ? t("m_36da8ecbaa", [result.conflicts.join(", ")]) : ""]));
    setRestore(null); setRestoredSha(null); setError(null);
    void client.invalidateQueries({ queryKey: keys.workspaces });
    void client.invalidateQueries({ queryKey: ["workspace-history", api.workspace.id] });
  };
  const submitRestore = async () => {
    if (!restore || !canWrite || !author || busy) return;
    setBusy(true); setError(null);
    try {
      const result = restoredSha ? { sha: restoredSha } : await apiJson<CommitResult>(`${root}/restore`, { method: "POST", json: { sha: restore.sha, paths: path ? [path] : null, author } });
      setRestoredSha(result.sha); await syncRestore(result.sha);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return <div className="min-w-0 space-y-3"><TokenNotice />
    {path && <p className="break-all font-mono text-xs text-fg-muted">{path}</p>}
    <ErrorBox error={history.error} />
    {history.isLoading ? <Loading /> : !commits.length && !history.error ? <Empty>{t("m_a43420a8c8")}</Empty> : <>
      <p className="text-xs text-fg-subtle">{t("m_046caa2b14")}</p>
      <ol className="space-y-2">{commits.map(commit => <li key={commit.sha} className="rounded-lg border border-border bg-surface p-3">
        <div className="flex items-start gap-2"><Checkbox aria-label={t("m_b417607e30", [commit.sha.slice(0, 7), commit.message.split("\n")[0]])} checked={selected.includes(commit.sha)} onChange={() => select(commit.sha)} />
          <div className="min-w-0 flex-1"><div className="mb-1 flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-accent">{commit.sha.slice(0, 7)}</span><Badge>{tp("editor.fileCount", commit.files_changed)}</Badge></div>
            <p className="break-words text-sm font-medium text-fg">{commit.message.split("\n")[0]}</p>
            <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-fg-muted"><span>{humanAuthor(commit)}</span><time dateTime={commit.authored_at} title={formatTime(commit.authored_at)}>{timeAgo(commit.authored_at)}</time></div>
          </div>
        </div>
        <div className="mt-2 flex justify-end"><Button size="sm" variant="ghost" icon={<RotateCcw />} disabled={!canWrite || busy} onClick={() => { setError(null); setRestoredSha(null); setRestore(commit); }}>{t("m_2857385068")}</Button></div>
      </li>)}</ol>
      {history.hasNextPage && <Button className="w-full" disabled={history.isFetchingNextPage} onClick={() => { void history.fetchNextPage(); }}>{history.isFetchingNextPage ? t("m_c78656b445") : t("m_dcd42d6cce")}</Button>}
    </>}
    {selected.length > 0 && <section aria-label={t("m_18a63f1eb5")} className="min-w-0 space-y-2 border-t border-border pt-3"><h3 className="flex flex-wrap items-center gap-1.5 text-xs font-semibold"><GitCompareArrows className="size-4" /><span className="font-mono">{from.slice(0, 7)} → {to.slice(0, 7)}</span>{selected.length === 1 && <span className="text-fg-subtle">{t("e_5d8a94a517")}</span>}</h3>
      {diff.isLoading ? <Loading /> : diff.error ? <ErrorBox error={diff.error} /> : !files.length ? <Empty>{t("m_ad0f4da18d")}</Empty> : <><div className="space-y-1">{files.map(file => <FileChoice key={file.path} file={{ ...file, original: "", modified: "" }} selected={file.path === active?.path} onClick={() => setActivePath(file.path)} />)}</div>
        {preview.isLoading ? <Loading /> : preview.error ? <ErrorBox error={preview.error} /> : preview.data && <DiffView file={preview.data} fromLabel={from.slice(0, 7)} toLabel={to.slice(0, 7)} />}</>}
    </section>}
    {restore && <Modal title={t("m_73f5749aad")} onClose={() => { if (!busy) setRestore(null); }}>
      <div className="space-y-4"><p className="break-all text-sm">{t("history.restorePrompt", [path || t("m_1723749118"), restore.sha.slice(0, 7), api.workspace.branch])}</p>
        {api.changes().length > 0 && <p className="rounded-lg bg-warning-bg p-3 text-xs text-warning-fg">{t("m_0bbed61d02")}</p>}
        {!author && <div className="space-y-2 text-xs text-warning-fg"><p>{t("m_826980af8a")}</p><Button onClick={openSettings}>{t("m_9009d31193")}</Button></div>}
        <ErrorBox error={error} />
        {restoredSha && <p className="text-xs text-warning-fg">{t("history.restoreSaved", [restoredSha.slice(0, 7)])}</p>}
        <div className="flex flex-wrap justify-end gap-2"><Button disabled={busy} onClick={() => setRestore(null)}>{t("m_19b2d19bc1")}</Button><Button variant="primary" disabled={busy || !canWrite || !author} onClick={() => { void submitRestore(); }}>{busy ? t("m_3cc225b1c3") : restoredSha ? t("m_11c742fd1a") : t("m_8bd9b45e7a")}</Button></div>
      </div>
    </Modal>}
  </div>;
}
