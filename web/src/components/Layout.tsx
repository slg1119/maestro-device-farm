import { createContext, useCallback, useContext, useState } from "react";
import { NavLink, Outlet } from "react-router";

import { useLiveEvents } from "../api/events";
import { useHealth } from "../api/queries";
import { useSettings } from "../lib/settings";
import { SettingsDialog } from "./SettingsDialog";
import { Button, cx } from "./ui";

const NAV = [
  { to: "/devices", label: "기기" },
  { to: "/runs", label: "실행", end: true },
  { to: "/runs/new", label: "새 실행" },
  { to: "/apps", label: "앱" },
  { to: "/workspaces", label: "워크스페이스" },
];

const OpenSettings = createContext<() => void>(() => {});

/** Opens the settings dialog (token, author) from anywhere inside the layout. */
export function useOpenSettings(): () => void {
  return useContext(OpenSettings);
}

function AgentStatus() {
  const { data } = useHealth();
  if (!data) return null;
  const stale = !data.agent || data.agent.age_sec > 15;
  return (
    <span className={cx("text-xs", stale ? "text-amber-600" : "text-slate-500")} title="farm-agent heartbeat">
      {data.agent ? `agent ${Math.round(data.agent.age_sec)}s` : "agent 없음"}
    </span>
  );
}

export function Layout() {
  const stream = useLiveEvents();
  const { token } = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = useCallback(() => setSettingsOpen(true), []);

  return (
    <OpenSettings.Provider value={openSettings}>
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2">
            <span className="font-semibold">sample device farm</span>
            <nav className="flex flex-wrap gap-1">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cx("rounded-md px-2.5 py-1 text-sm", isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-3">
              <AgentStatus />
              <span
                className={cx("h-2 w-2 rounded-full", stream === "open" ? "bg-emerald-500" : "bg-amber-400")}
                title={stream === "open" ? "실시간 갱신 연결됨" : "실시간 갱신 재연결 중"}
              />
              <Button size="sm" variant={token ? "ghost" : "secondary"} onClick={openSettings}>
                {token ? "설정" : "토큰 설정 필요"}
              </Button>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">
          <Outlet />
        </main>
      </div>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </OpenSettings.Provider>
  );
}

/** Inline notice for write actions when no token is stored. */
export function TokenNotice() {
  const { token } = useSettings();
  const openSettings = useOpenSettings();
  if (token) return null;
  return (
    <div className="mb-4 flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      <span>쓰기 작업에는 API 토큰이 필요합니다.</span>
      <Button size="sm" onClick={openSettings}>
        토큰 입력
      </Button>
    </div>
  );
}
