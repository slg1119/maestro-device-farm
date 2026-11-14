import { t } from "../../lib/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, GitCommitHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError, apiJson } from "../../api/client";
import { keys } from "../../api/queries";
import type { CommitResult, Issue, ValidateResult } from "../../api/types";
import { TokenNotice, useCanWrite, useOpenSettings } from "../../components/Layout";
import { Badge, Button, Empty, ErrorBox, Field, Input, Loading, Modal } from "../../components/ui";
import { useSettings } from "../../lib/settings";
import { useEditor, useEditorRuntime } from "../store";
import { authorDetails, draftDiffs, fileAt } from "./commit/data";
import { DiffView, FileChoice } from "./commit/DiffView";

export function CommitDialog() {
  const runtime = useEditorRuntime(); const [notice, setNotice] = useState("");
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 6000); return () => clearTimeout(timer); }, [notice]);
  return <>{runtime.commitOpen && <CommitForm onSuccess={setNotice} />}{notice && <div role="status" className="fixed right-4 bottom-4 z-50 max-w-[calc(100vw-32px)] rounded-lg border border-passed/25 bg-passed-bg px-4 py-3 text-sm text-passed-fg shadow-lg">{notice}</div>}</>;
}

function CommitForm({ onSuccess }: { onSuccess(message: string): void }) {
  const api = useEditor(); const runtime = useEditorRuntime(); const client = useQueryClient();
  const canWrite = useCanWrite(); const openSettings = useOpenSettings(); const settings = useSettings();
  const author = authorDetails(settings.authorName, settings.authorEmail);
  const [message, setMessage] = useState(""); const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false); const [savedSha, setSavedSha] = useState<string | null>(null);
  const [remotePath, setRemotePath] = useState<string | null>(null);
  const changes = api.changes(); const signature = JSON.stringify(changes); const puts = changes.filter(c => c.op === "put");
  const root = `/workspaces/${encodeURIComponent(api.workspace.id)}`;
  const preview = useQuery({ queryKey: [...keys.workspaceTree(api.workspace.id, api.baseSha), "commit-preview", signature], queryFn: () => draftDiffs(client, api, changes) });
  const validation = useQuery({ queryKey: [...keys.workspaceTree(api.workspace.id, api.baseSha), "commit-validation", signature],
    queryFn: () => apiJson<ValidateResult>(`${root}/validate`, { method: "POST", json: { changes: puts } }), enabled: canWrite && puts.length > 0, staleTime: 0, refetchOnWindowFocus: false });
  const conflict = error instanceof ApiError && error.code === "conflict" ? error : null;
  const paths = Array.isArray(conflict?.extra.paths) ? conflict.extra.paths.filter((p): p is string => typeof p === "string") : [];
  const remoteHead = typeof conflict?.extra.remote_head === "string" ? conflict.extra.remote_head : "";
  const remote = useQuery({ queryKey: [...keys.workspaceFile(api.workspace.id, remoteHead, remotePath ?? ""), "conflict-preview"],
    queryFn: () => fileAt(client, api.workspace.id, remoteHead, remotePath!, true), enabled: Boolean(remotePath && remoteHead) });
  const files = preview.data ?? []; const active = files.find(f => f.path === selected) ?? files[0];
  const remoteFile = files.find(f => f.path === remotePath || f.fromPath === remotePath);
  const shown = remotePath && remote.data !== undefined ? { path: remotePath, status: remoteFile?.status ?? "modified" as const, original: remote.data, modified: remoteFile?.modified ?? "", binary: remoteFile?.binary } : active;
  const issues = validation.data?.issues ?? [];
  const serverIssues = error instanceof ApiError && Array.isArray(error.extra.issues) ? error.extra.issues as Issue[] : [];
  const valid = puts.length === 0 || (validation.data?.valid === true && issues.length === 0 && !validation.isFetching && !validation.isError);
  const passed = puts.length - new Set(issues.map(i => i.path)).size;
  const close = () => { if (!busy) runtime.closeCommit(); };
  const finish = async (sha: string) => {
    await api.rebase(sha); api.discard();
    void client.invalidateQueries({ queryKey: keys.workspaces });
    void client.invalidateQueries({ queryKey: ["workspace-history", api.workspace.id] });
    onSuccess(t("m_96102b40e9", [sha.slice(0, 7)])); runtime.closeCommit();
  };
  const submit = async () => {
    if (busy || savedSha || !canWrite || !author || !message.trim() || !valid || !changes.length || conflict) return;
    setBusy(true); setError(null);
    try {
      const result = await apiJson<CommitResult>(`${root}/commits`, { method: "POST", json: { base_sha: api.baseSha, message: message.trim(), author, changes } });
      setSavedSha(result.sha); await finish(result.sha);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const reapply = async () => {
    if (!remoteHead || busy) return; setBusy(true);
    try { await api.rebase(remoteHead); setRemotePath(null); setError(null); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const jump = (issue: Issue) => { runtime.revealIssue(issue); runtime.closeCommit(); };
  return <Modal title={t("m_20f402949b")} size="xl" onClose={close}>
    <div className="space-y-4"><TokenNotice />
      <header className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted"><span className="break-all">{api.workspace.name} · {api.workspace.branch} · <span className="font-mono">{api.baseSha.slice(0, 7)}</span></span>
        <Badge tone={valid ? "passed" : issues.length ? "failed" : "neutral"}><CheckCheck className="size-3.5" />{validation.isFetching ? t("m_d4d7dbfbec") : valid ? t("m_78d6ac595a", [puts.length, puts.length]) : validation.isError ? t("m_ded9ac50c8") : !validation.data ? t("m_291f34d0b1") : t("m_78d6ac595a", [Math.max(0, passed), puts.length])}</Badge></header>
      <ErrorBox error={validation.error} /><ErrorBox error={error} />
      {savedSha && <div className="space-y-2 text-sm text-warning-fg"><p>{t("m_df565f03e0")}{savedSha.slice(0, 7)}{t("m_8354c5bf55")}</p><Button disabled={busy} onClick={() => { setBusy(true); void finish(savedSha).catch(setError).finally(() => setBusy(false)); }}>{t("m_11c742fd1a")}</Button></div>}
      {[...issues, ...serverIssues].map((issue, i) => <button key={`${issue.path}:${i}`} type="button" onClick={() => jump(issue)} className="block min-h-11 w-full break-all rounded-lg bg-failed-bg px-3 py-2 text-left text-xs text-failed-fg focus-visible:outline-accent">{issue.path}:{issue.line ?? 1}:{issue.column ?? 1} · {issue.message}</button>)}
      {conflict && <section aria-label={t("m_1a40e2e5d2")} className="space-y-2 rounded-lg border border-warning/25 bg-warning-bg p-3 text-sm text-warning-fg"><p>{t("m_58d6d2a225")}</p>{paths.map(path => <div key={path} className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 break-all font-mono text-xs">{path}</span><Button size="sm" disabled={busy} onClick={() => setRemotePath(path)}>{t("m_9d057d8bec")}</Button></div>)}<Button disabled={!canWrite || !remoteHead || busy} onClick={() => { void reapply(); }}>{t("m_1b0b8e10be")}</Button></section>}
      {preview.isLoading ? <Loading /> : preview.error ? <ErrorBox error={preview.error} /> : !files.length ? <Empty>{t("m_1e8ee042de")}</Empty> : <div className="grid min-w-0 gap-3 md:grid-cols-[240px_minmax(0,1fr)]">
        <div aria-label={t("m_d9e4f71277")} className="max-h-44 space-y-1 overflow-y-auto md:max-h-[460px]">{files.map(file => <FileChoice key={file.path} file={file} selected={!remotePath && file.path === active?.path} counts onClick={() => { setSelected(file.path); setRemotePath(null); }} />)}</div>
        <div className="min-w-0">{remotePath && remote.isFetching ? <Loading /> : remotePath && remote.error ? <ErrorBox error={remote.error} /> : shown && <DiffView file={shown} fromLabel={remotePath ? t("m_055633bb7c", [remoteHead.slice(0, 7)]) : t("m_4c8aa72501", [api.baseSha.slice(0, 7)])} toLabel={t("m_a38963d329")} />}</div>
      </div>}
      <form onSubmit={event => { event.preventDefault(); void submit(); }} className="space-y-3 border-t border-border pt-4">
        <Field label={t("m_69c17530f6")}><Input required maxLength={5000} value={message} disabled={busy || Boolean(savedSha)} onChange={event => setMessage(event.target.value)} placeholder={t("m_1b12457ac4")} /></Field>
        {author ? <p className="break-all text-xs text-fg-muted">{t("e_5587250b50")} {author.name} {t("e_c4dd3c8cdd")}{author.email}{t("e_091385be99")}</p> : <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-warning-fg"><span>{t("m_826980af8a")}</span><Button onClick={openSettings}>{t("m_9009d31193")}</Button></div>}
        <footer className="flex flex-wrap justify-end gap-2"><Button disabled={busy} onClick={close}>{t("m_19b2d19bc1")}</Button><Button type="submit" variant="primary" icon={<GitCommitHorizontal />} disabled={busy || Boolean(savedSha) || !canWrite || !author || !message.trim() || !valid || !changes.length || Boolean(conflict)}>{busy ? t("m_24cd06a1a4") : t("m_7e287cf815", [api.workspace.branch])}</Button></footer>
      </form>
    </div>
  </Modal>;
}
