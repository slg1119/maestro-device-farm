import { t } from "../../lib/i18n";
import { Activity, ArrowRight, CircleCheck, FileCode2, GitBranch, Play, Smartphone, TriangleAlert } from "lucide-react";
import { type ReactNode, useId } from "react";
import { Link } from "react-router";

import { useDevices, useRuns, useWorkspaces } from "../../api/queries";
import type { Device, RunOrigin, RunSummary, Workspace } from "../../api/types";
import { DeviceStateBadge, StatusBadge } from "../../components/StatusBadge";
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, ProgressBar, cx } from "../../components/ui";
import { elapsed, formatTime, parseTs, shortSha, timeAgo } from "../../lib/format";
import { useTicker } from "../../lib/useTicker";

const ORIGIN: Record<RunOrigin, string> = { ci: "CI", dashboard: t("m_2859873b5b"), editor: t("m_4e9bc12abe"), ai: "AI" };
const linkStyle = "rounded text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent";
const actionStyle = "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg max-md:min-h-11 [&>svg]:size-4";

function source(run: RunSummary, workspaces: Workspace[]): string {
  if (run.flow_source === "upload") return t("m_51672ccd18");
  const name = workspaces.find((item) => item.id === run.workspace_id)?.name ?? run.workspace_id ?? t("m_3291059946");
  return t("m_401dcf9c0d", [name, shortSha(run.commit_sha), run.flow_source === "draft" ? t("m_330b6eea20") : ""]);
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
        <Link to={href} aria-label={t("m_247965f8ce", [title])} className={cx(linkStyle, "inline-flex min-h-8 items-center gap-1 text-xs max-md:min-h-11")}>
          {t("m_1f9029ebd4")} <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </header>
      {pending ? <Loading /> : error ? <div className="p-4"><ErrorBox error={error} /></div> : empty ? <Empty>{emptyText}</Empty> : children}
    </Card>
  </section>;
}

function ActiveRun({ run, workspaces, now }: { run: RunSummary; workspaces: Workspace[]; now: Date }) {
  const id = run.id.slice(-8);
  const counts = run.counts;
  const label = t("m_a9d6430334", [counts.passed, counts.failed, counts.running, counts.queued]);
  return <li className="min-w-0 space-y-2.5 px-5 py-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={`/runs/${run.id}`} className={cx(linkStyle, "font-mono text-xs max-md:inline-flex max-md:min-h-11 max-md:items-center")}>{id}</Link>
        <Badge tone={run.origin === "ai" ? "ai" : "neutral"}>{ORIGIN[run.origin]}</Badge>
        <StatusBadge status={run.status} />
      </div>
      <span className="text-xs tabular-nums text-fg-subtle">
        {run.status === "queued" ? t("m_5e888b873a") : t("m_4d166ef50c", [elapsed(run.started_at ?? run.created_at, null, now)])}
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
      {(counts.error > 0 || counts.cancelled > 0) && <span>{counts.error} {t("m_94bc7ff293")} {counts.cancelled} {t("m_19b2d19bc1")}</span>}
    </div>
  </li>;
}

