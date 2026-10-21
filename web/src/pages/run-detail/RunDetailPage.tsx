import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, Download, RotateCcw } from "lucide-react";

import { API, ApiError, apiJson } from "../../api/client";
import { keys, useDevices, useRun, useWorkspaces } from "../../api/queries";
import type { RunDetail, RunSummary, Workspace } from "../../api/types";
import { TokenNotice, useCanWrite } from "../../components/Layout";
import { StatusBadge } from "../../components/StatusBadge";
import { Badge, Button, Card, Empty, ErrorBox, Loading, PageHeader, ProgressBar, StatusDot } from "../../components/ui";
import { elapsed, formatTime, githubCommitUrl, shortSha } from "../../lib/format";
import { useTicker } from "../../lib/useTicker";
import { MatrixGrid } from "./MatrixGrid";
import { TaskList } from "./TaskList";
import { TaskPanel } from "./TaskPanel";
import { ACTION_LINK, LINK } from "./links";

const ORIGIN = { ci: "CI", dashboard: "대시보드", editor: "편집기", ai: "AI" };
const MODE = { matrix: "매트릭스", split: "분할" };
const COUNTS = [
  ["passed", "통과"], ["failed", "실패"], ["error", "오류"],
  ["running", "실행 중"], ["queued", "대기"], ["cancelled", "취소"],
] as const;

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs text-fg-subtle">{label}</dt><dd className="mt-1 break-words text-sm">{children}</dd></div>;
}

function Source({ run, workspace }: { run: RunDetail; workspace?: Workspace }) {
  const source = `${workspace?.name ?? run.workspace_id ?? "워크스페이스"} @ ${shortSha(run.commit_sha)}`;
  return (
    <div className="space-y-2 break-words text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {run.flow_source === "upload" ? <span>업로드한 flow</span> : <>
          {workspace && run.commit_sha
            ? <a className={LINK} href={githubCommitUrl(workspace.repo, run.commit_sha)} target="_blank" rel="noreferrer">{source}</a>
            : <span className="break-all">{source}</span>}
          {run.ref && <span className="break-all text-fg-subtle">ref: {run.ref}</span>}
          {run.flow_source === "draft" && <span className="text-fg-subtle">(초안, 기준 커밋)</span>}
        </>}
      </div>
      {Object.keys(run.ci_meta).length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
          {run.ci_meta.branch && <span className="break-all">브랜치: {run.ci_meta.branch}</span>}
          {run.ci_meta.commit && <span title={run.ci_meta.commit}>커밋: {shortSha(run.ci_meta.commit)}</span>}
        </div>
      )}
    </div>
  );
}

function RunOptions({ run }: { run: RunDetail }) {
  const selector = run.device_selector;
  return (
    <Card>
      <details className="p-4">
        <summary className="cursor-pointer text-sm font-medium">실행 옵션</summary>
        <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="기기 시리얼">{selector.serials?.join(", ") || "-"}</Detail>
          <Detail label="기기 태그">{selector.tags?.join(", ") || "-"}</Detail>
          <Detail label="기기 모델">{selector.models?.join(", ") || "-"}</Detail>
          <Detail label="SDK 범위">{selector.min_sdk ?? "제한 없음"} – {selector.max_sdk ?? "제한 없음"}</Detail>
          <Detail label="flow 경로">{run.flow_paths?.join(", ") || "전체"}</Detail>
          <Detail label="포함 태그">{run.include_tags.join(", ") || "-"}</Detail>
          <Detail label="제외 태그">{run.exclude_tags.join(", ") || "-"}</Detail>
          <Detail label="환경변수">{Object.keys(run.env).length ? Object.keys(run.env).sort().map((key) => <div key={key} className="break-all font-mono text-xs">{key}=***</div>) : "-"}</Detail>
          <Detail label="task 제한 시간">{run.task_timeout_sec}초</Detail>
        </dl>
      </details>
    </Card>
  );
}

