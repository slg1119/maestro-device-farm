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
    onSuccess(`커밋했습니다 (${sha.slice(0, 7)})`); runtime.closeCommit();
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
  return <Modal title="커밋" size="xl" onClose={close}>
    <div className="space-y-4"><TokenNotice />
      <header className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted"><span className="break-all">{api.workspace.name} · {api.workspace.branch} · <span className="font-mono">{api.baseSha.slice(0, 7)}</span></span>
        <Badge tone={valid ? "passed" : issues.length ? "failed" : "neutral"}><CheckCheck className="size-3.5" />{validation.isFetching ? "검증 중…" : valid ? `검증 통과 ${puts.length}/${puts.length}` : validation.isError ? "검증 실패" : !validation.data ? "검증 대기" : `검증 통과 ${Math.max(0, passed)}/${puts.length}`}</Badge></header>
      <ErrorBox error={validation.error} /><ErrorBox error={error} />
      {savedSha && <div className="space-y-2 text-sm text-warning-fg"><p>커밋은 완료되었습니다 ({savedSha.slice(0, 7)}). 에디터 동기화를 다시 시도하세요.</p><Button disabled={busy} onClick={() => { setBusy(true); void finish(savedSha).catch(setError).finally(() => setBusy(false)); }}>에디터 동기화</Button></div>}
      {[...issues, ...serverIssues].map((issue, i) => <button key={`${issue.path}:${i}`} type="button" onClick={() => jump(issue)} className="block min-h-11 w-full break-all rounded-lg bg-failed-bg px-3 py-2 text-left text-xs text-failed-fg focus-visible:outline-accent">{issue.path}:{issue.line ?? 1}:{issue.column ?? 1} · {issue.message}</button>)}
      {conflict && <section aria-label="충돌한 파일" className="space-y-2 rounded-lg border border-warning/25 bg-warning-bg p-3 text-sm text-warning-fg"><p>원격 파일이 변경되었습니다. 내용을 비교하고 내 변경을 다시 적용하세요.</p>{paths.map(path => <div key={path} className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 break-all font-mono text-xs">{path}</span><Button size="sm" disabled={busy} onClick={() => setRemotePath(path)}>원격 내용 보기</Button></div>)}<Button disabled={!canWrite || !remoteHead || busy} onClick={() => { void reapply(); }}>내 변경으로 다시 적용</Button></section>}
      {preview.isLoading ? <Loading /> : preview.error ? <ErrorBox error={preview.error} /> : !files.length ? <Empty>커밋할 변경이 없습니다.</Empty> : <div className="grid min-w-0 gap-3 md:grid-cols-[240px_minmax(0,1fr)]">
        <div aria-label="변경 파일" className="max-h-44 space-y-1 overflow-y-auto md:max-h-[460px]">{files.map(file => <FileChoice key={file.path} file={file} selected={!remotePath && file.path === active?.path} counts onClick={() => { setSelected(file.path); setRemotePath(null); }} />)}</div>
        <div className="min-w-0">{remotePath && remote.isFetching ? <Loading /> : remotePath && remote.error ? <ErrorBox error={remote.error} /> : shown && <DiffView file={shown} fromLabel={remotePath ? `원격 ${remoteHead.slice(0, 7)}` : `기준 ${api.baseSha.slice(0, 7)}`} toLabel="내 변경" />}</div>
      </div>}
      <form onSubmit={event => { event.preventDefault(); void submit(); }} className="space-y-3 border-t border-border pt-4">
        <Field label="커밋 메시지"><Input required maxLength={5000} value={message} disabled={busy || Boolean(savedSha)} onChange={event => setMessage(event.target.value)} placeholder="변경한 내용을 적어주세요" /></Field>
        {author ? <p className="break-all text-xs text-fg-muted">Co-authored-by: {author.name} &lt;{author.email}&gt;</p> : <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-warning-fg"><span>설정에서 작성자 이름과 이메일을 입력하세요.</span><Button onClick={openSettings}>설정 열기</Button></div>}
        <footer className="flex flex-wrap justify-end gap-2"><Button disabled={busy} onClick={close}>취소</Button><Button type="submit" variant="primary" icon={<GitCommitHorizontal />} disabled={busy || Boolean(savedSha) || !canWrite || !author || !message.trim() || !valid || !changes.length || Boolean(conflict)}>{busy ? "처리 중…" : `${api.workspace.branch}에 커밋`}</Button></footer>
      </form>
    </div>
  </Modal>;
}
