import { localizeServerText, t, tp } from "../../lib/i18n";
import { formatNumber } from "../../lib/format";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Sparkles } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { apiJson, query } from "../../api/client";
import { keys, useAiJob, useAiStatus, useDevices } from "../../api/queries";
import type { AiJob, AiJobCreate, AiStatus } from "../../api/types";
import { useCanWrite } from "../../components/Layout";
import { Badge, Button, Checkbox, ErrorBox, Field, Input, Loading, Menu, Segmented, StatusDot, Textarea, type Tone } from "../../components/ui";
import { useSettings } from "../../lib/settings";
import { useEditor, validPath } from "../store";
import { AttemptList } from "./ai/AttemptList";
import { suggestedPath } from "./ai/changes";
import { ResultCard } from "./ai/ResultCard";

// Older servers omit max_repairs; the documented default is three repairs.
type PanelStatus = AiStatus & { max_repairs?: number };
const states: Record<AiJob["status"], { label: string; tone: Tone }> = {
  queued: { label: t("m_ec425b26f2"), tone: "neutral" }, running: { label: t("m_10fa67c6e8"), tone: "ai" },
  succeeded: { label: t("m_8d8680373c"), tone: "passed" }, failed: { label: t("m_732fe33ab1"), tone: "failed" }, cancelled: { label: t("m_3aa9e7eec4"), tone: "neutral" },
};
const dataNotice = t("m_af333149a6");

export function AiPanel() {
  const status = useAiStatus();
  if (status.error) return <div className="p-4"><ErrorBox error={status.error} /></div>;
  if (status.isLoading) return <Loading />;
  if (!status.data?.enabled) return null;
  return <EnabledAiPanel status={status.data} />;
}

