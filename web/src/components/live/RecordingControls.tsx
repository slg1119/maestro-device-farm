import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Circle, Copy, FileCode2, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { cancelRecording, keys, startRecording, stopRecording, useActiveRecordings, useAiStatus, useRecording, useWorkspaces } from "../../api/queries";
import type { Recording, RecordingCreate, Workspace } from "../../api/types";
import { Button, Checkbox, ErrorBox, Field, Input, Modal, Select, StatusDot } from "../ui";
import { stepYamlLine } from "./recordingYaml";

export interface RecordingControlsProps {
  serial: string;
  canControl: boolean;
  workspace?: Workspace;
  appPackage?: string | null;
  onComplete?: (recording: Recording) => void;
  enlarged?: boolean;
}
type Action = { kind: "start"; body: RecordingCreate } | { kind: "stop"; id: string; ai: boolean } | { kind: "cancel"; id: string };

export function RecordingControls({ serial, canControl, workspace, appPackage, onComplete, enlarged = false }: RecordingControlsProps) {
  const client = useQueryClient(); const navigate = useNavigate();
  const workspaces = useWorkspaces(); const ai = useAiStatus(); const active = useActiveRecordings(serial);
  const [id, setId] = useState<string | null>(null);
  const recordingId = active.data?.[0]?.id ?? id;
  const detail = useRecording(recordingId);
  const recording = detail.data ?? active.data?.find(item => item.id === recordingId);
  const [dialog, setDialog] = useState<"start" | "stop" | null>(null);
  const [workspaceId, setWorkspaceId] = useState("");
  const [appInput, setAppInput] = useState(""); const [includeLaunch, setIncludeLaunch] = useState(false);
  const [notice, setNotice] = useState(""); const [copyError, setCopyError] = useState<unknown>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // Each device has a keyed instance, so a late result cannot reach a new editor.
  const pinnedWorkspaceId = dialog === "start" ? null : recording?.workspace_id;
  const selected = workspace ?? workspaces.data?.find(item => item.id === (pinnedWorkspaceId || workspaceId));
  const running = recording?.status === "active";
  const polishWorkspaceReady = Boolean(recording?.workspace_id && selected?.head_sha);
  const change = useMutation({
    mutationFn: (action: Action) => action.kind === "start" ? startRecording(serial, action.body) : action.kind === "stop" ? stopRecording(action.id, action.ai) : cancelRecording(action.id),
    onSuccess: async (value) => {
      await client.cancelQueries({ queryKey: keys.recording(value.id) });
      await client.cancelQueries({ queryKey: keys.deviceRecordings(serial) });
      setId(value.id); client.setQueryData(keys.recording(value.id), value);
      client.setQueryData(keys.deviceRecordings(serial), value.status === "active" ? [value] : []);
      void client.invalidateQueries({ queryKey: keys.deviceRecordings(serial) });
      setDialog(null); setCopyError(null);
      setNotice(value.status === "cancelled" ? "녹화를 취소했습니다." : "");
      if (value.status === "done" && alive.current) onComplete?.(value);
    },
  });
  const busy = change.isPending;
  const openStart = () => {
    if (!canControl || busy || running) return;
    const pkg = appPackage ?? selected?.default_app_package ?? "";
    setAppInput(pkg); setIncludeLaunch(Boolean(pkg)); setNotice(""); setCopyError(null); change.reset(); setDialog("start");
  };
  const chooseWorkspace = (nextId: string) => {
    setWorkspaceId(nextId);
    const pkg = workspaces.data?.find(item => item.id === nextId)?.default_app_package ?? "";
    setAppInput(pkg); setIncludeLaunch(Boolean(pkg));
  };
  const picker = <Field label="워크스페이스"><Select aria-label="워크스페이스" value={selected?.id ?? ""} disabled={Boolean(workspace || pinnedWorkspaceId) || busy} onChange={event => chooseWorkspace(event.target.value)}>
    <option value="">워크스페이스 선택</option>{(workspace ? [workspace] : workspaces.data ?? []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
  </Select></Field>;
  const closeDialog = () => { if (!busy) { setDialog(null); change.reset(); } };
  const finish = (polish: boolean) => {
    if (!canControl || busy || !running || !recording || (polish && (!ai.data?.enabled || !polishWorkspaceReady))) return;
    change.mutate({ kind: "stop", id: recording.id, ai: polish });
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(recording!.yaml!); if (alive.current) { setNotice("YAML을 복사했습니다."); setCopyError(null); } }
    catch { if (alive.current) setCopyError(new Error("YAML을 복사하지 못했습니다. 클립보드 권한을 확인하세요.")); }
  };
  const openEditor = () => {
    if (!selected || !recording) return;
    const params = new URLSearchParams(recording.ai_job_id ? { aiJob: recording.ai_job_id } : { draft: recording.id });
    navigate(`/editor/${encodeURIComponent(selected.name)}?${params}`);
  };
  const error = change.error ?? detail.error ?? (canControl ? active.error : null) ?? copyError;
  return <div className="min-w-0 space-y-3 border-t border-border pt-3">
    {running && recording ? <>
      <div className="flex flex-wrap items-center justify-between gap-2"><span role="status" className="inline-flex items-center gap-2 text-xs text-failed-fg"><StatusDot tone="failed" />녹화 중 · {recording.steps.length}단계</span><Button size="sm" icon={<Square />} disabled={!canControl || busy} onClick={() => { change.reset(); setDialog("stop"); }}>중지</Button></div>
      <ol aria-label="녹화 단계" className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-border bg-surface-2 p-2">{recording.steps.map((step, index) => <li key={`${index}:${step.ts}`}><code className="block whitespace-pre-wrap break-all text-[11px]">{stepYamlLine(step)}</code></li>)}</ol>
      {!canControl && <p className="text-xs text-fg-muted">녹화를 중지하려면 기기 조작 권한이 필요합니다.</p>}
    </> : canControl && <Button size="sm" icon={<Circle className="text-failed-fg" />} disabled={busy || active.isLoading || Boolean(active.error) || recording?.status === "stopping"} onClick={openStart}>녹화</Button>}
    {!dialog && <ErrorBox error={error} />}
    {recording?.status === "done" && !onComplete && <section aria-label="녹화 결과" className="min-w-0 space-y-3">
      <h3 className="text-sm font-semibold">녹화 완료</h3>
      {recording.yaml !== null && <><pre aria-label="녹화 YAML" className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-surface-2 p-3 font-mono text-[11px]">{recording.yaml}</pre><Button size="sm" icon={<Copy />} onClick={() => { void copy(); }}>복사</Button></>}
      {recording.ai_job_id && <p className="text-xs text-ai-fg">AI가 녹화를 다듬고 있습니다. 에디터의 AI 탭에서 확인하세요.</p>}
      {picker}<ErrorBox error={workspaces.error} /><Button size="sm" icon={<FileCode2 />} disabled={!selected} onClick={openEditor}>에디터에서 열기</Button>
    </section>}
    {notice && <p role="status" className="text-xs text-passed-fg">{notice}</p>}
    {dialog === "start" && <Modal title="녹화 시작" onClose={closeDialog} elevated={enlarged}><form className="space-y-4" onSubmit={event => {
      event.preventDefault(); if (!canControl || busy || running) return;
      change.mutate({ kind: "start", body: { include_launch_app: includeLaunch && Boolean(appInput.trim()), ...(selected ? { workspace: selected.name } : {}), ...(appInput.trim() ? { app_package: appInput.trim() } : {}) } });
    }}>
      <p className="text-sm leading-6 text-fg-muted">기기를 조작하면 Maestro 단계로 기록합니다.</p>{picker}<ErrorBox error={workspaces.error} />
      <Field label="앱 패키지"><Input aria-label="앱 패키지" placeholder="예: org.wikipedia" value={appInput} disabled={busy} onChange={event => { setAppInput(event.target.value); setIncludeLaunch(Boolean(event.target.value.trim())); }} className="font-mono text-xs" /></Field>
      <Checkbox label="launchApp 포함" checked={includeLaunch && Boolean(appInput.trim())} disabled={busy || !appInput.trim()} onChange={event => setIncludeLaunch(event.target.checked)} />
      <ErrorBox error={error} /><div className="flex flex-wrap justify-end gap-2"><Button disabled={busy} onClick={closeDialog}>닫기</Button><Button type="submit" variant="primary" disabled={!canControl || busy}>{busy ? "시작 중…" : "시작"}</Button></div>
    </form></Modal>}
    {dialog === "stop" && <Modal title="녹화 중지" onClose={closeDialog} elevated={enlarged}><div className="space-y-3"><p className="text-sm text-fg-muted">기록한 단계를 어떻게 사용할까요?</p>
      <Button className="w-full" variant="primary" disabled={!canControl || busy || !running} onClick={() => finish(false)}>그대로 YAML 만들기</Button>
      {ai.data?.enabled && <><Button className="w-full" variant="ai" disabled={!canControl || busy || !running || !polishWorkspaceReady} onClick={() => finish(true)}>AI로 다듬기</Button>{!polishWorkspaceReady && <p className="text-xs text-fg-muted">{recording?.workspace_id ? "AI로 다듬으려면 워크스페이스를 동기화하세요." : "AI로 다듬으려면 워크스페이스를 지정해 녹화를 시작하세요."}</p>}</>}
      <Button className="w-full" disabled={!canControl || busy || !running} onClick={() => { if (canControl && recording && !busy) change.mutate({ kind: "cancel", id: recording.id }); }}>취소</Button>
      {busy && <p role="status" className="text-xs text-fg-muted">녹화를 마무리하는 중…</p>}<ErrorBox error={error} />
    </div></Modal>}
  </div>;
}
