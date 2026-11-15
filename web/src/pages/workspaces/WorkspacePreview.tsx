import { t } from "../../lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { apiJson } from "../../api/client";
import type { Workspace, WorkspaceHistory, WorkspaceTree } from "../../api/types";
import { Empty, ErrorBox, Loading } from "../../components/ui";
import { formatBytes, formatTime, githubCommitUrl, shortSha } from "../../lib/format";

export function WorkspacePreview({ workspace }: { workspace: Workspace }) {
  const [open, setOpen] = useState(false);
  const path = `/workspaces/${encodeURIComponent(workspace.id)}`;
  const tree = useQuery({
    queryKey: ["workspace-tree", workspace.id, workspace.head_sha],
    queryFn: () => apiJson<WorkspaceTree>(`${path}/tree`),
    enabled: open,
  });
  const history = useQuery({
    queryKey: ["workspace-history", workspace.id, workspace.head_sha],
    queryFn: () => apiJson<WorkspaceHistory>(`${path}/history?limit=5`),
    enabled: open,
  });

  return (
    <details className="min-w-0 border-t border-border pt-3" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="min-h-9 cursor-pointer rounded-lg py-2 text-sm max-md:min-h-11 font-medium text-fg-muted focus-visible:outline-2 focus-visible:outline-accent">
        {t("m_95e4c568d1")}
      </summary>
      {open && <div className="mt-4 grid min-w-0 gap-5 lg:grid-cols-2">
        <section className="min-w-0">
          <h3 className="mb-2 text-xs font-semibold text-fg-subtle">{t("m_68b8eecb19")}</h3>
          {tree.isPending ? <Loading /> : tree.isError ? <ErrorBox error={tree.error} /> : tree.data.files.length === 0 ? (
            <Empty>{t("m_e219cd73b4")}</Empty>
          ) : (
            <ul className="max-h-72 space-y-2 overflow-y-auto text-xs font-mono">
              {tree.data.files.map((file) => (
                <li key={file.path} className="flex items-start justify-between gap-3">
                  <span className="min-w-0 break-all text-fg-muted">{file.path}</span>
                  <span className="shrink-0 text-fg-subtle">{formatBytes(file.size)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="min-w-0">
          <h3 className="mb-2 text-xs font-semibold text-fg-subtle">{t("m_1f0b2249f0")}</h3>
          {history.isPending ? <Loading /> : history.isError ? <ErrorBox error={history.error} /> : history.data.commits.length === 0 ? (
            <Empty>{t("m_6a8c5a0b57")}</Empty>
          ) : (
            <ul className="space-y-3 text-sm">
              {history.data.commits.map((commit) => (
                <li key={commit.sha} className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <a className="inline-flex min-h-11 items-center rounded font-mono text-xs text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent md:min-h-0" href={githubCommitUrl(workspace.repo, commit.sha)} target="_blank" rel="noreferrer">
                      {shortSha(commit.sha)}
                    </a>
                    <span className="min-w-0 break-words">{commit.message.split(/\r?\n/, 1)[0]}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-fg-subtle">
                    <span className="break-all">{commit.author_name === "maestro-device-farm" ? commit.co_authors[0]?.name ?? commit.author_name : commit.author_name}</span>
                    <time dateTime={commit.authored_at}>{formatTime(commit.authored_at)}</time>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>}
    </details>
  );
}
