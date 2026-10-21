import { Check, CircleX, Clock, LoaderCircle, Play, Sparkles } from "lucide-react";
import { Link } from "react-router";
import type { AiAttempt } from "../../../api/types";
import { cx, type Tone } from "../../../components/ui";

// Run attempts use status="ok" while queued/running; detail carries the live state.
const runStates: Record<string, { label: string; tone: Tone }> = {
  queued: { label: "대기", tone: "neutral" }, running: { label: "실행 중", tone: "running" },
  passed: { label: "통과", tone: "passed" }, failed: { label: "실패", tone: "failed" },
  error: { label: "오류", tone: "warning" }, cancelled: { label: "취소", tone: "neutral" },
};
const tones: Partial<Record<Tone, string>> = {
  neutral: "bg-neutral-bg text-neutral-fg", running: "bg-running-bg text-running-fg",
  passed: "bg-passed-bg text-passed-fg", failed: "bg-failed-bg text-failed-fg",
  warning: "bg-warning-bg text-warning-fg", ai: "bg-ai-bg text-ai-fg",
};

export function AttemptList({ attempts, maxRepairs, device }: { attempts: AiAttempt[]; maxRepairs: number; device: string }) {
  if (!attempts.length) return <p className="text-xs text-fg-muted">변경안 생성을 기다리고 있습니다…</p>;
  return <ol aria-label="AI 시도 이력" className="space-y-3">
    {attempts.map((attempt, index) => {
      const failed = attempt.status === "failed";
      const runState = attempt.kind === "run" ? runStates[attempt.detail] : undefined;
      const tone = runState?.tone ?? (failed ? "failed" : attempt.kind === "generate" ? "ai" : "passed");
      const Icon = runState?.label === "실행 중" ? LoaderCircle : runState?.label === "대기" ? Clock
        : failed ? CircleX : attempt.kind === "generate" ? Sparkles : attempt.kind === "run" ? Play : Check;
      const title = attempt.kind === "generate" ? "변경안 생성" : attempt.kind === "validation"
        ? failed ? "문법 검사 실패 → 다시 요청" : "문법 검사 통과"
        : `실행 ${attempt.n}/${1 + maxRepairs} · ${device} · ${runState?.label ?? (failed ? "실패" : "통과")}`;
      const issue = attempt.issues[0];
      return <li key={`${attempt.n}-${attempt.kind}-${index}`} className="flex min-w-0 gap-2.5">
        <span className={cx("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full", tones[tone])}><Icon aria-hidden="true" className="size-3.5" strokeWidth={1.8} /></span>
        <div className="min-w-0 flex-1 text-xs"><p className="break-words font-medium text-fg">{title}</p>
          {attempt.kind === "generate" && <p className="mt-1 text-fg-subtle">입력 {attempt.input_tokens.toLocaleString("ko-KR")} · 출력 {attempt.output_tokens.toLocaleString("ko-KR")} 토큰</p>}
          {issue && <p className="mt-1 break-words text-failed-fg">{issue.path}{issue.line ? `:${issue.line}` : ""} · {issue.message}</p>}
          {attempt.detail && !runState && <p className="mt-1 whitespace-pre-wrap break-words text-fg-muted">{attempt.detail}</p>}
          {attempt.run_id && <Link className="mt-1 inline-flex min-h-8 items-center text-accent underline underline-offset-2 max-md:min-h-11" to={`/runs/${encodeURIComponent(attempt.run_id)}`}>실행 보기 · {attempt.run_id.slice(0, 8)}</Link>}
        </div>
      </li>;
    })}
  </ol>;
}
