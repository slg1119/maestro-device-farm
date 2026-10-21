import { Activity, ArrowRight, CircleCheck, FileCode2, GitBranch, Play, Smartphone, TriangleAlert } from "lucide-react";
import { type ReactNode, useId } from "react";
import { Link } from "react-router";

import { useDevices, useRuns, useWorkspaces } from "../../api/queries";
import type { Device, RunOrigin, RunSummary, Workspace } from "../../api/types";
import { DeviceStateBadge, StatusBadge } from "../../components/StatusBadge";
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, ProgressBar, cx } from "../../components/ui";
import { elapsed, formatTime, parseTs, shortSha, timeAgo } from "../../lib/format";
import { useTicker } from "../../lib/useTicker";

const ORIGIN: Record<RunOrigin, string> = { ci: "CI", dashboard: "대시보드", editor: "에디터", ai: "AI" };
const linkStyle = "rounded text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent";
const actionStyle = "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg max-md:min-h-11 [&>svg]:size-4";

function source(run: RunSummary, workspaces: Workspace[]): string {
  if (run.flow_source === "upload") return "업로드";
  const name = workspaces.find((item) => item.id === run.workspace_id)?.name ?? run.workspace_id ?? "워크스페이스";
  return `${name} @ ${shortSha(run.commit_sha)}${run.flow_source === "draft" ? " (초안)" : ""}`;
}

function SummaryCard({ title, icon, label, value, detail, pending, error, children, tone }: {
  title: string; icon: ReactNode; label: string; value: ReactNode; detail: string;
  pending: boolean; error: unknown; children?: ReactNode; tone?: string;
}) {
  return <Card className="min-w-0 p-5">
    <div className="flex items-center justify-between gap-2 text-fg-muted">
      <h2 className="text-xs font-medium">{title}</h2>
      <span aria-hidden="true" className="[&>svg]:size-4">{icon}</span>
    </div>
    {pending ? <Loading /> : error ? <div className="mt-3"><ErrorBox error={error} /></div> : <>
      <p aria-label={label} className={cx("mt-3 text-[28px] leading-9 font-semibold tabular-nums tracking-tight", tone ?? "text-fg")}>{value}</p>
      {children && <div className="mt-3">{children}</div>}
      <p className="mt-2 text-xs leading-5 text-fg-subtle">{detail}</p>
    </>}
  </Card>;
}

function DataCard({ title, href, pending, error, empty, emptyText, children }: {
  title: string; href: string; pending: boolean; error: unknown; empty: boolean; emptyText: string; children: ReactNode;
}) {
  const id = useId();
  return <section aria-labelledby={id} className="min-w-0">
    <Card className="min-w-0 overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h2 id={id} className="text-sm font-semibold text-fg">{title}</h2>
        <Link to={href} aria-label={`${title} 전체 보기`} className={cx(linkStyle, "inline-flex min-h-8 items-center gap-1 text-xs max-md:min-h-11")}>
          전체 보기 <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </header>
      {pending ? <Loading /> : error ? <div className="p-4"><ErrorBox error={error} /></div> : empty ? <Empty>{emptyText}</Empty> : children}
    </Card>
  </section>;
}

function ActiveRun({ run, workspaces, now }: { run: RunSummary; workspaces: Workspace[]; now: Date }) {
  const id = run.id.slice(-8);
  const counts = run.counts;
  const label = `${counts.passed} 통과 · ${counts.failed} 실패 · ${counts.running} 실행 중 · ${counts.queued} 대기`;
  return <li className="min-w-0 space-y-2.5 px-5 py-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/runs/${run.id}`} className={cx(linkStyle, "font-mono text-xs max-md:inline-flex max-md:min-h-11 max-md:items-center")}>{id}</Link>
        <Badge tone={run.origin === "ai" ? "ai" : "neutral"}>{ORIGIN[run.origin]}</Badge>
        <StatusBadge status={run.status} />
      </div>
      <span className="text-xs tabular-nums text-fg-subtle">
        {run.status === "queued" ? "실행 대기 중" : `${elapsed(run.started_at ?? run.created_at, null, now)} 경과`}
      </span>
    </div>
    <p className="break-all font-mono text-xs leading-5 text-fg-muted">{source(run, workspaces)}</p>
    <ProgressBar label={`${id}: ${label}`} total={counts.total} segments={[
      { value: counts.passed, tone: "passed" }, { value: counts.failed, tone: "failed" },
      { value: counts.error, tone: "warning" }, { value: counts.running, tone: "running" },
      { value: counts.queued, tone: "neutral" }, { value: counts.cancelled, tone: "neutral" },
    ]} />
    <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs leading-5 text-fg-muted">
      <span>{label}</span>
      {(counts.error > 0 || counts.cancelled > 0) && <span>{counts.error} 오류 · {counts.cancelled} 취소</span>}
    </div>
  </li>;
}

