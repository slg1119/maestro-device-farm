import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useParams } from "react-router";

import { API, ApiError, apiJson } from "../../api/client";
import { keys, useDevices, useRun, useWorkspaces } from "../../api/queries";
import type { RunDetail, RunSummary, Workspace } from "../../api/types";
import { TokenNotice } from "../../components/Layout";
import { StatusBadge } from "../../components/StatusBadge";
import { Badge, Button, Card, Empty, ErrorBox, Loading, PageHeader } from "../../components/ui";
import { elapsed, formatTime, githubCommitUrl, shortSha } from "../../lib/format";
import { useSettings } from "../../lib/settings";
import { useTicker } from "../../lib/useTicker";
import { MatrixGrid } from "./MatrixGrid";
import { TaskList } from "./TaskList";
import { TaskPanel } from "./TaskPanel";

const LINK = "break-all text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2";
const ORIGIN = { ci: "CI", dashboard: "대시보드", editor: "편집기", ai: "AI" };
const MODE = { matrix: "매트릭스", split: "분할" };
const COUNTS = [
  ["passed", "통과"], ["failed", "실패"], ["error", "오류"],
  ["running", "실행 중"], ["queued", "대기"], ["cancelled", "취소"],
] as const;

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm">{children}</dd></div>;
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
          {run.ref && <span className="break-all text-slate-500">ref: {run.ref}</span>}
          {run.flow_source === "draft" && <span className="text-slate-500">(초안, 기준 커밋)</span>}
        </>}
      </div>
      {Object.keys(run.ci_meta).length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          {run.ci_meta.branch && <span className="break-all">브랜치: {run.ci_meta.branch}</span>}
          {run.ci_meta.commit && <span title={run.ci_meta.commit}>커밋: {shortSha(run.ci_meta.commit)}</span>}
          {run.ci_meta.pr_url && <a className={LINK} href={run.ci_meta.pr_url} target="_blank" rel="noreferrer">PR</a>}
          {run.ci_meta.workflow_url && <a className={LINK} href={run.ci_meta.workflow_url} target="_blank" rel="noreferrer">워크플로</a>}
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
  const { token } = useSettings();
  const devices = useDevices();
  const workspaces = useWorkspaces();
  const client = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = run.tasks.find((task) => task.id === selectedId)
    ?? [...run.tasks].sort((a, b) => a.seq - b.seq).find((task) => task.status === "failed" || task.status === "error");
  const cancel = useMutation({
    mutationFn: () => apiJson<RunSummary>(`/runs/${encodeURIComponent(run.id)}/cancel`, { method: "POST" }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: keys.run(run.id) }),
        client.invalidateQueries({ queryKey: keys.runsAll }),
      ]);
    },
  });
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader title={`Run ${run.id}`} actions={<>
        <a href={`${API}/runs/${encodeURIComponent(run.id)}/junit`} download className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50">JUnit 다운로드</a>
        {(run.status === "queued" || run.status === "running") && <Button
          variant="danger"
          disabled={!token || cancel.isPending}
          onClick={() => { if (token && window.confirm("이 run을 취소할까요?")) cancel.mutate(); }}
        >취소</Button>}
      </>}>
        <span className="flex flex-wrap items-center gap-2"><StatusBadge status={run.status} /><span>{ORIGIN[run.origin]} · {MODE[run.mode]}</span>{run.cancel_requested && run.status === "running" && <Badge>취소 요청됨</Badge>}</span>
      </PageHeader>
      <ErrorBox error={cancel.error} />
      <Card className="min-w-0 space-y-4 p-4">
        <p className="break-all text-sm font-medium">{run.app.package_name} {run.app.version_name} ({run.app.version_code})</p>
        <Source run={run} workspace={workspaces.data?.find((workspace) => workspace.id === run.workspace_id)} />
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Detail label="생성자">{run.created_by}</Detail>
          <Detail label="생성">{formatTime(run.created_at)}</Detail>
          <Detail label="시작">{formatTime(run.started_at)}</Detail>
          <Detail label="종료">{formatTime(run.finished_at)}</Detail>
          <Detail label="소요 시간">{elapsed(run.started_at, run.finished_at)}</Detail>
        </dl>
      </Card>
      <RunOptions run={run} />
      <Card className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 text-sm" >
        <span className="font-medium">전체 {run.counts.total}</span>
        {COUNTS.filter(([status]) => run.counts[status] > 0).map(([status, label]) => <span key={status} className="inline-flex items-center gap-2 text-slate-600"><span aria-hidden="true">·</span><span>{label} {run.counts[status]}</span></span>)}
      </Card>
      <Card className="min-w-0 overflow-hidden">
        {run.mode === "matrix"
          ? <MatrixGrid run={run} devices={devices.data ?? []} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
          : <TaskList tasks={run.tasks} devices={devices.data ?? []} selectedId={selected?.id ?? null} onSelect={setSelectedId} />}
      </Card>
      {selected
        ? <TaskPanel key={`${selected.id}:${selected.attempt}:${selected.status}`} task={selected} results={run.results} />
        : <Empty>task를 선택하면 산출물을 볼 수 있습니다.</Empty>}
    </div>
  );
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
