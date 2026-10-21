import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";

import { apiFetch } from "../../api/client";
import { useArtifacts } from "../../api/queries";
import type { CaseResult, Device, RunDetail, Task } from "../../api/types";
import { StatusBadge } from "../../components/StatusBadge";
import { Button, Card, Empty, ErrorBox, Loading, Tabs } from "../../components/ui";
import { formatBytes } from "../../lib/format";
import { AiFix } from "./AiFix";
import { deviceLabel } from "./MatrixGrid";
import { Steps } from "./Steps";
import { ACTION_LINK, LINK, artifactPath, artifactUrl, editorUrl } from "./links";

const LOG_LIMIT = 200 * 1024;
const TABS = [{ value: "steps", label: "단계" }, { value: "screenshots", label: "스크린샷" }, { value: "maestro", label: "maestro.log" }, { value: "logcat", label: "logcat" }, { value: "files", label: "파일" }] as const;
type Tab = typeof TABS[number]["value"];

function LogPreview({ task, path }: { task: Task; path: string }) {
  const [open, setOpen] = useState(false);
  const log = useQuery({
    queryKey: ["artifact-log", task.id, task.attempt, task.status, path], enabled: open,
    queryFn: async ({ signal }) => {
      const response = await apiFetch(artifactPath(task.id, path), { signal });
      const bytes = new Uint8Array(await response.arrayBuffer());
      let start = Math.max(0, bytes.length - LOG_LIMIT);
      while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start += 1;
      return { text: new TextDecoder().decode(bytes.subarray(start)), truncated: bytes.length > LOG_LIMIT };
    },
  });
  return <div className="min-w-0 space-y-2">
    <Button size="sm" aria-label={`${path} 로그 ${open ? "닫기" : "보기"}`} aria-expanded={open} onClick={() => setOpen(!open)}>로그 {open ? "닫기" : "보기"}</Button>
    {open && <div className="space-y-2">
      {log.isPending && <Loading label="로그를 불러오는 중…" />}<ErrorBox error={log.error} />
      {log.data && <>{log.data.truncated && <p className="text-xs text-fg-subtle">마지막 200KB만 표시</p>}
        <pre className="max-h-80 max-w-full overflow-auto rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs text-fg">{log.data.text}</pre></>}
    </div>}
  </div>;
}

export function TaskPanel({ task, results, run, devices, selectedFlow }: { task: Task; results: CaseResult[]; run: RunDetail; devices: Device[]; selectedFlow?: string | null }) {
  const [tab, setTab] = useState<Tab>("steps");
  const artifacts = useArtifacts(task.id);
  const files = artifacts.data?.files ?? [];
  const images = files.filter((file) => /\.(png|jpe?g)$/i.test(file.path));
  const videos = files.filter((file) => /\.(mp4|webm)$/i.test(file.path));
  const failures = results.filter((result) => result.task_id === task.id && result.failure_message);
  const taskError = [task.error_code, task.error_message].filter(Boolean).join(": ");
  const selectedPath = selectedFlow && task.flows.find((path) => path === selectedFlow || path.split("/").at(-1)?.replace(/\.ya?ml$/, "") === selectedFlow);
  const flowPaths = selectedPath ? [selectedPath] : task.flows;
  const visibleFiles = files.filter((file) => tab === "files" || (tab === "maestro" ? /(^|\/)maestro\.log$/.test(file.path) : tab === "logcat" && /(^|\/)logcat(\.txt|\.log)?$/.test(file.path)));
  return <Card className="min-w-0 space-y-4 p-4">
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="min-w-0 break-all font-mono text-sm font-semibold">task {task.id} 산출물</h2>
      <StatusBadge status={task.status} /><span className="text-xs text-fg-subtle">{task.attempt}회차</span>
    </div>
    <div className="space-y-1 text-xs text-fg-muted"><p className="break-words">flow: {flowPaths.join(", ") || "-"}</p><p className="break-all">기기: {deviceLabel(task.device_serial, devices)}</p></div>
    {taskError && <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-warning-bg p-3 font-mono text-xs text-warning-fg">{taskError}</pre>}
    {failures.map((result, index) => <div key={`${result.flow_name}:${index}`} className="min-w-0 space-y-1">
      <h3 className="break-words text-xs font-semibold text-fg-muted">{result.flow_name}</h3><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-failed-bg p-3 font-mono text-xs text-failed-fg">{result.failure_message}</pre>
    </div>)}
    {run.flow_source !== "upload" && run.workspace_id && run.commit_sha && <div className="flex flex-wrap gap-2">{flowPaths.map((path) => <Link key={path} to={editorUrl(run.workspace_id!, run.commit_sha!, { file: path })} className={ACTION_LINK} aria-label={flowPaths.length === 1 ? "에디터에서 열기" : `${path} 에디터에서 열기`}>에디터에서 열기{flowPaths.length > 1 ? ` · ${path}` : ""}</Link>)}</div>}
    <AiFix run={run} task={task} />
    <Tabs label="task 산출물" options={TABS} value={tab} onChange={setTab} />
    <div role="tabpanel" aria-label={TABS.find((item) => item.value === tab)!.label} className="min-w-0">
      {tab === "steps" && <Steps taskId={task.id} />}
      {artifacts.isPending && <Loading label="산출물을 불러오는 중…" />}<ErrorBox error={artifacts.error} />
      {artifacts.isSuccess && !files.length && <Empty>산출물이 없습니다.</Empty>}
      {tab === "screenshots" && <>
        {!!files.length && !images.length && <Empty>스크린샷이 없습니다.</Empty>}
        <div className="grid grid-cols-2 gap-3">{images.map((file) => <a key={file.path} href={artifactUrl(task.id, file.path)} target="_blank" rel="noreferrer" className="min-w-0 rounded-lg border border-border p-2 focus-visible:outline-2 focus-visible:outline-accent">
          <img src={artifactUrl(task.id, file.path)} alt={file.path} loading="lazy" className="mx-auto h-48 max-w-full object-contain" /><span className="mt-2 block break-all text-xs text-fg-subtle">{file.path}</span>
        </a>)}</div>
      </>}
      {tab === "files" && !!videos.length && <div className="mb-4 space-y-3">{videos.map((file) => <div key={file.path} className="min-w-0 space-y-1"><video controls preload="metadata" src={artifactUrl(task.id, file.path)} aria-label={file.path} className="max-h-96 w-full rounded-lg bg-surface-2" /><p className="break-all text-xs text-fg-subtle">{file.path}</p></div>)}</div>}
      {(tab === "files" || tab === "maestro" || tab === "logcat") && <>
        {!!files.length && !visibleFiles.length && <Empty>로그 파일이 없습니다.</Empty>}
        <ul className="divide-y divide-border">{visibleFiles.map((file) => <li key={file.path} className="min-w-0 space-y-2 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><a href={artifactUrl(task.id, file.path)} download aria-label={`${file.path} 다운로드`} className={`${LINK} min-w-0 break-all`}>{file.path}</a><span className="shrink-0 text-fg-subtle">{formatBytes(file.size)}</span></div>
          {/(^|\/)(maestro\.log|logcat(\.txt|\.log)?)$/.test(file.path) && <LogPreview task={task} path={file.path} />}
        </li>)}</ul>
      </>}
    </div>
  </Card>;
}