function RunContent({ run }: { run: RunDetail }) {
  useTicker(run.status === "running");
  const canWrite = useCanWrite();
  const navigate = useNavigate();
  const devices = useDevices();
  const workspaces = useWorkspaces();
  const client = useQueryClient();
  const [selection, setSelection] = useState<{ id: string; flow: string | null } | null>(null);
  const selected = run.tasks.find((task) => task.id === selection?.id)
    ?? [...run.tasks].sort((a, b) => a.seq - b.seq).find((task) => task.status === "failed" || task.status === "error");
  const failed = run.counts.failed + run.counts.error > 0
    || run.tasks.some((task) => task.status === "failed" || task.status === "error")
    || run.results.some((result) => result.status === "failed");
  const cancel = useMutation({
    mutationFn: () => apiJson<RunSummary>(`/runs/${encodeURIComponent(run.id)}/cancel`, { method: "POST" }),
    onSuccess: async () => {
      await Promise.all([client.invalidateQueries({ queryKey: keys.run(run.id) }), client.invalidateQueries({ queryKey: keys.runsAll })]);
    },
  });
  const rerun = useMutation({
    mutationFn: (failed_only: boolean) => apiJson<{ id: string; url: string }>(`/runs/${encodeURIComponent(run.id)}/rerun`, { method: "POST", json: { failed_only } }),
    onSuccess: async (created) => { await client.invalidateQueries({ queryKey: keys.runsAll }); navigate(`/runs/${encodeURIComponent(created.id)}`); },
  });
  const tones = { passed: "passed", failed: "failed", error: "warning", running: "running", queued: "neutral", cancelled: "neutral" } as const;
  return <div className="min-w-0 space-y-5 text-fg">
    <Link to="/runs" className={`inline-flex min-h-11 items-center gap-1.5 text-xs ${LINK}`}><ArrowLeft size={14} strokeWidth={1.8} />실행 목록</Link>
    <div className="[&_h1]:break-all [&_h1]:font-mono">
      <PageHeader title={`Run ${run.id}`} actions={<>
        <a href={`${API}/runs/${encodeURIComponent(run.id)}/junit`} download className={ACTION_LINK}><Download size={16} strokeWidth={1.8} />JUnit 다운로드</a>
        {failed && <Button disabled={!canWrite || rerun.isPending} onClick={() => rerun.mutate(true)}>실패만 다시 실행</Button>}
        <Button variant="primary" icon={<RotateCcw />} disabled={!canWrite || rerun.isPending} onClick={() => rerun.mutate(false)}>다시 실행</Button>
        {(run.status === "queued" || run.status === "running") && <Button variant="danger" disabled={!canWrite || cancel.isPending}
          onClick={() => { if (canWrite && window.confirm("이 run을 취소할까요?")) cancel.mutate(); }}>취소</Button>}
      </>}>
        <span className="flex flex-wrap items-center gap-2"><StatusBadge status={run.status} /><Badge>{MODE[run.mode]}</Badge>{run.cancel_requested && run.status === "running" && <Badge>취소 요청됨</Badge>}</span>
        <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-subtle">
          <span>{ORIGIN[run.origin]} · {run.created_by}</span><span>시작 {formatTime(run.started_at)}</span><span>소요 시간 {elapsed(run.started_at, run.finished_at)}</span>
          {run.ci_meta.pr_url && <a className={LINK} href={run.ci_meta.pr_url} target="_blank" rel="noreferrer">PR</a>}
          {run.ci_meta.workflow_url && <a className={LINK} href={run.ci_meta.workflow_url} target="_blank" rel="noreferrer">워크플로</a>}
        </span>
      </PageHeader>
    </div>
    <ErrorBox error={cancel.error ?? rerun.error} />
    <div className="grid min-w-0 gap-3 lg:grid-cols-3">
      <Card className="min-w-0 space-y-3 p-4"><h2 className="text-sm font-semibold">실행 결과</h2>
        <p className="text-xs text-fg-muted">전체 {run.counts.total}</p>
        <ProgressBar label="실행 결과 분포" total={run.counts.total} segments={COUNTS.map(([status]) => ({ value: run.counts[status], tone: tones[status] }))} />
        <div className="flex flex-wrap gap-x-3 gap-y-2">{COUNTS.filter(([status]) => run.counts[status] > 0).map(([status, label]) => <span key={status} className="inline-flex items-center gap-1.5 text-xs text-fg-muted"><StatusDot tone={tones[status]} />{label} {run.counts[status]}</span>)}</div>
      </Card>
      <Card className="min-w-0 space-y-3 p-4"><h2 className="text-sm font-semibold">flow 소스</h2><Source run={run} workspace={workspaces.data?.find((workspace) => workspace.id === run.workspace_id)} /></Card>
      <Card className="min-w-0 space-y-3 p-4"><h2 className="text-sm font-semibold">앱</h2><p className="break-all font-mono text-xs">{run.app.package_name}</p><p className="text-xs text-fg-muted">{run.app.version_name} ({run.app.version_code})</p><dl className="grid grid-cols-2 gap-3"><Detail label="생성">{formatTime(run.created_at)}</Detail><Detail label="종료">{formatTime(run.finished_at)}</Detail></dl></Card>
    </div>
    <RunOptions run={run} />
    <div className="grid min-w-0 items-start gap-4 min-[1200px]:grid-cols-[minmax(0,1fr)_400px]">
      <Card className="min-w-0 overflow-hidden"><div className="border-b border-border px-4 py-3"><h2 className="text-sm font-semibold">{run.mode === "matrix" ? "기기별 flow 결과" : "분할 실행 task"}</h2></div>
        {run.mode === "matrix"
          ? <MatrixGrid run={run} devices={devices.data ?? []} selectedId={selected?.id ?? null} selectedFlow={selection?.flow ?? null} onSelect={(id, flow) => setSelection({ id, flow })} />
          : <TaskList tasks={run.tasks} devices={devices.data ?? []} selectedId={selected?.id ?? null} onSelect={(id) => setSelection({ id, flow: null })} />}
      </Card>
      {selected ? <TaskPanel key={`${selected.id}:${selected.attempt}:${selected.status}`} task={selected} results={run.results} run={run} devices={devices.data ?? []} selectedFlow={selection?.flow} /> : <Card className="min-w-0 px-4"><Empty>task를 선택하면 산출물을 볼 수 있습니다.</Empty></Card>}
    </div>
  </div>;
}

export function RunDetailPage() {
  const { runId = "" } = useParams<{ runId: string }>();
  const run = useRun(runId);
  return <>
    <TokenNotice />
    {run.isPending ? <Loading /> : run.error instanceof ApiError && run.error.code === "run_not_found"
      ? <Empty>run을 찾을 수 없습니다.</Empty>
      : run.data ? <><ErrorBox error={run.error} /><RunContent key={run.data.id} run={run.data} /></>
      : <ErrorBox error={run.error} />}
  </>;
}