function EnabledAiPanel({ status }: { status: PanelStatus }) {
  const api = useEditor(); const canWrite = useCanWrite(); const settings = useSettings(); const client = useQueryClient();
  const [params, setParams] = useSearchParams(); const id = params.get("aiJob") || null;
  const jobQuery = useAiJob(id); const devices = useDevices();
  const recent = useQuery({ queryKey: keys.aiJobs(api.workspace.id), queryFn: () => apiJson<AiJob[]>(`/ai/jobs${query({ workspace: api.workspace.id, limit: 20 })}`) });
  const [mode, setMode] = useState("new"); const [prompt, setPrompt] = useState(""); const [target, setTarget] = useState<string | null>(null);
  const [screen, setScreen] = useState(false); const [repair, setRepair] = useState(false); const [notice, setNotice] = useState("");
  // Acknowledging cancellation can still return a running job; wait for its terminal update.
  const [cancellingJobs, setCancellingJobs] = useState<string[]>([]);
  const hasReservation = api.reservation?.status === "active";
  const hasApp = Boolean(api.appChoice.app_build_id || api.appChoice.app);
  const currentDevice = devices.data?.find(d => d.serial === api.reservation?.device_serial);
  const deviceName = hasReservation ? t("m_78edd11d8a", [currentDevice?.model ?? t("m_3929e69887"), api.reservation!.device_serial]) : t("m_3929e69887");
  const maxRepairs = Number.isInteger(status.max_repairs) && status.max_repairs! >= 0 ? status.max_repairs! : 3;
  useEffect(() => { setScreen(false); setRepair(false); }, [api.reservation?.id, hasReservation]);
  useEffect(() => { if (!hasApp) setRepair(false); }, [hasApp]);
  const setJob = (next: string | null) => {
    setParams(previous => { const value = new URLSearchParams(previous); if (next) value.set("aiJob", next); else value.delete("aiJob"); return value; }, { replace: true });
    setNotice("");
  };
  const submit = useMutation({ mutationFn: (body: AiJobCreate) => apiJson<AiJob>("/ai/jobs", { method: "POST", json: body }), onSuccess: job => {
    client.setQueryData(keys.aiJob(job.id), job); setJob(job.id);
    void client.invalidateQueries({ queryKey: keys.aiJobs(api.workspace.id) }); void client.invalidateQueries({ queryKey: keys.aiStatus });
  } });
  const cancel = useMutation({ mutationFn: (jobId: string) => apiJson<AiJob>(`/ai/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" }),
    onMutate: jobId => { setCancellingJobs(previous => [...previous, jobId]); },
    onError: (_error, jobId) => { setCancellingJobs(previous => previous.filter(id => id !== jobId)); },
    onSuccess: job => {
      client.setQueryData(keys.aiJob(job.id), job); void client.invalidateQueries({ queryKey: keys.aiJobs(api.workspace.id) });
    } });
  const foreign = jobQuery.data && jobQuery.data.workspace_id !== api.workspace.id;
  const job = foreign ? undefined : jobQuery.data;
  const running = job?.status === "queued" || job?.status === "running";
  const cancelling = Boolean(job && running && cancellingJobs.includes(job.id));
  const canFix = Boolean(api.activePath && api.drafts[api.activePath]?.status !== "deleted" && !/\.(png|jpe?g|gif|webp|mp4|mov|mp3|wav)$/i.test(api.activePath));
  const targetPath = mode === "current" ? api.activePath ?? "" : target ?? suggestedPath(prompt);
  let pathError = "";
  try { validPath(targetPath); } catch { pathError = t("m_56f77e5793"); }
  const canSubmit = canWrite && Boolean(api.baseSha && prompt.trim() && !pathError && (mode !== "current" || canFix)) && !submit.isPending && !running;
  const generate = (event: FormEvent) => {
    event.preventDefault(); if (!canSubmit) return;
    const app = api.appChoice.app_build_id ? { app_build_id: api.appChoice.app_build_id } : api.appChoice.app ? { app: api.appChoice.app } : {};
    submit.mutate({ kind: "generate", workspace: api.workspace.name, base_sha: api.baseSha, prompt: prompt.trim(), target_path: targetPath.trim(), draft_changes: api.changes(),
      include_screen: Boolean(screen && hasReservation), auto_repair: Boolean(repair && hasReservation && hasApp), reservation_id: hasReservation ? api.reservation!.id : null,
      ...app, author_name: settings.authorName });
  };
  const tokens = formatNumber((status.month_input_tokens + status.month_output_tokens) / 1000, { maximumFractionDigits: 1 });
  const resetJob = (applied?: boolean) => { setJob(null); setNotice(applied ? t("m_fc45d9b139") : t("m_424cea13b9")); };
  return <div className="min-w-0 space-y-5 p-4 text-fg">
    <header className="flex flex-wrap items-center justify-between gap-2"><p className="min-w-0 break-all text-[11px] text-fg-subtle"><span className="font-mono">{localizeServerText(status.model)}</span> {t("ai.monthlyTokens", [tokens])}</p>
      <Menu label={t("m_f2d8b5d8b5")} icon={<ChevronDown />} items={recent.data?.length ? recent.data.map(item => ({ label: <span className="block max-w-60 truncate" title={item.prompt}>{states[item.status].label} · {item.prompt || item.options.target_path || item.id.slice(0, 8)}</span>, disabled: submit.isPending, onClick: () => { submit.reset(); cancel.reset(); setJob(item.id); } })) : [{ label: recent.isLoading ? t("m_c78656b445") : t("m_34504dd1e0"), disabled: true, onClick: () => {} }]} />
    </header>
    {recent.error && <ErrorBox error={recent.error} />}
    <form onSubmit={generate} className="min-w-0 space-y-4">
      <Segmented label={t("m_9fe10b6e15")} value={mode} onChange={setMode} options={[{ value: "new", label: t("m_5fe8f840a0") }, { value: "current", label: t("m_33b168b6e0"), disabled: !canFix }]} className="w-full [&>button]:flex-1 [&>button]:px-2 [&>button]:text-xs" />
      <Field label={t("m_172d663639")} hint={pathError || (mode === "current" ? t("m_2fb63fddea") : t("m_d365e93c3c"))}><Input aria-label={t("m_172d663639")} value={targetPath} readOnly={mode === "current"} onChange={event => setTarget(event.target.value)} aria-invalid={Boolean(pathError)} className="font-mono text-xs" /></Field>
      <Field label={t("m_841964364c")}><Textarea required value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={t("m_48fd719227")} className="min-h-32 font-sans" /></Field>
      <div className="space-y-1">
        <Checkbox label={<span className="min-w-0 break-words text-xs">{t("m_7074c53853")}{hasReservation ? ` · ${deviceName}` : t("m_b29a878e7c")}</span>} disabled={!hasReservation || !canWrite} checked={screen && hasReservation} onChange={event => setScreen(event.target.checked)} />
        <div><Checkbox label={<span className="text-xs">{t("m_d57c1e8f32")}</span>} disabled={!hasReservation || !hasApp || !canWrite} checked={repair && hasReservation && hasApp} onChange={event => setRepair(event.target.checked)} /><p className="ml-6 text-[11px] leading-5 text-fg-subtle">{tp("ai.repairLimit", maxRepairs)}{!hasReservation || !hasApp ? t("m_7906ad3680") : ""}</p></div>
      </div>
      {!canWrite && <p className="text-xs text-warning-fg">{t("m_8813d1f103")}</p>}
      <Button type="submit" variant="ai" icon={<Sparkles />} disabled={!canSubmit} className="w-full">{submit.isPending ? t("m_5449e1a686") : t("ai.generate")}</Button>
      {submit.error && <ErrorBox error={submit.error} />}
    </form>
    {id && <section aria-label={t("m_d92068b48a")} className="space-y-4 border-t border-border pt-4">
      {jobQuery.isLoading && <Loading label={t("m_dbea57088b")} />}
      {jobQuery.error && <ErrorBox error={jobQuery.error} />}
      {foreign && <ErrorBox error={new Error(t("m_6a6814a788"))} />}
      {job && <>
        <div className="flex items-center justify-between gap-2"><Badge tone={states[job.status].tone} aria-live="polite"><StatusDot tone={states[job.status].tone} />{cancelling ? t("m_70ce557797") : states[job.status].label}</Badge><span className="font-mono text-[11px] text-fg-subtle">{job.id.slice(0, 8)}</span>{running && <Button type="button" aria-label={t("m_19b2d19bc1")} size="sm" disabled={!canWrite || cancelling || cancel.isPending} onClick={() => cancel.mutate(job.id)}>{cancelling ? t("m_70ce557797") : t("m_19b2d19bc1")}</Button>}</div>
        <AttemptList attempts={job.attempts} maxRepairs={maxRepairs} device={job.options.reservation_id === api.reservation?.id ? deviceName : t("m_3929e69887")} />
        {job.error_message && <ErrorBox error={new Error(job.error_message)} />}
        {cancel.error && <ErrorBox error={cancel.error} />}
        {job.result && job.status === "succeeded" && <ResultCard key={job.id} job={job} canWrite={canWrite} onDismiss={resetJob} />}
      </>}
    </section>}
    {notice && <p role="status" className="rounded-lg bg-ai-bg p-3 text-xs text-ai-fg">{notice}</p>}
    <p className="border-t border-border pt-4 text-[11px] leading-5 text-fg-subtle">{dataNotice}</p>
  </div>;
}
