import { t } from "../lib/i18n";
import { FileCode2, GitBranch, Languages, LayoutGrid, ListChecks, Menu as MenuIcon, Monitor, Moon, Package, PanelLeftClose, PanelLeftOpen, Settings, Smartphone, Sun, UserRound } from "lucide-react";
import { type ReactNode, useState } from "react";
import { NavLink, useLocation } from "react-router";

import type { StreamState } from "../api/events";
import { useHealth } from "../api/queries";
import { getLanguage, setLanguage } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import { useTheme, type ThemePreference } from "../lib/theme";
import { cx, Drawer, IconButton, StatusDot } from "./ui";

const nextTheme: Record<ThemePreference, ThemePreference> = { system: "light", light: "dark", dark: "system" };
function readCollapsed() { try { return localStorage.getItem("farm.sidebar") === "collapsed"; } catch { return false; } }

function Brand({ rail = false }: { rail?: boolean }) {
  return <div className={cx("flex h-16 shrink-0 items-center gap-3", rail ? "justify-center" : "px-5")}>
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-white"><Smartphone size={18} aria-hidden="true" /></span>
    {!rail && <div><div className="text-sm font-bold text-fg">{t("e_9e4c783972")}</div><div className="text-[11px] tracking-[0.06em] text-fg-subtle">{t("e_35d6b9c4f0")}</div></div>}
  </div>;
}

export function AppShell({ children, stream, canWrite, onOpenSettings }: {
  children: ReactNode; stream: StreamState; canWrite: boolean; onOpenSettings: () => void;
}) {
  const { pathname } = useLocation();
  const editor = pathname.startsWith("/editor");
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [language, setLanguageState] = useState(getLanguage);
  const nav = [
    { to: "/", label: t("nav.overview"), icon: LayoutGrid, end: true },
    { to: "/devices", label: t("nav.devices"), icon: Smartphone },
    { to: "/live", label: t("nav.live"), icon: Monitor },
    { to: "/runs", label: t("nav.runs"), icon: ListChecks },
    { to: "/editor", label: t("nav.editor"), icon: FileCode2 },
    { to: "/workspaces", label: t("nav.workspaces"), icon: GitBranch },
    { to: "/apps", label: t("nav.apps"), icon: Package },
  ];
  const themeLabel = { system: t("m_6daf2afe69"), light: t("m_02271a3db8"), dark: t("m_03a9bd2254") };
  const rail = editor || collapsed;
  const { data: health } = useHealth();
  const { authorName } = useSettings();
  const { preference, setPreference } = useTheme();
  const ThemeIcon = preference === "system" ? Monitor : preference === "light" ? Sun : Moon;
  const healthy = !!health?.agent && health.agent.age_sec <= 15;
  const agentLabel = healthy ? t("m_7442fa8986", [Math.round(health.agent!.age_sec)]) : t("m_025810640b");
  const liveLabel = stream === "open" ? t("m_3897b96558") : t("m_8acc3102c7");
  const collapse = () => {
    const value = !collapsed;
    setCollapsed(value);
    try { localStorage.setItem("farm.sidebar", value ? "collapsed" : "expanded"); } catch { /* Session-only fallback. */ }
  };
  const switchLanguage = () => {
    const next = language === "en" ? "ko" : "en";
    const persisted = setLanguage(next);
    setLanguageState(next);
    if (persisted && import.meta.env.MODE !== "test") window.location.reload();
  };
  const navigation = (compact: boolean) => <nav aria-label={t("m_7a81f51e6a")} className="flex flex-col gap-1 px-2">
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
      <div className={cx("flex items-center gap-1", compact ? "flex-col" : "flex-wrap border-t border-border pt-2")}>
        <IconButton aria-label={themeLabel[nextTheme[preference]]} title={themeLabel[nextTheme[preference]]} onClick={() => setPreference(nextTheme[preference])}><ThemeIcon /></IconButton>
        <button type="button" aria-label={language === "en" ? t("language.switchToKorean") : t("language.switchToEnglish")}
          title={language === "en" ? t("language.switchToKorean") : t("language.switchToEnglish")} onClick={switchLanguage}
          className="flex min-h-9 min-w-8 items-center justify-center gap-1 rounded-lg px-1 text-xs font-semibold text-fg-muted hover:bg-neutral-bg focus-visible:outline-accent max-md:min-h-11">
          <Languages size={15} aria-hidden="true" /><span>{language.toUpperCase()}</span>
        </button>
        <button type="button" aria-label={canWrite ? t("m_c14a567ea9") : t("m_884c11a6d1")} title={authorName || t("m_c14a567ea9")} onClick={() => { setMobileOpen(false); onOpenSettings(); }}
          className={cx("flex min-h-9 min-w-0 items-center gap-2 rounded-lg text-sm text-fg-muted outline-none hover:bg-neutral-bg focus-visible:ring-2 focus-visible:ring-accent max-md:min-h-11", compact ? "size-8 justify-center" : "w-full px-1")}>
          <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-soft-fg">{authorName ? Array.from(authorName)[0] : <UserRound size={14} />}</span>
          {!compact && <><span className="min-w-0 flex-1 truncate text-left">{authorName || t("m_c14a567ea9")}</span><Settings size={14} className="shrink-0" aria-hidden="true" /></>}
        </button>
      </div>
    </div>
  </div>;
  return <div className={cx("flex min-w-0 max-w-full flex-col bg-bg text-fg md:flex-row", editor ? "h-dvh overflow-hidden" : "min-h-dvh")}>
    <aside aria-label={t("m_902d0a72b9")} className={cx("sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-sidebar md:flex", rail ? "w-14" : "w-[232px]")}>
      <Brand rail={rail} />{navigation(rail)}
      {!editor && <div className={cx("mt-3", rail ? "px-2" : "px-4")}><IconButton aria-label={rail ? t("m_a35fe3edab") : t("m_32e4e3384b")} aria-expanded={!rail} onClick={collapse}>{rail ? <PanelLeftOpen /> : <PanelLeftClose />}</IconButton></div>}
      {footer(rail)}
    </aside>
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-sidebar px-4 md:hidden"><Brand /><IconButton aria-label={t("m_195da6209a")} aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><MenuIcon /></IconButton></header>
    <main key={language} className={cx("min-w-0 flex-1", editor ? "flex min-h-0 flex-col overflow-hidden p-0" : "mx-auto w-full max-w-[1440px] px-4 py-6 md:px-8 md:py-8")}>
      {children}
    </main>
    {mobileOpen && <Drawer title={t("m_076925c571")} side="left" className="w-[232px] bg-sidebar!" onClose={() => setMobileOpen(false)}><Brand />{navigation(false)}{footer(false)}</Drawer>}
  </div>;
}
