import { t } from "../../../lib/i18n";
import { Check, CircleX, Clock, LoaderCircle, Play, Sparkles } from "lucide-react";
import { Link } from "react-router";
import type { AiAttempt } from "../../../api/types";
import { cx, type Tone } from "../../../components/ui";

// Run attempts use status="ok" while queued/running; detail carries the live state.
const runStates: Record<string, { label: string; tone: Tone }> = {
  queued: { label: t("m_df72a8753d"), tone: "neutral" }, running: { label: t("m_0d01d3e76a"), tone: "running" },
  passed: { label: t("m_66409b6272"), tone: "passed" }, failed: { label: t("m_732fe33ab1"), tone: "failed" },
  error: { label: t("m_3efa8afd60"), tone: "warning" }, cancelled: { label: t("m_19b2d19bc1"), tone: "neutral" },
};
const tones: Partial<Record<Tone, string>> = {
  neutral: "bg-neutral-bg text-neutral-fg", running: "bg-running-bg text-running-fg",
  passed: "bg-passed-bg text-passed-fg", failed: "bg-failed-bg text-failed-fg",
  warning: "bg-warning-bg text-warning-fg", ai: "bg-ai-bg text-ai-fg",
};

export function AttemptList({ attempts, maxRepairs, device }: { attempts: AiAttempt[]; maxRepairs: number; device: string }) {
  if (!attempts.length) return <p className="text-xs text-fg-muted">{t("m_e45104058e")}</p>;
  return <ol aria-label={t("m_c107fd8fc7")} className="space-y-3">
    {attempts.map((attempt, index) => {
      const failed = attempt.status === "failed";
      const runState = attempt.kind === "run" ? runStates[attempt.detail] : undefined;
      const tone = runState?.tone ?? (failed ? "failed" : attempt.kind === "generate" ? "ai" : "passed");
      const Icon = runState?.label === t("m_0d01d3e76a") ? LoaderCircle : runState?.label === t("m_df72a8753d") ? Clock
        : failed ? CircleX : attempt.kind === "generate" ? Sparkles : attempt.kind === "run" ? Play : Check;
      const title = attempt.kind === "generate" ? t("m_1442fb6696") : attempt.kind === "validation"
        ? failed ? t("m_ad7a49741a") : t("m_b21e21821c")
        : t("m_7722aed7bd", [attempt.n, 1 + maxRepairs, device, runState?.label ?? (failed ? t("m_732fe33ab1") : t("m_66409b6272"))]);
      const issue = attempt.issues[0];
      return <li key={`${attempt.n}-${attempt.kind}-${index}`} className="flex min-w-0 gap-2.5">
        <span className={cx("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full", tones[tone])}><Icon aria-hidden="true" className="size-3.5" strokeWidth={1.8} /></span>
        <div className="min-w-0 flex-1 text-xs"><p className="break-words font-medium text-fg">{title}</p>
          {attempt.kind === "generate" && <p className="mt-1 text-fg-subtle">{t("m_f390b3311c")} {attempt.input_tokens.toLocaleString("ko-KR")} {t("m_d5250a7682")} {attempt.output_tokens.toLocaleString("ko-KR")} {t("m_243f5b79dd")}</p>}
          {issue && <p className="mt-1 break-words text-failed-fg">{issue.path}{issue.line ? `:${issue.line}` : ""} · {issue.message}</p>}
          {attempt.detail && !runState && <p className="mt-1 whitespace-pre-wrap break-words text-fg-muted">{attempt.detail}</p>}
          {attempt.run_id && <Link className="mt-1 inline-flex min-h-8 items-center text-accent underline underline-offset-2 max-md:min-h-11" to={`/runs/${encodeURIComponent(attempt.run_id)}`}>{t("m_8a1d3a25d4")} {attempt.run_id.slice(0, 8)}</Link>}
        </div>
      </li>;
    })}
  </ol>;
}
