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
  queued: { label: "대기 중", tone: "neutral" }, running: { label: "생성 중", tone: "ai" },
  succeeded: { label: "완료", tone: "passed" }, failed: { label: "실패", tone: "failed" }, cancelled: { label: "취소됨", tone: "neutral" },
};
const dataNotice = "flow 파일, 스크린샷, 화면 hierarchy, 실패 로그와 설명이 OpenAI로 전송됩니다. 환경 변수 값과 토큰은 보내지 않으며, AI 결과는 자동으로 커밋되지 않습니다.";

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
  const deviceName = hasReservation ? `${currentDevice?.model ?? "예약 기기"} · ${api.reservation!.device_serial}` : "예약 기기";
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
  try { validPath(targetPath); } catch { pathError = "워크스페이스 안의 올바른 경로를 입력하세요."; }
  const canSubmit = canWrite && Boolean(api.baseSha && prompt.trim() && !pathError && (mode !== "current" || canFix)) && !submit.isPending && !running;
  const generate = (event: FormEvent) => {
    event.preventDefault(); if (!canSubmit) return;
    const app = api.appChoice.app_build_id ? { app_build_id: api.appChoice.app_build_id } : api.appChoice.app ? { app: api.appChoice.app } : {};
    submit.mutate({ kind: "generate", workspace: api.workspace.name, base_sha: api.baseSha, prompt: prompt.trim(), target_path: targetPath.trim(), draft_changes: api.changes(),
      include_screen: Boolean(screen && hasReservation), auto_repair: Boolean(repair && hasReservation && hasApp), reservation_id: hasReservation ? api.reservation!.id : null,
      ...app, author_name: settings.authorName });
  };
  const tokens = ((status.month_input_tokens + status.month_output_tokens) / 1000).toLocaleString("ko-KR", { maximumFractionDigits: 1 });
  const resetJob = (applied?: boolean) => { setJob(null); setNotice(applied ? "선택한 파일을 에디터에 반영했습니다." : "AI 제안을 버렸습니다."); };
  return <div className="min-w-0 space-y-5 p-4 text-fg">
    <header className="flex flex-wrap items-center justify-between gap-2"><p className="min-w-0 break-all text-[11px] text-fg-subtle"><span className="font-mono">{status.model}</span> · 이번 달 {tokens}K 토큰</p>
      <Menu label="지난 작업" icon={<ChevronDown />} items={recent.data?.length ? recent.data.map(item => ({ label: <span className="block max-w-60 truncate" title={item.prompt}>{states[item.status].label} · {item.prompt || item.options.target_path || item.id.slice(0, 8)}</span>, disabled: submit.isPending, onClick: () => { submit.reset(); cancel.reset(); setJob(item.id); } })) : [{ label: recent.isLoading ? "불러오는 중…" : "지난 작업이 없습니다", disabled: true, onClick: () => {} }]} />
    </header>
    {recent.error && <ErrorBox error={recent.error} />}
    <form onSubmit={generate} className="min-w-0 space-y-4">
      <Segmented label="AI 생성 모드" value={mode} onChange={setMode} options={[{ value: "new", label: "새 flow 만들기" }, { value: "current", label: "현재 파일 고치기", disabled: !canFix }]} className="w-full [&>button]:flex-1 [&>button]:px-2 [&>button]:text-xs" />
      <Field label="대상 경로" hint={pathError || (mode === "current" ? "현재 파일의 변경안을 만듭니다." : "워크스페이스 기준의 새 flow 경로")}><Input aria-label="대상 경로" value={targetPath} readOnly={mode === "current"} onChange={event => setTarget(event.target.value)} aria-invalid={Boolean(pathError)} className="font-mono text-xs" /></Field>
      <Field label="설명"><Textarea required value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="어떤 동작을 테스트할까요? 단계와 확인할 내용을 적어 주세요." className="min-h-32 font-sans" /></Field>
      <div className="space-y-1">
        <Checkbox label={<span className="min-w-0 break-words text-xs">현재 화면 포함{hasReservation ? ` · ${deviceName}` : " · 기기 예약 필요"}</span>} disabled={!hasReservation || !canWrite} checked={screen && hasReservation} onChange={event => setScreen(event.target.checked)} />
        <div><Checkbox label={<span className="text-xs">자동 보정</span>} disabled={!hasReservation || !hasApp || !canWrite} checked={repair && hasReservation && hasApp} onChange={event => setRepair(event.target.checked)} /><p className="ml-6 text-[11px] leading-5 text-fg-subtle">예약 기기에서 실행해 통과할 때까지 최대 {maxRepairs}회{!hasReservation || !hasApp ? " · 기기 예약과 앱 선택 필요" : ""}</p></div>
      </div>
      {!canWrite && <p className="text-xs text-warning-fg">쓰기 작업에는 설정의 API 토큰이 필요합니다.</p>}
      <Button type="submit" variant="ai" icon={<Sparkles />} disabled={!canSubmit} className="w-full">{submit.isPending ? "요청 중…" : "생성"}</Button>
      {submit.error && <ErrorBox error={submit.error} />}
    </form>
    {id && <section aria-label="AI 작업" className="space-y-4 border-t border-border pt-4">
      {jobQuery.isLoading && <Loading label="AI 작업을 불러오는 중…" />}
      {jobQuery.error && <ErrorBox error={jobQuery.error} />}
      {foreign && <ErrorBox error={new Error("다른 워크스페이스의 AI 작업입니다. 해당 워크스페이스에서 열어 주세요.")} />}
      {job && <>
        <div className="flex items-center justify-between gap-2"><Badge tone={states[job.status].tone} aria-live="polite"><StatusDot tone={states[job.status].tone} />{cancelling ? "취소 중…" : states[job.status].label}</Badge><span className="font-mono text-[11px] text-fg-subtle">{job.id.slice(0, 8)}</span>{running && <Button type="button" aria-label="취소" size="sm" disabled={!canWrite || cancelling || cancel.isPending} onClick={() => cancel.mutate(job.id)}>{cancelling ? "취소 중…" : "취소"}</Button>}</div>
        <AttemptList attempts={job.attempts} maxRepairs={maxRepairs} device={job.options.reservation_id === api.reservation?.id ? deviceName : "예약 기기"} />
        {job.error_message && <ErrorBox error={new Error(job.error_message)} />}
        {cancel.error && <ErrorBox error={cancel.error} />}
        {job.result && job.status === "succeeded" && <ResultCard key={job.id} job={job} canWrite={canWrite} onDismiss={resetJob} />}
      </>}
    </section>}
    {notice && <p role="status" className="rounded-lg bg-ai-bg p-3 text-xs text-ai-fg">{notice}</p>}
    <p className="border-t border-border pt-4 text-[11px] leading-5 text-fg-subtle">{dataNotice}</p>
  </div>;
}
