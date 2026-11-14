import { t } from "../../lib/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { ApiError, apiFetch, apiJson, query } from "../../api/client";
import { keys, useAiJob, useAiStatus } from "../../api/queries";
import type { AiJob, RunDetail, Task } from "../../api/types";
import { useCanWrite } from "../../components/Layout";
import { Badge, Button, ErrorBox, Loading, cx } from "../../components/ui";
import { lineDiff } from "./diff";
import { ACTION_LINK, editorUrl } from "./links";

function FileDiff({ job, file }: { job: AiJob; file: { path: string; content: string } }) {
  const original = useQuery({
    queryKey: keys.workspaceFile(job.workspace_id, job.base_sha, file.path),
    queryFn: async ({ signal }) => {
      try {
        const response = await apiFetch(`/workspaces/${encodeURIComponent(job.workspace_id)}/files/${file.path.split("/").map(encodeURIComponent).join("/")}${query({ ref: job.base_sha })}`, { signal });
        return await response.text();
      } catch (error) {
        if (error instanceof ApiError && error.code === "file_not_found") return "";
        throw error;
      }
    },
  });
  return <section aria-label={t("m_229508b3ad", [file.path])} className="min-w-0 overflow-hidden rounded-lg border border-border">
    <h4 className="break-all border-b border-border bg-surface-2 px-3 py-2 font-mono text-xs">{file.path}</h4>
    {original.isPending && <Loading label={t("m_b79eb8a465")} />}
    <ErrorBox error={original.error} />
    {original.data !== undefined && <pre className="max-h-80 overflow-auto py-2 font-mono text-xs leading-6">
      {lineDiff(original.data, file.content).map((line, i) => <span key={i} className={cx("block min-w-fit px-3", line.kind === "added" ? "bg-passed-bg text-passed-fg" : line.kind === "removed" ? "bg-failed-bg text-failed-fg" : "text-fg-muted")}>
        {`${line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "} ${line.text}`}
      </span>)}
    </pre>}
  </section>;
}

const JOB_LABEL = { queued: t("m_df72a8753d"), running: t("m_0d01d3e76a"), succeeded: t("m_8d8680373c"), failed: t("m_732fe33ab1"), cancelled: t("m_19b2d19bc1") };
export function AiFix({ run, task }: { run: RunDetail; task: Task }) {
  const status = useAiStatus();
  const canWrite = useCanWrite();
  const client = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useAiJob(jobId);
  const create = useMutation({
    mutationFn: () => apiJson<AiJob>("/ai/jobs", { method: "POST", json: { kind: "fix", source_task_id: task.id } }),
    onSuccess: (created) => { client.setQueryData(keys.aiJob(created.id), created); setJobId(created.id); },
  });
  if (!(task.status === "failed" || task.status === "error") || !(run.flow_source === "workspace" || run.flow_source === "draft") || !run.workspace_id || !status.data?.enabled) return null;
  const active = job.data?.status === "running" || job.data?.status === "queued";
  return <section aria-label={t("m_a45032373b")} className="min-w-0 space-y-3 rounded-lg border border-ai/25 bg-ai-bg p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Button variant="ai" icon={<Sparkles />} disabled={!canWrite || create.isPending || active} onClick={() => create.mutate()}>{t("m_a45032373b")}</Button>
      {job.data && <Badge tone="ai">{JOB_LABEL[job.data.status]}</Badge>}
    </div>
    <ErrorBox error={create.error ?? job.error} />
    {jobId && job.isPending && <Loading label={t("m_dbea57088b")} />}
    {active && <p role="status" className="text-sm text-ai-fg">{t("m_33b070f517")}</p>}
    {!!job.data?.attempts.length && <ol className="space-y-1 text-xs text-fg-muted">{job.data.attempts.map((attempt, i) => <li key={i} className="break-words">{attempt.n}{t("m_f4626e6e17")} {attempt.kind === "validation" ? t("m_d2a74d7785") : attempt.kind === "run" ? t("m_74a23ff796") : t("m_d1a2d3a223")} · {attempt.status === "ok" ? t("m_8d8680373c") : t("m_732fe33ab1")} — {attempt.detail}</li>)}</ol>}
    {job.data?.status === "failed" && <ErrorBox error={job.data.error_message || t("m_058d6c2ae6")} />}
    {job.data?.status === "cancelled" && <p className="text-sm text-fg-muted">{t("m_0eac5b62b8")}</p>}
    {job.data?.status === "succeeded" && job.data.result && <>
      <p className="break-words text-sm text-fg">{job.data.result.summary}</p>
      {!!job.data.result.assumptions.length && <div><h3 className="mb-1 text-xs font-semibold text-fg-muted">{t("m_21eae41263")}</h3><ul className="list-inside list-disc space-y-1 text-xs text-fg-muted">{job.data.result.assumptions.map((assumption, i) => <li key={i} className="break-words">{assumption}</li>)}</ul></div>}
      <p className="text-xs text-fg-subtle">{t("m_160d509eb1")}</p>
      {job.data.result.files.map((file) => <FileDiff key={file.path} job={job.data!} file={file} />)}
      <Link className={ACTION_LINK} aria-label={t("m_bef4fb3c82")} to={editorUrl(run.workspace_id, run.commit_sha ?? job.data.base_sha, { aiJob: job.data.id })}>{t("m_cd441620d6")}</Link>
    </>}
  </section>;
}
