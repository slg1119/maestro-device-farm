import { FileCode2, GitBranch, LayoutGrid, ListChecks, Menu as MenuIcon, Monitor, Moon, Package, PanelLeftClose, PanelLeftOpen, Settings, Smartphone, Sun, UserRound } from "lucide-react";
import { type ReactNode, useState } from "react";
import { NavLink, useLocation } from "react-router";

import type { StreamState } from "../api/events";
import { useHealth } from "../api/queries";
import { useSettings } from "../lib/settings";
import { useTheme, type ThemePreference } from "../lib/theme";
import { cx, Drawer, IconButton, StatusDot } from "./ui";

const nav = [
  { to: "/", label: "개요", icon: LayoutGrid, end: true },
  { to: "/devices", label: "기기", icon: Smartphone },
  { to: "/runs", label: "실행", icon: ListChecks },
  { to: "/editor", label: "에디터", icon: FileCode2 },
  { to: "/workspaces", label: "워크스페이스", icon: GitBranch },
  { to: "/apps", label: "앱", icon: Package },
];
const nextTheme: Record<ThemePreference, ThemePreference> = { system: "light", light: "dark", dark: "system" };
const themeLabel = { system: "시스템 테마로 전환", light: "라이트 테마로 전환", dark: "다크 테마로 전환" };
function readCollapsed() { try { return localStorage.getItem("farm.sidebar") === "collapsed"; } catch { return false; } }

function Brand({ rail = false }: { rail?: boolean }) {
  return <div className={cx("flex h-16 shrink-0 items-center gap-3", rail ? "justify-center" : "px-5")}>
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-white"><Smartphone size={18} aria-hidden="true" /></span>
    {!rail && <div><div className="text-sm font-bold text-fg">Device Farm</div><div className="text-[11px] tracking-[0.06em] text-fg-subtle">sample · 사내</div></div>}
  </div>;
}

export function AppShell({ children, stream, canWrite, onOpenSettings }: {
  children: ReactNode; stream: StreamState; canWrite: boolean; onOpenSettings: () => void;
}) {
  const { pathname } = useLocation();
  const editor = pathname.startsWith("/editor");
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const rail = editor || collapsed;
  const { data: health } = useHealth();
  const { authorName } = useSettings();
  const { preference, setPreference } = useTheme();
  const ThemeIcon = preference === "system" ? Monitor : preference === "light" ? Sun : Moon;
  const healthy = !!health?.agent && health.agent.age_sec <= 15;
  const agentLabel = healthy ? `agent 정상 · ${Math.round(health.agent!.age_sec)}s` : "agent 응답 없음";
  const liveLabel = stream === "open" ? "실시간 연결" : "재연결 중";
  const collapse = () => {
    const value = !collapsed;
    setCollapsed(value);
    try { localStorage.setItem("farm.sidebar", value ? "collapsed" : "expanded"); } catch { /* Session-only fallback. */ }
  };
  const navigation = (compact: boolean) => <nav aria-label="주 메뉴" className="flex flex-col gap-1 px-2">
    {nav.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} title={compact ? label : undefined}
      onClick={() => setMobileOpen(false)} className={({ isActive }) => cx(
        "flex min-h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent max-md:min-h-11",
        compact && "justify-center px-0", isActive ? "bg-accent-soft text-accent-soft-fg" : "text-fg-muted hover:bg-neutral-bg hover:text-fg",
      )}><Icon size={18} className="shrink-0" aria-hidden="true" /><span className={compact ? "sr-only" : ""}>{label}</span></NavLink>)}
  </nav>;
  const footer = (compact: boolean) => <div className={cx("mt-auto shrink-0", compact ? "space-y-2 px-2 py-4" : "p-3")}>
    <div className={cx(compact ? "flex flex-col items-center gap-3" : "space-y-2 rounded-[10px] border border-border bg-surface p-3")}>
      <div title={agentLabel} className="flex items-center gap-2 text-xs text-fg-muted"><StatusDot tone={healthy ? "passed" : "warning"} /><span className={compact ? "sr-only" : ""}>{agentLabel}</span></div>
      <div title={liveLabel} className="flex items-center gap-2 text-xs text-fg-subtle"><StatusDot tone={stream === "open" ? "passed" : "warning"} /><span className={compact ? "sr-only" : ""}>{liveLabel}</span></div>
      <div className={cx("flex items-center gap-1", compact ? "flex-col" : "border-t border-border pt-2")}>
        <IconButton aria-label={themeLabel[nextTheme[preference]]} title={themeLabel[nextTheme[preference]]} onClick={() => setPreference(nextTheme[preference])}><ThemeIcon /></IconButton>
        <button type="button" aria-label={canWrite ? "설정" : "토큰 설정 필요"} title={authorName || "설정"} onClick={() => { setMobileOpen(false); onOpenSettings(); }}
          className={cx("flex min-h-9 min-w-0 items-center gap-2 rounded-lg text-sm text-fg-muted outline-none hover:bg-neutral-bg focus-visible:ring-2 focus-visible:ring-accent max-md:min-h-11", compact ? "size-8 justify-center" : "flex-1 px-1")}>
          <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-soft-fg">{authorName ? Array.from(authorName)[0] : <UserRound size={14} />}</span>
          {!compact && <><span className="min-w-0 flex-1 truncate text-left">{authorName || "설정"}</span><Settings size={14} className="shrink-0" aria-hidden="true" /></>}
        </button>
      </div>
    </div>
  </div>;
  return <div className={cx("flex min-w-0 max-w-full flex-col bg-bg text-fg md:flex-row", editor ? "h-dvh overflow-hidden" : "min-h-dvh")}>
    <aside aria-label="사이드바" className={cx("sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-sidebar md:flex", rail ? "w-14" : "w-[232px]")}>
      <Brand rail={rail} />{navigation(rail)}
      {!editor && <div className={cx("mt-3", rail ? "px-2" : "px-4")}><IconButton aria-label={rail ? "사이드바 펼치기" : "사이드바 접기"} aria-expanded={!rail} onClick={collapse}>{rail ? <PanelLeftOpen /> : <PanelLeftClose />}</IconButton></div>}
      {footer(rail)}
    </aside>
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-sidebar px-4 md:hidden"><Brand /><IconButton aria-label="메뉴 열기" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><MenuIcon /></IconButton></header>
    <main className={cx("min-w-0 flex-1", editor ? "flex min-h-0 flex-col overflow-hidden p-0" : "mx-auto w-full max-w-[1440px] px-4 py-6 md:px-8 md:py-8")}>
      {children}
    </main>
    {mobileOpen && <Drawer title="메뉴" side="left" className="w-[232px] bg-sidebar!" onClose={() => setMobileOpen(false)}><Brand />{navigation(false)}{footer(false)}</Drawer>}
  </div>;
}
