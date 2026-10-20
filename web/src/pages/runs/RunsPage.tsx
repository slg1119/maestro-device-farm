import { Link, useNavigate, useSearchParams } from "react-router";

import { useRuns, useWorkspaces } from "../../api/queries";
import type { RunOrigin, RunStatus } from "../../api/types";
import { TokenNotice } from "../../components/Layout";
import { StatusBadge } from "../../components/StatusBadge";
import { Button, Card, Empty, ErrorBox, Field, Loading, PageHeader, Select } from "../../components/ui";
import { elapsed, formatTime, shortSha, timeAgo } from "../../lib/format";
import { useTicker } from "../../lib/useTicker";

const PAGE_SIZE = 50;
const STATUS: Record<RunStatus, string> = {
  queued: "대기", running: "실행 중", passed: "통과", failed: "실패", error: "오류", cancelled: "취소",
};
const ORIGIN: Record<RunOrigin, string> = { ci: "CI", dashboard: "대시보드", editor: "에디터", ai: "AI" };

export function RunsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const status = search.get("status") ?? "";
  const origin = search.get("origin") ?? "";
  const workspace = search.get("workspace") ?? "";
  const before = search.get("before") ?? "";
  const runs = useRuns({ status, origin, workspace, before, limit: PAGE_SIZE });
  const workspaces = useWorkspaces();
  useTicker(runs.data?.some((run) => run.status === "running") ?? false);
  const workspaceNames = new Map(workspaces.data?.map((item) => [item.id, item.name]));
  const lastRun = runs.data?.length === PAGE_SIZE ? runs.data.at(-1) : undefined;

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

  return (
    <div className="min-w-0">
      <PageHeader title="실행" actions={<Button variant="primary" onClick={() => navigate("/runs/new")}>새 실행</Button>} />
      <TokenNotice />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="상태">
          <Select value={status} onChange={(event) => changeFilter("status", event.target.value)}>
            <option value="">전체</option>
            {Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
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

      <div className="space-y-4">
        <ErrorBox error={workspaces.error} />
        {runs.isPending ? <Loading /> : runs.isError ? <ErrorBox error={runs.error} /> : !runs.data.length ? (
          <Empty>실행 기록이 없습니다.</Empty>
        ) : (
          <Card>
            <div className="overflow-x-auto rounded-lg focus-visible:outline-2 focus-visible:outline-slate-500" role="region" aria-label="실행 목록" tabIndex={0}>
              <table className="w-full min-w-[72rem] text-left text-sm">
                <caption className="sr-only">실행 기록</caption>
                <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                  <tr>
                    {["상태", "Run", "출처", "Flow", "앱", "결과", "소요", "생성", "CI"].map((label) => (
                      <th key={label} scope="col" className="whitespace-nowrap px-4 py-3 font-medium">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {runs.data.map((run) => (
                    <tr key={run.id} className="align-top hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-3"><StatusBadge status={run.status} /></td>
                      <td className="px-4 py-3">
                        <Link to={`/runs/${run.id}`} title={run.id} className="font-mono text-slate-900 underline decoration-slate-300 underline-offset-4 hover:decoration-slate-900">
                          {run.id.slice(-8)}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="block">{ORIGIN[run.origin]}</span>
                        <span className="text-xs text-slate-500">{run.mode}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="block min-w-40 break-words">
                          {run.flow_source === "upload" ? "업로드" : `${workspaceNames.get(run.workspace_id ?? "") ?? run.workspace_id ?? "-"} @ ${shortSha(run.commit_sha)}${run.flow_source === "draft" ? " (초안)" : ""}`}
                        </span>
                      </td>
                      <td className="px-4 py-3"><span className="block min-w-36 break-all">{run.app.package_name} {run.app.version_name}</span></td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="block">{run.counts.passed}/{run.counts.total} 통과</span>
                        {run.counts.failed > 0 && <span className="block text-xs text-red-600">실패 {run.counts.failed}</span>}
                        {run.counts.error > 0 && <span className="block text-xs text-amber-600">오류 {run.counts.error}</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{elapsed(run.started_at, run.finished_at)}</td>
                      <td className="px-4 py-3">
                        <time dateTime={run.created_at} title={formatTime(run.created_at)} className="whitespace-nowrap">{timeAgo(run.created_at)}</time>
                        <span className="block text-xs text-slate-500 break-all">{run.created_by}</span>
                      </td>
                      <td className="px-4 py-3">
                        {run.ci_meta.branch && <span className="block max-w-48 break-all text-xs text-slate-600">{run.ci_meta.branch}</span>}
                        {run.ci_meta.pr_url && <a href={run.ci_meta.pr_url} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-700 underline underline-offset-4">PR</a>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
        {(before || lastRun) && (
          <nav aria-label="실행 목록 페이지" className="flex flex-wrap justify-end gap-2">
            {before && <Button onClick={() => changePage()}>처음으로</Button>}
            {lastRun && !runs.isError && <Button onClick={() => changePage(lastRun.id)}>다음</Button>}
          </nav>
        )}
      </div>
    </div>
  );
}
