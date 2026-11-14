import { t } from "../../lib/i18n";
import { Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { useRuns, useWorkspaces } from "../../api/queries";
import type { RunCounts, RunOrigin, RunStatus, RunSummary } from "../../api/types";
import { TokenNotice } from "../../components/Layout";
import { StatusBadge } from "../../components/StatusBadge";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, PageHeader, ProgressBar, Segmented, Select } from "../../components/ui";
import { elapsed, formatTime, shortSha, timeAgo } from "../../lib/format";
import { useTicker } from "../../lib/useTicker";

const PAGE_SIZE = 50;
const STATUS: Record<RunStatus, string> = {
  queued: t("m_df72a8753d"), running: t("m_0d01d3e76a"), passed: t("m_66409b6272"), failed: t("m_732fe33ab1"), error: t("m_3efa8afd60"), cancelled: t("m_19b2d19bc1"),
};
const STATUS_CHIPS = ["", "running", "failed", "error", "passed"] as const;
const ORIGIN: Record<RunOrigin, string> = { ci: "CI", dashboard: t("m_2859873b5b"), editor: t("m_4e9bc12abe"), ai: "AI" };
const linkStyle = "rounded text-accent underline decoration-border-strong underline-offset-4 hover:decoration-accent focus-visible:outline-2 focus-visible:outline-accent max-md:inline-flex max-md:min-h-11 max-md:items-center";

function Results({ counts }: { counts: RunCounts }) {
  const details = [
    { value: counts.failed, label: t("m_732fe33ab1"), className: "text-failed-fg" },
    { value: counts.error, label: t("m_3efa8afd60"), className: "text-warning-fg" },
    { value: counts.running, label: t("m_0d01d3e76a"), className: "text-running-fg" },
    { value: counts.queued, label: t("m_df72a8753d"), className: "text-fg-muted" },
    { value: counts.cancelled, label: t("m_19b2d19bc1"), className: "text-fg-muted" },
  ].filter(({ value }) => value > 0);
  const label = [t("m_6b45ae1506", [counts.passed, counts.total]), ...details.map(({ value, label }) => `${label} ${value}`)].join(" · ");
  return <div className="min-w-52 max-w-64 space-y-2">
    <ProgressBar label={label} total={counts.total} segments={[
      { value: counts.passed, tone: "passed" },
      { value: counts.failed, tone: "failed" },
      { value: counts.error, tone: "warning" },
      { value: counts.running, tone: "running" },
      { value: counts.queued + counts.cancelled, tone: "neutral" },
    ]} />
    <div className="flex flex-wrap gap-x-1 text-xs text-fg-muted">
      <span>{counts.passed}/{counts.total} {t("m_66409b6272")}</span>
      {details.map(({ value, label, className }) => <span key={label}>· <span className={className}>{label} {value}</span></span>)}
    </div>
  </div>;
}

function Trigger({ run }: { run: RunSummary }) {
  return <div className="min-w-36 max-w-56 space-y-1">
    <span className="block text-fg">{ORIGIN[run.origin]}</span>
    {run.origin === "ci" && <>
      {run.ci_meta.branch && <span className="block break-all font-mono text-xs text-fg-muted">{run.ci_meta.branch}</span>}
      {(run.ci_meta.pr_url || run.ci_meta.workflow_url) && <div className="flex flex-wrap gap-x-3 text-xs">
        {run.ci_meta.pr_url && <a href={run.ci_meta.pr_url} target="_blank" rel="noopener noreferrer" className={linkStyle}>{t("e_55af20415e")}</a>}
        {run.ci_meta.workflow_url && <a href={run.ci_meta.workflow_url} target="_blank" rel="noopener noreferrer" className={linkStyle}>{t("m_8423200a37")}</a>}
      </div>}
    </>}
    <span className="block break-all text-xs text-fg-subtle">{run.created_by}</span>
  </div>;
}