function DeviceRow({ device }: { device: Device }) {
  return <li className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-5 py-3.5">
    <div className="min-w-0 flex-1 basis-32">
      <p className="break-words text-sm font-medium text-fg">{device.model}</p>
      <div className="mt-1 break-words text-xs leading-5 text-fg-subtle">
        {device.state === "busy" ? device.current_run_id ?
          <Link to={`/runs/${device.current_run_id}`} className={cx(linkStyle, "max-md:inline-flex max-md:min-h-11 max-md:items-center")}>실행 {device.current_run_id.slice(-8)}</Link> : "실행 정보 확인 중" :
          device.state === "reserved" ? device.reservation ? `${device.reservation.holder_name} 예약 중` : "예약 정보 확인 중" :
            <span className={cx(device.battery !== null && device.battery < 20 && "text-warning-fg")}>
              {device.battery === null ? "배터리 정보 없음" : `배터리 ${device.battery}%`}
            </span>}
      </div>
    </div>
    <DeviceStateBadge state={device.state} />
  </li>;
}

export function OverviewPage() {
  const devices = useDevices();
  const runs = useRuns({ limit: 100 });
  const workspaces = useWorkspaces();
  // Keep elapsed times, relative sync times and the local calendar day current.
  useTicker(true);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const allRuns = runs.data ?? [];
  const allDevices = devices.data ?? [];
  const allWorkspaces = workspaces.data ?? [];
  const today = allRuns.filter((run) => {
    const created = parseTs(run.created_at).getTime();
    return created >= start && created < end;
  });
  const finished = today.filter((run) => run.finished_at !== null && run.status !== "queued" && run.status !== "running");
  const passed = finished.filter((run) => run.status === "passed").length;
  const failed = today.filter((run) => run.status === "failed" || run.status === "error").length;
  const running = allRuns.filter((run) => run.status === "running").length;
  const queuedTasks = allRuns.reduce((sum, run) => sum + run.counts.queued, 0);
  const active = allRuns.filter((run) => run.status === "running" || run.status === "queued");
  const recentFailures = allRuns.filter((run) => run.status === "failed" || run.status === "error")
    .sort((a, b) => parseTs(b.created_at).getTime() - parseTs(a.created_at).getTime()).slice(0, 5);
  const available = allDevices.filter((device) => device.state === "available").length;
  const occupied = allDevices.filter((device) => device.state === "busy" || device.state === "reserved").length;
  const unavailable = allDevices.length - available - occupied;
  const deviceLabel = `사용 가능 ${available}대 · 사용 중·예약 ${occupied}대 · 사용 불가 ${unavailable}대`;
  const date = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" }).format(now);
  const deviceCount = devices.data ? `${allDevices.length}대` : "—";
  const workspaceCount = workspaces.data ? `${allWorkspaces.length}개` : "—";

  return <div className="min-w-0">
    <PageHeader title="개요" description={`${date} · 기기 ${deviceCount} · 워크스페이스 ${workspaceCount}`} actions={<>
      <Link to="/editor" className={cx(actionStyle, "border-border-strong bg-surface text-fg hover:bg-surface-2")}><FileCode2 aria-hidden="true" />에디터 열기</Link>
      <Link to="/runs/new" className={cx(actionStyle, "border-transparent bg-accent text-bg hover:bg-accent-hover")}><Play aria-hidden="true" />새 실행</Link>
    </>} />

    <div className="mb-6 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard title="사용 가능한 기기" label="사용 가능한 기기 수" icon={<Smartphone />} value={`${available} / ${allDevices.length}`}
        detail={deviceLabel} pending={devices.isPending} error={devices.error}>
        <ProgressBar label={`기기 상태: ${deviceLabel}`} total={allDevices.length} segments={[
          { value: available, tone: "passed" }, { value: occupied, tone: "running" }, { value: unavailable, tone: "neutral" },
        ]} />
      </SummaryCard>
      <SummaryCard title="진행 중인 실행" label="진행 중인 실행 수" icon={<Activity />} value={running}
        detail={`대기 중인 task ${queuedTasks}개`} pending={runs.isPending} error={runs.error} />
      <SummaryCard title="오늘 통과율" label="오늘 통과율" icon={<CircleCheck />} value={finished.length ? `${Math.round(passed / finished.length * 100)}%` : "—"}
        detail={`완료된 run ${finished.length}개 중 ${passed}개 통과`} pending={runs.isPending} error={runs.error} tone="text-passed-fg" />
      <SummaryCard title="오늘 실패한 flow" label="오늘 실패한 flow 수" icon={<TriangleAlert />} value={today.reduce((sum, run) => sum + run.counts.failed, 0)}
        detail={`실패한 run ${failed}개`} pending={runs.isPending} error={runs.error} tone="text-failed-fg" />
    </div>

    <div className="grid min-w-0 grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-5">
        <DataCard title="진행 중인 실행" href="/runs?status=running" pending={runs.isPending} error={runs.error} empty={!active.length} emptyText="진행 중인 실행이 없습니다.">
          <ul className="divide-y divide-border">{active.map((run) => <ActiveRun key={run.id} run={run} workspaces={allWorkspaces} now={now} />)}</ul>
        </DataCard>
        <DataCard title="최근 실패" href="/runs?status=failed" pending={runs.isPending} error={runs.error} empty={!recentFailures.length} emptyText="최근 실패한 실행이 없습니다.">
          <ul className="divide-y divide-border">{recentFailures.map((run) => <li key={run.id} className="min-w-0 px-5 py-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Link to={`/runs/${run.id}`} className={cx(linkStyle, "font-mono text-xs max-md:inline-flex max-md:min-h-11 max-md:items-center")}>{run.id.slice(-8)}</Link>
                <StatusBadge status={run.status} />
              </div>
              <time dateTime={run.created_at} title={formatTime(run.created_at)} className="text-xs text-fg-subtle">{timeAgo(run.created_at, now)}</time>
            </div>
            <p className="mt-1 break-all font-mono text-xs leading-5 text-fg-muted">{source(run, allWorkspaces)}</p>
            <p className="mt-1 text-xs text-failed-fg">실패 {run.counts.failed}{run.counts.error > 0 ? ` · 오류 ${run.counts.error}` : ""}</p>
          </li>)}</ul>
        </DataCard>
      </div>
      <div className="min-w-0 space-y-5">
        <DataCard title="기기" href="/devices" pending={devices.isPending} error={devices.error} empty={!allDevices.length} emptyText="연결된 기기가 없습니다.">
          <ul className="divide-y divide-border">{allDevices.map((device) => <DeviceRow key={device.serial} device={device} />)}</ul>
        </DataCard>
        <DataCard title="워크스페이스" href="/workspaces" pending={workspaces.isPending} error={workspaces.error} empty={!allWorkspaces.length} emptyText="등록된 워크스페이스가 없습니다.">
          <ul className="divide-y divide-border">{allWorkspaces.map((workspace) => <li key={workspace.id} className="min-w-0 space-y-1.5 px-5 py-4">
            <div className="flex items-center gap-2 text-fg"><GitBranch aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" /><h3 className="break-all text-sm font-medium">{workspace.name}</h3></div>
            <p className="break-all font-mono text-[11px] leading-5 text-fg-subtle">{workspace.repo} · {workspace.branch} · {shortSha(workspace.head_sha)}</p>
            {workspace.sync_error ? <ErrorBox error={workspace.sync_error} /> : <p title={formatTime(workspace.synced_at)} className="text-xs text-fg-muted">
              {workspace.synced_at ? `동기화됨 · ${timeAgo(workspace.synced_at, now)}` : "아직 동기화되지 않음"}
            </p>}
          </li>)}</ul>
        </DataCard>
      </div>
    </div>
  </div>;
}
