import { t } from "../../../lib/i18n";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { apiFetch } from "../../../api/client";
import { useRun, useTaskSteps } from "../../../api/queries";
import type { RunDetail, Task } from "../../../api/types";
import { StatusBadge } from "../../../components/StatusBadge";
import { Badge, Button, Empty, ErrorBox, Loading, StatusDot } from "../../../components/ui";
import { elapsed, formatNumber } from "../../../lib/format";

export interface SessionRun { id: string; createdAt: string }
export function readSessionRuns(key: string): SessionRun[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is SessionRun => Boolean(item && typeof item.id === "string" && typeof item.createdAt === "string")).slice(0, 5) : [];
  } catch { return []; }
}

const STEP_STATUS = {
  passed: { tone: "passed", label: t("m_66409b6272") }, warned: { tone: "warning", label: t("m_2f05eb04c8") },
  failed: { tone: "failed", label: t("m_732fe33ab1") }, skipped: { tone: "neutral", label: t("m_0d8285629e") },
  running: { tone: "running", label: t("m_0d01d3e76a") }, pending: { tone: "neutral", label: t("m_df72a8753d") },
} as const;

function FailureScreenshot({ taskId, path }: { taskId: string; path: string }) {
  const [source, setSource] = useState<{ path: string; url: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    const abort = new AbortController(); let url: string | undefined;
    setError(null); setSource(null);
    void apiFetch(`/tasks/${encodeURIComponent(taskId)}/artifacts/${path.split("/").map(encodeURIComponent).join("/")}`, { signal: abort.signal })
      .then(response => response.blob()).then(blob => {
        if (abort.signal.aborted) return;
        url = URL.createObjectURL(blob); setSource({ path, url });
      }).catch(e => { if (!abort.signal.aborted) setError(e); });
    return () => { abort.abort(); if (url) URL.revokeObjectURL(url); };
  }, [taskId, path]);
  if (error) return <p className="text-xs text-fg-muted">{t("m_a9767a9843")}</p>;
  return source?.path === path ? <img alt={t("m_9bad9a7b23")} src={source.url} className="max-h-56 w-full rounded-lg border border-border object-contain" /> : <p className="text-xs text-fg-muted">{t("m_a16821eca4")}</p>;
}

function FinishedTask({ task, run, onShowScreen }: { task: Task; run: RunDetail; onShowScreen?: () => void }) {
  const steps = useTaskSteps(task.id);
  const failedStep = steps.data?.flows.flatMap(flow => flow.steps).find(step => step.status === "failed" && step.screenshot);
  const failure = task.error_message || run.results.find(result => result.task_id === task.id && result.failure_message)?.failure_message;
  const failed = task.status === "failed" || task.status === "error";
  return <div className="min-w-0 space-y-3">
    {steps.isLoading && <Loading label={t("m_57d133abd9")} />}
    <ErrorBox error={steps.error} />
    {steps.data?.flows.map((flow, index) => <section key={`${flow.flow}:${index}`} className="min-w-0">
      <h4 className="mb-2 break-all font-mono text-xs font-medium text-fg-muted">{flow.flow}</h4>
      <ol aria-label={t("m_0b11b5c6f6", [flow.flow])} className="space-y-2 border-l border-border pl-3">
        {flow.steps.map((step, i) => <li key={`${step.seq}:${i}`} className="flex min-w-0 items-start gap-2" style={{ paddingLeft: Math.min(4, Math.max(0, step.depth)) * 8 }}>
          <StatusDot tone={STEP_STATUS[step.status].tone} className="mt-1.5" />
          <span className="min-w-0 flex-1 break-all font-mono text-[11px] leading-5">{step.label}</span>
          <span className="shrink-0 text-right"><Badge tone={STEP_STATUS[step.status].tone}>{STEP_STATUS[step.status].label}</Badge><span className="mt-0.5 block font-mono text-[11px] text-fg-subtle">{step.duration_ms < 1000 ? `${formatNumber(step.duration_ms)}ms` : `${formatNumber(step.duration_ms / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}s`}</span></span>
        </li>)}
      </ol>
    </section>)}
    {steps.isSuccess && !steps.data.flows.length && <p className="text-xs text-fg-subtle">{t("m_2f246bf0db")}</p>}
    {failed && <div className="space-y-3 rounded-lg border border-failed/25 bg-failed-bg p-3" role="group" aria-label={t("m_6f3f678ec3")}>
      <p className="break-words text-xs text-failed-fg">{failure || t("m_0d9d087bec")}</p>
      {failedStep?.screenshot && <FailureScreenshot taskId={task.id} path={failedStep.screenshot} />}
      <Button size="sm" className="w-full" onClick={onShowScreen} disabled={!onShowScreen}>{t("m_d7fa9fc38d")}</Button>
    </div>}
  </div>;
}