export function RunsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const status = search.get("status") ?? "";
  const origin = search.get("origin") ?? "";
  const workspace = search.get("workspace") ?? "";
  const before = search.get("before") ?? "";
  const q = search.get("q") ?? "";
  const [searchText, setSearchText] = useState(q);
  const runs = useRuns({ status, origin, workspace, before, limit: PAGE_SIZE });
  const workspaces = useWorkspaces();
  useTicker(runs.data?.some((run) => run.status === "running") ?? false);
  const workspaceNames = new Map(workspaces.data?.map((item) => [item.id, item.name]));
  const lastRun = runs.data?.length === PAGE_SIZE ? runs.data.at(-1) : undefined;
  const term = q.trim().toLocaleLowerCase();
  const visibleRuns = runs.data?.filter((run) => [
    run.id, run.ref, run.ci_meta.branch, run.ci_meta.commit, run.commit_sha,
    workspaceNames.get(run.workspace_id ?? ""), run.workspace_id, run.created_by,
  ].some((value) => value?.toLocaleLowerCase().includes(term)));

  useEffect(() => { setSearchText(q); }, [q]);
  useEffect(() => {
    if (searchText === q) return;
    const timer = setTimeout(() => {
      setSearch((previous) => {
        const next = new URLSearchParams(previous);
        if (searchText) next.set("q", searchText);
        else next.delete("q");
        next.delete("before");
        return next;
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText, q, setSearch]);

  function changeFilter(key: string, value: string) {
    setSearch((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete("before");
      return next;
    });
  }

  function changePage(cursor?: string) {
    setSearch((previous) => {
      const next = new URLSearchParams(previous);
      if (cursor) next.set("before", cursor);
      else next.delete("before");
      return next;
    });
  }

  // Existing shared URLs can still select queued/cancelled without adding default chips.
  const chipStatuses: readonly string[] = status === "queued" || status === "cancelled" ? [...STATUS_CHIPS, status] : STATUS_CHIPS;
  const statusOptions = chipStatuses.map((value) => ({
    value,
    label: <>{value ? STATUS[value as RunStatus] : t("m_934dd25ec5")} <span className="ml-1 font-mono text-xs">{runs.data?.filter((run) => !value || run.status === value).length ?? 0}</span></>,
  }));

  return <div className="min-w-0 text-fg">
    <PageHeader title={t("m_74a23ff796")} description={t("m_13ea8c2e60")}
      actions={<Button variant="primary" icon={<Plus size={16} strokeWidth={1.8} />} onClick={() => navigate("/runs/new")}>{t("m_fbdfd04fb8")}</Button>} />
    <TokenNotice />
    <div className="mb-5 space-y-4">
      <Segmented label={t("m_2926977ba7")} options={statusOptions} value={status} onChange={(value) => changeFilter("status", value)} />
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(12rem,1fr)_12rem_14rem]">
        <Field label={t("m_cf425f948f")}>
          <div className="relative">
            <Search aria-hidden="true" size={16} strokeWidth={1.8} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-subtle" />
            <Input type="search" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder={t("m_1c135a5eed")} className="pl-9" />
          </div>
        </Field>
        <Field label={t("m_2151edbebc")}>
          <Select value={origin} onChange={(event) => changeFilter("origin", event.target.value)}>
            <option value="">{t("m_934dd25ec5")}</option>
            {Object.entries(ORIGIN).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </Field>
        <Field label={t("m_3291059946")}>
          <Select value={workspace} onChange={(event) => changeFilter("workspace", event.target.value)}>
            <option value="">{t("m_934dd25ec5")}</option>
            {workspace && !workspaces.data?.some((item) => item.name === workspace) && <option value={workspace}>{workspace}</option>}
            {workspaces.data?.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
          </Select>
        </Field>
      </div>
    </div>

    <div className="space-y-4">
      <ErrorBox error={workspaces.error} />
      {runs.isPending ? <Loading /> : runs.isError ? <ErrorBox error={runs.error} /> : !runs.data.length ? <Empty>{t("m_db63687712")}</Empty>
        : !visibleRuns?.length ? <Empty>{t("m_300d3cac5f")}</Empty> : <Card>
          <div className="overflow-x-auto rounded-[10px] focus-visible:outline-2 focus-visible:outline-accent" role="region" aria-label={t("m_b609b643d9")} tabIndex={0}>
            <table className="w-full min-w-[68rem] text-left text-sm">
              <caption className="sr-only">{t("m_145ffde6a0")}</caption>
              <thead className="border-b border-border bg-surface-2 text-xs text-fg-subtle">
                <tr>{[t("m_2926977ba7"), "Run", t("m_2bce87f648"), t("m_861b3833e3"), t("m_71d855acd9"), t("m_468105f78b"), t("m_e89cc866ba")].map((label) =>
                  <th key={label} scope="col" className="whitespace-nowrap px-4 py-3 font-semibold">{label}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleRuns.map((run) => <tr key={run.id} className="align-middle hover:bg-surface-2">
                  <td className="whitespace-nowrap px-4 py-4"><StatusBadge status={run.status} /></td>
                  <td className="px-4 py-4">
                    <Link to={`/runs/${run.id}`} title={run.id} className={`font-mono ${linkStyle}`}>{run.id.slice(-8)}</Link>
                    <div className="mt-1"><Badge className="font-mono">{run.mode}</Badge></div>
                  </td>
                  <td className="px-4 py-4">
                    <span className="block min-w-44 max-w-64 break-words text-fg">
                      {run.flow_source === "upload" ? t("m_51672ccd18") : t("m_401dcf9c0d", [workspaceNames.get(run.workspace_id ?? "") ?? run.workspace_id ?? "-", shortSha(run.commit_sha), run.flow_source === "draft" ? t("m_330b6eea20") : ""])}
                    </span>
                    <span className="mt-1 block max-w-64 break-all font-mono text-xs text-fg-subtle">{run.app.package_name} {run.app.version_name}</span>
                  </td>
                  <td className="px-4 py-4"><Trigger run={run} /></td>
                  <td className="px-4 py-4"><Results counts={run.counts} /></td>
                  <td className="whitespace-nowrap px-4 py-4 font-mono text-xs text-fg-muted">{elapsed(run.started_at, run.finished_at)}</td>
                  <td className="px-4 py-4">
                    <time dateTime={run.started_at ?? run.created_at} title={formatTime(run.started_at ?? run.created_at)} className="whitespace-nowrap text-xs text-fg-muted">{timeAgo(run.started_at ?? run.created_at)}</time>
                  </td>
                </tr>)}
              </tbody>
            </table>
          </div>
        </Card>}
      {(before || lastRun) && <nav aria-label={t("m_d7e9381bcb")} className="flex flex-wrap justify-center gap-2">
        {before && <Button onClick={() => changePage()}>{t("m_5f8e0688e4")}</Button>}
        {lastRun && !runs.isError && <Button onClick={() => changePage(lastRun.id)}>{t("m_8e2b5c3a6e")}</Button>}
      </nav>}
    </div>
  </div>;
}
