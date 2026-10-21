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
    <div className="flex flex-wrap items-center gap-2"><History className="size-4 text-fg-muted" /><h2 className="text-sm font-semibold">커밋 이력</h2></div>
    <Segmented label="이력 범위" value={scope} onChange={setScope} options={[{ value: "workspace", label: "워크스페이스" }, { value: "file", label: "현재 파일" }]} />
    {notice && <div role="status" className="break-all rounded-lg bg-passed-bg px-3 py-2 text-xs text-passed-fg">{notice}</div>}
    {scope === "file" && !path ? <Empty>이력을 볼 파일을 선택하세요.</Empty> : <HistoryContent key={`${api.workspace.id}:${head}:${scope}:${path}`} path={path} head={head} onSuccess={setNotice} />}
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
    onSuccess(`복원했습니다 (${sha.slice(0, 7)})${result.conflicts.length ? ` · 임시 변경 확인: ${result.conflicts.join(", ")}` : ""}`);
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
    {history.isLoading ? <Loading /> : !commits.length && !history.error ? <Empty>커밋 이력이 없습니다.</Empty> : <>
      <p className="text-xs text-fg-subtle">커밋 하나를 고르면 현재 원격 HEAD와 비교합니다. 두 개를 고르면 선택한 순서대로 비교합니다.</p>
      <ol className="space-y-2">{commits.map(commit => <li key={commit.sha} className="rounded-lg border border-border bg-surface p-3">
        <div className="flex items-start gap-2"><Checkbox aria-label={`${commit.sha.slice(0, 7)} ${commit.message.split("\n")[0]} 비교 선택`} checked={selected.includes(commit.sha)} onChange={() => select(commit.sha)} />
          <div className="min-w-0 flex-1"><div className="mb-1 flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-accent">{commit.sha.slice(0, 7)}</span><Badge>파일 {commit.files_changed}개</Badge></div>
            <p className="break-words text-sm font-medium text-fg">{commit.message.split("\n")[0]}</p>
            <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-fg-muted"><span>{humanAuthor(commit)}</span><time dateTime={commit.authored_at} title={formatTime(commit.authored_at)}>{timeAgo(commit.authored_at)}</time></div>
          </div>
        </div>
        <div className="mt-2 flex justify-end"><Button size="sm" variant="ghost" icon={<RotateCcw />} disabled={!canWrite || busy} onClick={() => { setError(null); setRestoredSha(null); setRestore(commit); }}>이 커밋으로 되돌리기</Button></div>
      </li>)}</ol>
      {history.hasNextPage && <Button className="w-full" disabled={history.isFetchingNextPage} onClick={() => { void history.fetchNextPage(); }}>{history.isFetchingNextPage ? "불러오는 중…" : "더 보기"}</Button>}
    </>}
    {selected.length > 0 && <section aria-label="커밋 비교" className="min-w-0 space-y-2 border-t border-border pt-3"><h3 className="flex flex-wrap items-center gap-1.5 text-xs font-semibold"><GitCompareArrows className="size-4" /><span className="font-mono">{from.slice(0, 7)} → {to.slice(0, 7)}</span>{selected.length === 1 && <span className="text-fg-subtle">(HEAD)</span>}</h3>
      {diff.isLoading ? <Loading /> : diff.error ? <ErrorBox error={diff.error} /> : !files.length ? <Empty>두 커밋 사이에 변경이 없습니다.</Empty> : <><div className="space-y-1">{files.map(file => <FileChoice key={file.path} file={{ ...file, original: "", modified: "" }} selected={file.path === active?.path} onClick={() => setActivePath(file.path)} />)}</div>
        {preview.isLoading ? <Loading /> : preview.error ? <ErrorBox error={preview.error} /> : preview.data && <DiffView file={preview.data} fromLabel={from.slice(0, 7)} toLabel={to.slice(0, 7)} />}</>}
    </section>}
    {restore && <Modal title="커밋 복원" onClose={() => { if (!busy) setRestore(null); }}>
      <div className="space-y-4"><p className="break-all text-sm">{path ? path : "워크스페이스 전체"}를 {restore.sha.slice(0, 7)} 커밋으로 되돌릴까요? {api.workspace.branch}에 복원 커밋을 만듭니다.</p>
        {api.changes().length > 0 && <p className="rounded-lg bg-warning-bg p-3 text-xs text-warning-fg">임시 변경은 유지됩니다. 복원 후 변경 내용을 확인하세요.</p>}
        {!author && <div className="space-y-2 text-xs text-warning-fg"><p>설정에서 작성자 이름과 이메일을 입력하세요.</p><Button onClick={openSettings}>설정 열기</Button></div>}
        <ErrorBox error={error} />
        {restoredSha && <p className="text-xs text-warning-fg">복원 커밋은 완료되었습니다 ({restoredSha.slice(0, 7)}). 에디터 동기화를 다시 시도하세요.</p>}
        <div className="flex flex-wrap justify-end gap-2"><Button disabled={busy} onClick={() => setRestore(null)}>취소</Button><Button variant="primary" disabled={busy || !canWrite || !author} onClick={() => { void submitRestore(); }}>{busy ? "되돌리는 중…" : restoredSha ? "에디터 동기화" : "되돌리기"}</Button></div>
      </div>
    </Modal>}
  </div>;
}
