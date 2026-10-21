import { useState } from "react";

import { useTaskSteps } from "../../api/queries";
import type { RunStep } from "../../api/types";
import { Badge, Empty, ErrorBox, Loading, StatusDot, cx } from "../../components/ui";
import { LINK, artifactUrl } from "./links";

const STATUS = {
  passed: { tone: "passed", label: "통과" }, failed: { tone: "failed", label: "실패" },
  warned: { tone: "warning", label: "경고" }, skipped: { tone: "neutral", label: "건너뜀" },
  running: { tone: "running", label: "실행 중" }, pending: { tone: "neutral", label: "대기" },
} as const;
function Step({ step, taskId }: { step: RunStep; taskId: string }) {
  const [open, setOpen] = useState(step.status === "failed" || step.status === "warned");
  const status = STATUS[step.status];
  const expandable = step.status === "failed" || step.status === "warned" || !!step.screenshot || !!step.hierarchy;
  return <li className="min-w-0 border-b border-border last:border-0">
    <button type="button" disabled={!expandable} aria-expanded={expandable ? open : undefined}
      onClick={() => setOpen(!open)} style={{ paddingLeft: 12 + Math.min(8, Math.max(0, step.depth)) * 14 }}
      className={cx("flex min-h-11 w-full items-start gap-2 py-3 pr-3 text-left focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-[-2px]", expandable && "hover:bg-surface-2")}>
      <StatusDot tone={status.tone} className="mt-2" />
      <span className="min-w-0 flex-1 break-words font-mono text-xs leading-5">{step.label}</span>
      <span className="flex shrink-0 flex-col items-end gap-1"><Badge tone={status.tone}>{status.label}</Badge><span className="text-[11px] text-fg-subtle">{step.duration_ms < 1000 ? `${step.duration_ms}ms` : `${Number((step.duration_ms / 1000).toFixed(1))}초`}</span></span>
    </button>
    {expandable && open && <div className="space-y-2 bg-surface-2 px-3 pb-3 pt-1">
      {step.screenshot && <a href={artifactUrl(taskId, step.screenshot)} target="_blank" rel="noreferrer" className={`block ${LINK}`}>
        <img alt={`${step.label} 스크린샷`} src={artifactUrl(taskId, step.screenshot)} loading="lazy" className="max-h-52 max-w-full rounded-lg border border-border object-contain" />
        <span className="mt-1 block text-xs">스크린샷 보기</span>
      </a>}
      {step.hierarchy && <a href={artifactUrl(taskId, step.hierarchy)} target="_blank" rel="noreferrer" className={`inline-flex min-h-11 items-center text-xs ${LINK}`}>화면 계층 보기</a>}
      {!step.screenshot && !step.hierarchy && <p className="text-xs text-fg-subtle">이 단계의 화면 산출물이 없습니다.</p>}
    </div>}
  </li>;
}
export function Steps({ taskId }: { taskId: string }) {
  const steps = useTaskSteps(taskId);
  return <div className="min-w-0 space-y-3">
    {steps.isPending && <Loading label="단계를 불러오는 중…" />}
    <ErrorBox error={steps.error} />
    {steps.isSuccess && !steps.data.flows.length && <Empty>단계 기록이 없습니다.</Empty>}
    {steps.data?.flows.map((flow, i) => <section key={`${flow.flow}:${i}`}>
      <h3 className="break-words rounded-lg bg-surface-2 px-3 py-2 text-xs font-semibold text-fg-muted">{flow.flow}</h3>
      <ol>{flow.steps.map((step, index) => <Step key={`${step.seq}:${index}`} step={step} taskId={taskId} />)}</ol>
    </section>)}
  </div>;
}
