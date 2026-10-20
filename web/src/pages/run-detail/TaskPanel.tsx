import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { API, apiFetch } from "../../api/client";
import { useArtifacts } from "../../api/queries";
import type { CaseResult, Task } from "../../api/types";
import { StatusBadge } from "../../components/StatusBadge";
import { Button, Card, Empty, ErrorBox, Loading } from "../../components/ui";
import { formatBytes } from "../../lib/format";

const LOG_LIMIT = 200 * 1024;
const LINK = "text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2";

function artifactPath(taskId: string, path: string): string {
  return `/tasks/${encodeURIComponent(taskId)}/artifacts/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function LogPreview({ task, path }: { task: Task; path: string }) {
  const [open, setOpen] = useState(false);
  const log = useQuery({
    queryKey: ["artifact-log", task.id, task.attempt, task.status, path],
    enabled: open,
    queryFn: async ({ signal }) => {
      const response = await apiFetch(artifactPath(task.id, path), { signal });
      const bytes = new Uint8Array(await response.arrayBuffer());
      let start = Math.max(0, bytes.length - LOG_LIMIT);
      // Skip a partial UTF-8 character at the retained tail's boundary.
      while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start += 1;
      return { text: new TextDecoder().decode(bytes.subarray(start)), truncated: bytes.length > LOG_LIMIT };
    },
  });
  return (
    <div className="min-w-0 space-y-2">
      <Button size="sm" aria-label={`${path} 로그 ${open ? "닫기" : "보기"}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        로그 {open ? "닫기" : "보기"}
      </Button>
      {open && (
        <div className="space-y-2">
          {log.isPending && <Loading label="로그를 불러오는 중…" />}
          <ErrorBox error={log.error} />
          {log.data && <>
            {log.data.truncated && <p className="text-xs text-slate-500">마지막 200KB만 표시</p>}
            <pre className="max-h-80 max-w-full overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-100">{log.data.text}</pre>
          </>}
        </div>
      )}
    </div>
  );
}

export function TaskPanel({ task, results }: { task: Task; results: CaseResult[] }) {
  const artifacts = useArtifacts(task.id);
  const files = artifacts.data?.files ?? [];
  const images = files.filter((file) => /\.(png|jpe?g)$/i.test(file.path));
  const videos = files.filter((file) => /\.(mp4|webm)$/i.test(file.path));
  const failures = results.filter((result) => result.task_id === task.id && result.failure_message);
  const taskError = [task.error_code, task.error_message].filter(Boolean).join(": ");

  return (
    <Card className="min-w-0 space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="break-all text-base font-semibold">task {task.id} 산출물</h2>
        <StatusBadge status={task.status} />
        <span className="text-xs text-slate-500">{task.attempt}회차</span>
      </div>
      {taskError && <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-amber-50 p-3 text-xs text-amber-900">{taskError}</pre>}
      {failures.map((result, index) => (
        <div key={`${result.flow_name}-${index}`} className="min-w-0 space-y-1">
          <h3 className="break-words text-sm font-medium">{result.flow_name}</h3>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-red-50 p-3 text-xs text-red-900">{result.failure_message}</pre>
        </div>
      ))}
      {artifacts.isPending && <Loading label="산출물을 불러오는 중…" />}
      <ErrorBox error={artifacts.error} />
      {artifacts.isSuccess && !files.length && <Empty>산출물이 없습니다.</Empty>}
      {!!images.length && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((file) => (
            <a key={file.path} href={`${API}${artifactPath(task.id, file.path)}`} target="_blank" rel="noreferrer" className="min-w-0 rounded border border-slate-200 p-2 focus-visible:outline-2 focus-visible:outline-slate-500">
              <img src={`${API}${artifactPath(task.id, file.path)}`} alt={file.path} loading="lazy" className="mx-auto h-48 max-w-full object-contain" />
              <span className="mt-2 block break-all text-xs text-slate-500">{file.path}</span>
            </a>
          ))}
        </div>
      )}
      {!!videos.length && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {videos.map((file) => (
            <div key={file.path} className="min-w-0 space-y-1">
              <video controls preload="metadata" src={`${API}${artifactPath(task.id, file.path)}`} aria-label={file.path} className="max-h-96 w-full rounded bg-slate-950" />
              <p className="break-all text-xs text-slate-500">{file.path}</p>
            </div>
          ))}
        </div>
      )}
      {!!files.length && (
        <ul className="divide-y divide-slate-100">
          {files.map((file) => (
            <li key={file.path} className="min-w-0 space-y-2 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <a href={`${API}${artifactPath(task.id, file.path)}`} download aria-label={`${file.path} 다운로드`} className={`${LINK} min-w-0 break-all`}>{file.path}</a>
                <span className="shrink-0 text-xs text-slate-500">{formatBytes(file.size)}</span>
              </div>
              {/(^|\/)(maestro\.log|logcat\.txt)$/.test(file.path) && <LogPreview task={task} path={file.path} />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