function DeviceRow({ device }: { device: Device }) {
  return <li className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-5 py-3.5">
    <div className="min-w-0 flex-1 basis-32">
      <p className="break-words text-sm font-medium text-fg">{device.model}</p>
      <div className="mt-1 break-words text-xs leading-5 text-fg-subtle">
        {device.state === "busy" ? device.current_run_id ?
          <Link to={`/runs/${device.current_run_id}`} className={cx(linkStyle, "max-md:inline-flex max-md:min-h-11 max-md:items-center")}>{t("m_74a23ff796")} {device.current_run_id.slice(-8)}</Link> : t("m_ee2c1eb9c6") :
          device.state === "reserved" ? device.reservation ? t("m_030ea96d9f", [device.reservation.holder_name]) : t("m_e459b88571") :
            <span className={cx(device.battery !== null && device.battery < 20 && "text-warning-fg")}>
              {device.battery === null ? t("m_ea6c5f9b29") : t("m_56ce9e7d92", [device.battery])}
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
  const deviceLabel = t("m_e944a734e8", [available, occupied, unavailable]);
  const date = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" }).format(now);
  const deviceCount = devices.data ? t("m_f17e3d9c88", [allDevices.length]) : "—";
  const workspaceCount = workspaces.data ? t("m_b1166a37e1", [allWorkspaces.length]) : "—";

  return <div className="min-w-0">
    <PageHeader title={t("m_476966c5a8")} description={t("m_6ecf0e090e", [date, deviceCount, workspaceCount])} actions={<>
      <Link to="/editor" className={cx(actionStyle, "border-border-strong bg-surface text-fg hover:bg-surface-2")}><FileCode2 aria-hidden="true" />{t("m_7a432dfc0c")}</Link>
      <Link to="/runs/new" className={cx(actionStyle, "border-transparent bg-accent text-bg hover:bg-accent-hover")}><Play aria-hidden="true" />{t("m_fbdfd04fb8")}</Link>
    </>} />

    <div className="mb-6 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard title={t("m_e28a9a9677")} label={t("m_360129dae5")} icon={<Smartphone />} value={`${available} / ${allDevices.length}`}
        detail={deviceLabel} pending={devices.isPending} error={devices.error}>
        <ProgressBar label={t("m_fa644af372", [deviceLabel])} total={allDevices.length} segments={[
          { value: available, tone: "passed" }, { value: occupied, tone: "running" }, { value: unavailable, tone: "neutral" },
        ]} />
      </SummaryCard>
      <SummaryCard title={t("m_80804602c0")} label={t("m_99162a686d")} icon={<Activity />} value={running}
        detail={t("m_e2cc359e04", [queuedTasks])} pending={runs.isPending} error={runs.error} />
      <SummaryCard title={t("m_4ca78a63ae")} label={t("m_4ca78a63ae")} icon={<CircleCheck />} value={finished.length ? `${Math.round(passed / finished.length * 100)}%` : "—"}
        detail={t("m_c96fc6ed45", [finished.length, passed])} pending={runs.isPending} error={runs.error} tone="text-passed-fg" />
      <SummaryCard title={t("m_dc253f937e")} label={t("m_31893ce9a9")} icon={<TriangleAlert />} value={today.reduce((sum, run) => sum + run.counts.failed, 0)}
        detail={t("m_00d795cb49", [failed])} pending={runs.isPending} error={runs.error} tone="text-failed-fg" />
    </div>

    <div className="grid min-w-0 grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-5">
        <DataCard title={t("m_80804602c0")} href="/runs?status=running" pending={runs.isPending} error={runs.error} empty={!active.length} emptyText={t("m_300b6008ab")}>
          <ul className="divide-y divide-border">{active.map((run) => <ActiveRun key={run.id} run={run} workspaces={allWorkspaces} now={now} />)}</ul>
        </DataCard>
        <DataCard title={t("m_f9c5cb2b7f")} href="/runs?status=failed" pending={runs.isPending} error={runs.error} empty={!recentFailures.length} emptyText={t("m_084756aac3")}>
          <ul className="divide-y divide-border">{recentFailures.map((run) => <li key={run.id} className="min-w-0 px-5 py-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Link to={`/runs/${run.id}`} className={cx(linkStyle, "font-mono text-xs max-md:inline-flex max-md:min-h-11 max-md:items-center")}>{run.id.slice(-8)}</Link>
                <StatusBadge status={run.status} />
              </div>
              <time dateTime={run.created_at} title={formatTime(run.created_at)} className="text-xs text-fg-subtle">{timeAgo(run.created_at, now)}</time>
            </div>
            <p className="mt-1 break-all font-mono text-xs leading-5 text-fg-muted">{source(run, allWorkspaces)}</p>
            <p className="mt-1 text-xs text-failed-fg">{t("m_732fe33ab1")} {run.counts.failed}{run.counts.error > 0 ? t("m_ece87f250c", [run.counts.error]) : ""}</p>
          </li>)}</ul>
        </DataCard>
      </div>
      <div className="min-w-0 space-y-5">
        <DataCard title={t("m_d79c455f9b")} href="/devices" pending={devices.isPending} error={devices.error} empty={!allDevices.length} emptyText={t("m_8dd97028f7")}>
          <ul className="divide-y divide-border">{allDevices.map((device) => <DeviceRow key={device.serial} device={device} />)}</ul>
        </DataCard>
        <DataCard title={t("m_3291059946")} href="/workspaces" pending={workspaces.isPending} error={workspaces.error} empty={!allWorkspaces.length} emptyText={t("m_b264129a9e")}>
          <ul className="divide-y divide-border">{allWorkspaces.map((workspace) => <li key={workspace.id} className="min-w-0 space-y-1.5 px-5 py-4">
            <div className="flex items-center gap-2 text-fg"><GitBranch aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" /><h3 className="break-all text-sm font-medium">{workspace.name}</h3></div>
            <p className="break-all font-mono text-[11px] leading-5 text-fg-subtle">{workspace.repo} · {workspace.branch} · {shortSha(workspace.head_sha)}</p>
            {workspace.sync_error ? <ErrorBox error={workspace.sync_error} /> : <p title={formatTime(workspace.synced_at)} className="text-xs text-fg-muted">
              {workspace.synced_at ? t("m_0944f24bf5", [timeAgo(workspace.synced_at, now)]) : t("m_6a85007ece")}
            </p>}
          </li>)}</ul>
        </DataCard>
      </div>
    </div>
  </div>;
}
