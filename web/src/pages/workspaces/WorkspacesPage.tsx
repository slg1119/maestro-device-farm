import { t } from "../../lib/i18n";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileCode2, GitBranch, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { apiJson } from "../../api/client";
import { keys, useWorkspaces } from "../../api/queries";
import type { Workspace } from "../../api/types";
import { TokenNotice, useCanWrite } from "../../components/Layout";
import { Button, Card, Empty, ErrorBox, Loading, PageHeader } from "../../components/ui";
import { formatTime, githubCommitUrl, shortSha, timeAgo } from "../../lib/format";
import { WorkspaceForm } from "./WorkspaceForm";
import { WorkspacePreview } from "./WorkspacePreview";

function WorkspaceCard({ workspace, canWrite, onEdit }: { workspace: Workspace; canWrite: boolean; onEdit: () => void }) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (action: "sync" | "remove") => apiJson<Workspace | undefined>(
      `/workspaces/${encodeURIComponent(workspace.id)}${action === "sync" ? "/sync" : ""}`,
      { method: action === "sync" ? "POST" : "DELETE" },
    ),
    onSuccess: () => { void client.invalidateQueries({ queryKey: keys.workspaces }); },
  });
  const remove = () => {
    if (!canWrite || mutation.isPending) return;
    if (window.confirm(t("m_fee3bc9b4c"))) mutation.mutate("remove");
  };
  const disabled = !canWrite || mutation.isPending;

  return (
    <Card className="min-w-0 space-y-4 p-4 text-fg [overflow-wrap:anywhere] sm:p-5">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="shrink-0 rounded-lg bg-accent-soft p-2 text-accent-soft-fg"><GitBranch size={18} strokeWidth={1.8} /></span>
        <h2 className="min-w-0 text-sm font-semibold">{workspace.name}</h2>
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-fg-subtle">{t("m_a6543aefbe")}</dt>
        <dd>
          <a className="inline-flex min-h-11 items-center rounded text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent md:min-h-0" href={`https://github.com/${workspace.repo}`} target="_blank" rel="noreferrer">{workspace.repo}</a>
        </dd>
        <dt className="text-fg-subtle">{t("m_8544c1c90e")}</dt>
        <dd className="font-mono text-xs">{workspace.branch}</dd>
        <dt className="text-fg-subtle">{t("m_bae4002d8d")}</dt>
        <dd className="font-mono text-xs">{workspace.path || "/"}</dd>
        <dt className="text-fg-subtle">{t("m_2052127ad0")}</dt>
        <dd className={workspace.default_app_package ? "font-mono text-xs" : "text-xs text-fg-subtle"}>{workspace.default_app_package || t("m_c6c6749ad9")}</dd>
        <dt className="text-fg-subtle">{t("m_20f402949b")}</dt>
        <dd className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {workspace.head_sha ? (
            <a className="inline-flex min-h-11 items-center rounded font-mono text-xs text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent md:min-h-0" href={githubCommitUrl(workspace.repo, workspace.head_sha)} target="_blank" rel="noreferrer">
              {shortSha(workspace.head_sha)}
            </a>
          ) : <span className="text-fg-subtle">-</span>}
          <span className="text-xs text-fg-subtle" title={formatTime(workspace.synced_at)}>{t("m_e7665a58ae")} {timeAgo(workspace.synced_at)}</span>
        </dd>
      </dl>
      {workspace.sync_error && <div className="whitespace-pre-wrap break-all font-mono"><ErrorBox error={workspace.sync_error} /></div>}
      <div className="flex flex-wrap gap-2">
        <Link to={`/editor/${encodeURIComponent(workspace.name)}`}
          className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-transparent bg-accent px-3 text-sm font-medium text-bg outline-none transition-colors hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg max-md:min-h-11 dark:text-fg">
          <FileCode2 aria-hidden="true" size={16} strokeWidth={1.8} />{t("m_cd441620d6")}
        </Link>
        <Button icon={<RefreshCw />} disabled={disabled} onClick={() => { if (canWrite && !mutation.isPending) mutation.mutate("sync"); }}>
          {mutation.isPending && mutation.variables === "sync" ? t("m_9e1cc4ca24") : t("m_e7665a58ae")}
        </Button>
        <Button disabled={disabled} onClick={onEdit}>{t("m_e1407b5115")}</Button>
        <Button variant="danger" disabled={disabled} onClick={remove}>
          {mutation.isPending && mutation.variables === "remove" ? t("m_a102536199") : t("m_0489c5637c")}
        </Button>
      </div>
      <ErrorBox error={mutation.error} />
      <WorkspacePreview workspace={workspace} />
    </Card>
  );
}

export function WorkspacesPage() {
  const workspaces = useWorkspaces();
  const canWrite = useCanWrite();
  const [form, setForm] = useState<"create" | Workspace | null>(null);

  return (
    <>
      <PageHeader title={t("m_3291059946")} description={t("m_3fb0264b80")} actions={<Button variant="primary" icon={<Plus />} disabled={!canWrite} onClick={() => setForm("create")}>{t("m_1ac11e9b41")}</Button>} />
      <TokenNotice />
      {workspaces.isPending ? <Loading /> : workspaces.isError ? <ErrorBox error={workspaces.error} /> : workspaces.data.length === 0 ? (
        <Empty>{t("m_b264129a9e")}</Empty>
      ) : (
        <div className="space-y-4">
          {[...workspaces.data].sort((a, b) => a.name.localeCompare(b.name)).map((workspace) => (
            <WorkspaceCard key={workspace.id} workspace={workspace} canWrite={canWrite} onEdit={() => setForm(workspace)} />
          ))}
        </div>
      )}
      {form !== null && <WorkspaceForm workspace={form === "create" ? undefined : form} onClose={() => setForm(null)} />}
    </>
  );
}
