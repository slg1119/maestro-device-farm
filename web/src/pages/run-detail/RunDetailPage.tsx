import { t } from "../../lib/i18n";
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

const ORIGIN = { ci: "CI", dashboard: t("m_2859873b5b"), editor: t("m_36538c6295"), ai: "AI" };
const MODE = { matrix: t("m_d41c4aab0b"), split: t("m_380a547835") };
const COUNTS = [
  ["passed", t("m_66409b6272")], ["failed", t("m_732fe33ab1")], ["error", t("m_3efa8afd60")],
  ["running", t("m_0d01d3e76a")], ["queued", t("m_df72a8753d")], ["cancelled", t("m_19b2d19bc1")],
] as const;

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="text-xs text-fg-subtle">{label}</dt><dd className="mt-1 break-words text-sm">{children}</dd></div>;
}

function Source({ run, workspace }: { run: RunDetail; workspace?: Workspace }) {
  const source = t("m_574ccb3efc", [workspace?.name ?? run.workspace_id ?? t("m_3291059946"), shortSha(run.commit_sha)]);
  return (
    <div className="space-y-2 break-words text-sm">
      <div className="flex flex-wrap items-center gap-2">
        {run.flow_source === "upload" ? <span>{t("m_ac6d2617b2")}</span> : <>
          {workspace && run.commit_sha
            ? <a className={LINK} href={githubCommitUrl(workspace.repo, run.commit_sha)} target="_blank" rel="noreferrer">{source}</a>
            : <span className="break-all">{source}</span>}
          {run.ref && <span className="break-all text-fg-subtle">{t("e_42e0721f56")} {run.ref}</span>}
          {run.flow_source === "draft" && <span className="text-fg-subtle">{t("m_f61c99e8cf")}</span>}
        </>}
      </div>
      {Object.keys(run.ci_meta).length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
          {run.ci_meta.branch && <span className="break-all">{t("m_5b7da52563")} {run.ci_meta.branch}</span>}
          {run.ci_meta.commit && <span title={run.ci_meta.commit}>{t("m_15b0c966f4")} {shortSha(run.ci_meta.commit)}</span>}
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
        <summary className="cursor-pointer text-sm font-medium">{t("m_abccce1e63")}</summary>
        <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label={t("m_47b30d3d52")}>{selector.serials?.join(", ") || "-"}</Detail>
          <Detail label={t("m_3e75bcb911")}>{selector.tags?.join(", ") || "-"}</Detail>
          <Detail label={t("m_f30d6a6a0a")}>{selector.models?.join(", ") || "-"}</Detail>
          <Detail label={t("m_7323281448")}>{selector.min_sdk ?? t("m_4efeea4126")} – {selector.max_sdk ?? t("m_4efeea4126")}</Detail>
          <Detail label={t("m_700698c615")}>{run.flow_paths?.join(", ") || t("m_934dd25ec5")}</Detail>
          <Detail label={t("m_20180117bf")}>{run.include_tags.join(", ") || "-"}</Detail>
          <Detail label={t("m_10ca43e627")}>{run.exclude_tags.join(", ") || "-"}</Detail>
          <Detail label={t("m_300285376c")}>{Object.keys(run.env).length ? Object.keys(run.env).sort().map((key) => <div key={key} className="break-all font-mono text-xs">{key}=***</div>) : "-"}</Detail>
          <Detail label={t("m_62f4dc3d59")}>{run.task_timeout_sec}{t("m_3845248e28")}</Detail>
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
    <Link to="/runs" className={`inline-flex min-h-11 items-center gap-1.5 text-xs ${LINK}`}><ArrowLeft size={14} strokeWidth={1.8} />{t("m_b609b643d9")}</Link>
    <div className="[&_h1]:break-all [&_h1]:font-mono">
      <PageHeader title={`Run ${run.id}`} actions={<>
        <a href={`${API}/runs/${encodeURIComponent(run.id)}/junit`} download className={ACTION_LINK}><Download size={16} strokeWidth={1.8} />{t("m_085739bab6")}</a>
        {failed && <Button disabled={!canWrite || rerun.isPending} onClick={() => rerun.mutate(true)}>{t("m_ba2609c7de")}</Button>}
        <Button variant="primary" icon={<RotateCcw />} disabled={!canWrite || rerun.isPending} onClick={() => rerun.mutate(false)}>{t("m_689760632f")}</Button>
        {(run.status === "queued" || run.status === "running") && <Button variant="danger" disabled={!canWrite || cancel.isPending}
          onClick={() => { if (canWrite && window.confirm(t("m_e045d5ddb5"))) cancel.mutate(); }}>{t("m_19b2d19bc1")}</Button>}
      </>}>
        <span className="flex flex-wrap items-center gap-2"><StatusBadge status={run.status} /><Badge>{MODE[run.mode]}</Badge>{run.cancel_requested && run.status === "running" && <Badge>{t("m_3648602811")}</Badge>}</span>
        <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-subtle">
          <span>{ORIGIN[run.origin]} · {run.created_by}</span><span>{t("m_e89cc866ba")} {formatTime(run.started_at)}</span><span>{t("m_2c6a412305")} {elapsed(run.started_at, run.finished_at)}</span>
          {run.ci_meta.pr_url && <a className={LINK} href={run.ci_meta.pr_url} target="_blank" rel="noreferrer">{t("e_55af20415e")}</a>}
          {run.ci_meta.workflow_url && <a className={LINK} href={run.ci_meta.workflow_url} target="_blank" rel="noreferrer">{t("m_8423200a37")}</a>}
        </span>
      </PageHeader>
    </div>
    <ErrorBox error={cancel.error ?? rerun.error} />
    <div className="grid min-w-0 gap-3 lg:grid-cols-3">
      <Card className="min-w-0 space-y-3 p-4"><h2 className="text-sm font-semibold">{t("m_466944daa5")}</h2>
        <p className="text-xs text-fg-muted">{t("m_934dd25ec5")} {run.counts.total}</p>
        <ProgressBar label={t("m_eb55cc28a5")} total={run.counts.total} segments={COUNTS.map(([status]) => ({ value: run.counts[status], tone: tones[status] }))} />
        <div className="flex flex-wrap gap-x-3 gap-y-2">{COUNTS.filter(([status]) => run.counts[status] > 0).map(([status, label]) => <span key={status} className="inline-flex items-center gap-1.5 text-xs text-fg-muted"><StatusDot tone={tones[status]} />{label} {run.counts[status]}</span>)}</div>
      </Card>
      <Card className="min-w-0 space-y-3 p-4"><h2 className="text-sm font-semibold">{t("m_4d9c73a4f1")}</h2><Source run={run} workspace={workspaces.data?.find((workspace) => workspace.id === run.workspace_id)} /></Card>
      <Card className="min-w-0 space-y-3 p-4"><h2 className="text-sm font-semibold">{t("m_053d5241c7")}</h2><p className="break-all font-mono text-xs">{run.app.package_name}</p><p className="text-xs text-fg-muted">{run.app.version_name} ({run.app.version_code})</p><dl className="grid grid-cols-2 gap-3"><Detail label={t("m_d1a2d3a223")}>{formatTime(run.created_at)}</Detail><Detail label={t("m_cafdc61bbf")}>{formatTime(run.finished_at)}</Detail></dl></Card>
    </div>
    <RunOptions run={run} />
    <div className="grid min-w-0 items-start gap-4 min-[1200px]:grid-cols-[minmax(0,1fr)_400px]">
      <Card className="min-w-0 overflow-hidden"><div className="border-b border-border px-4 py-3"><h2 className="text-sm font-semibold">{run.mode === "matrix" ? t("m_f762c2f99d") : t("m_3ecf97a2d5")}</h2></div>
        {run.mode === "matrix"
          ? <MatrixGrid run={run} devices={devices.data ?? []} selectedId={selected?.id ?? null} selectedFlow={selection?.flow ?? null} onSelect={(id, flow) => setSelection({ id, flow })} />
          : <TaskList tasks={run.tasks} devices={devices.data ?? []} selectedId={selected?.id ?? null} onSelect={(id) => setSelection({ id, flow: null })} />}
      </Card>
      {selected ? <TaskPanel key={`${selected.id}:${selected.attempt}:${selected.status}`} task={selected} results={run.results} run={run} devices={devices.data ?? []} selectedFlow={selection?.flow} /> : <Card className="min-w-0 px-4"><Empty>{t("m_69261d59df")}</Empty></Card>}
    </div>
  </div>;
}

export function RunDetailPage() {
  const { runId = "" } = useParams<{ runId: string }>();
  const run = useRun(runId);
  return <>
    <TokenNotice />
    {run.isPending ? <Loading /> : run.error instanceof ApiError && run.error.code === "run_not_found"
      ? <Empty>{t("m_1f8c6f2ba8")}</Empty>
      : run.data ? <><ErrorBox error={run.error} /><RunContent key={run.data.id} run={run.data} /></>
      : <ErrorBox error={run.error} />}
  </>;
}