function RunResult({ entry, newest, onShowScreen }: { entry: SessionRun; newest: boolean; onShowScreen?: () => void }) {
  const result = useRun(entry.id);
  const [open, setOpen] = useState(newest);
  const [now, setNow] = useState(() => new Date());
  const run = result.data;
  const active = !run || run.status === "queued" || run.status === "running";
  useEffect(() => setOpen(newest), [newest]);
  useEffect(() => {
    if (!active || result.error) return;
    const tick = setInterval(() => setNow(new Date()), 1000);
    const poll = setInterval(() => { void result.refetch(); }, 2000);
    return () => { clearInterval(tick); clearInterval(poll); };
  }, [active, result.error, result.refetch]);
  const duration = elapsed(run?.started_at ?? run?.created_at ?? entry.createdAt, run?.finished_at ?? null, now);
  return <li className="min-w-0 overflow-hidden rounded-[10px] border border-border bg-surface">
    <div className="flex min-w-0 items-center gap-2 px-3 py-2">
      <StatusBadge status={run?.status ?? "queued"} />
      <Link to={`/runs/${encodeURIComponent(entry.id)}`} className="min-w-0 truncate py-2 font-mono text-xs text-accent underline-offset-2 hover:underline focus-visible:outline-accent max-md:min-h-11">{entry.id.slice(0, 8)}</Link>
      <span className="ml-auto shrink-0 font-mono text-[11px] text-fg-subtle">{duration}</span>
      <button type="button" aria-label={t("m_9171d1d626", [entry.id, open ? t("m_0d2c2495e1") : t("m_5eec88277d")])} aria-expanded={open} onClick={() => setOpen(value => !value)} className="flex min-h-8 min-w-8 items-center justify-center rounded-lg text-fg-muted focus-visible:outline-accent max-md:min-h-11 max-md:min-w-11">{open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</button>
    </div>
    {open && <div className="min-w-0 space-y-3 border-t border-border p-3">
      <ErrorBox error={result.error} />
      {active && !result.error && <p className="text-xs text-running-fg"><span>{run?.status === "queued" ? t("m_1d4108abaf") : t("m_7478c0a9af")}</span> · {duration}</p>}
      {!active && run && run.tasks.map(task => <FinishedTask key={`${task.id}:${task.attempt}`} task={task} run={run} onShowScreen={onShowScreen} />)}
      {!active && run && !run.tasks.length && <p className="text-xs text-fg-subtle">{t("m_f14b1dc81f")}</p>}
    </div>}
  </li>;
}

export function RunResults({ runs, onShowScreen }: { runs: SessionRun[]; onShowScreen?: () => void }) {
  return <section className="min-w-0 space-y-3" aria-label={t("m_466944daa5")}>
    <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">{t("m_466944daa5")}</h2><span className="text-[11px] text-fg-subtle">{t("m_10e8c6a8d3")}</span></div>
    {!runs.length ? <Empty>{t("m_8d68076bf5")}</Empty> : <ul aria-label={t("m_7476d9b6bc")} className="space-y-3">{runs.map((entry, index) => <RunResult key={entry.id} entry={entry} newest={index === 0} onShowScreen={onShowScreen} />)}</ul>}
  </section>;
}
