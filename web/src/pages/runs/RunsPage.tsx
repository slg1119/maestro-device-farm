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
  queued: "대기", running: "실행 중", passed: "통과", failed: "실패", error: "오류", cancelled: "취소",
};
const STATUS_CHIPS = ["", "running", "failed", "error", "passed"] as const;
const ORIGIN: Record<RunOrigin, string> = { ci: "CI", dashboard: "대시보드", editor: "에디터", ai: "AI" };
const linkStyle = "rounded text-accent underline decoration-border-strong underline-offset-4 hover:decoration-accent focus-visible:outline-2 focus-visible:outline-accent max-md:inline-flex max-md:min-h-11 max-md:items-center";

function Results({ counts }: { counts: RunCounts }) {
  const details = [
    { value: counts.failed, label: "실패", className: "text-failed-fg" },
    { value: counts.error, label: "오류", className: "text-warning-fg" },
    { value: counts.running, label: "실행 중", className: "text-running-fg" },
    { value: counts.queued, label: "대기", className: "text-fg-muted" },
    { value: counts.cancelled, label: "취소", className: "text-fg-muted" },
  ].filter(({ value }) => value > 0);
  const label = [`${counts.passed}/${counts.total} 통과`, ...details.map(({ value, label }) => `${label} ${value}`)].join(" · ");
  return <div className="min-w-52 max-w-64 space-y-2">
    <ProgressBar label={label} total={counts.total} segments={[
      { value: counts.passed, tone: "passed" },
      { value: counts.failed, tone: "failed" },
      { value: counts.error, tone: "warning" },
      { value: counts.running, tone: "running" },
      { value: counts.queued + counts.cancelled, tone: "neutral" },
    ]} />
    <div className="flex flex-wrap gap-x-1 text-xs text-fg-muted">
      <span>{counts.passed}/{counts.total} 통과</span>
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
        {run.ci_meta.pr_url && <a href={run.ci_meta.pr_url} target="_blank" rel="noopener noreferrer" className={linkStyle}>PR</a>}
        {run.ci_meta.workflow_url && <a href={run.ci_meta.workflow_url} target="_blank" rel="noopener noreferrer" className={linkStyle}>워크플로</a>}
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
    label: <>{value ? STATUS[value as RunStatus] : "전체"} <span className="ml-1 font-mono text-xs">{runs.data?.filter((run) => !value || run.status === value).length ?? 0}</span></>,
  }));

  return <div className="min-w-0 text-fg">
    <PageHeader title="실행" description="실행 기록과 결과를 확인하세요. 수치는 현재 페이지 기준입니다."
      actions={<Button variant="primary" icon={<Plus size={16} strokeWidth={1.8} />} onClick={() => navigate("/runs/new")}>새 실행</Button>} />
    <TokenNotice />
    <div className="mb-5 space-y-4">
      <Segmented label="상태" options={statusOptions} value={status} onChange={(value) => changeFilter("status", value)} />
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(12rem,1fr)_12rem_14rem]">
        <Field label="실행 검색">
          <div className="relative">
            <Search aria-hidden="true" size={16} strokeWidth={1.8} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-subtle" />
            <Input type="search" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="ID, 브랜치, 커밋, 워크스페이스, 작성자 검색" className="pl-9" />
          </div>
        </Field>
        <Field label="출처">
          <Select value={origin} onChange={(event) => changeFilter("origin", event.target.value)}>
            <option value="">전체</option>
            {Object.entries(ORIGIN).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </Field>
        <Field label="워크스페이스">
          <Select value={workspace} onChange={(event) => changeFilter("workspace", event.target.value)}>
            <option value="">전체</option>
            {workspace && !workspaces.data?.some((item) => item.name === workspace) && <option value={workspace}>{workspace}</option>}
            {workspaces.data?.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
          </Select>
        </Field>
      </div>
    </div>

    <div className="space-y-4">
      <ErrorBox error={workspaces.error} />
      {runs.isPending ? <Loading /> : runs.isError ? <ErrorBox error={runs.error} /> : !runs.data.length ? <Empty>실행 기록이 없습니다.</Empty>
        : !visibleRuns?.length ? <Empty>검색 결과가 없습니다.</Empty> : <Card>
          <div className="overflow-x-auto rounded-[10px] focus-visible:outline-2 focus-visible:outline-accent" role="region" aria-label="실행 목록" tabIndex={0}>
            <table className="w-full min-w-[68rem] text-left text-sm">
              <caption className="sr-only">실행 기록</caption>
              <thead className="border-b border-border bg-surface-2 text-xs text-fg-subtle">
                <tr>{["상태", "Run", "Flow 소스 · 앱", "트리거", "결과", "소요", "시작"].map((label) =>
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
                      {run.flow_source === "upload" ? "업로드" : `${workspaceNames.get(run.workspace_id ?? "") ?? run.workspace_id ?? "-"} @ ${shortSha(run.commit_sha)}${run.flow_source === "draft" ? " (초안)" : ""}`}
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
      {(before || lastRun) && <nav aria-label="실행 목록 페이지" className="flex flex-wrap justify-center gap-2">
        {before && <Button onClick={() => changePage()}>처음으로</Button>}
        {lastRun && !runs.isError && <Button onClick={() => changePage(lastRun.id)}>이전 run 더 보기</Button>}
      </nav>}
    </div>
  </div>;
}
