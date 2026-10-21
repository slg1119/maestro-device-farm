import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useState } from "react";
import { Outlet } from "react-router";

import { useLiveEvents } from "../api/events";
import { apiJson } from "../api/client";
import { keys } from "../api/queries";
import type { Health } from "../api/types";
import { useSettings } from "../lib/settings";
import { SettingsDialog } from "./SettingsDialog";
import { AppShell } from "./AppShell";
import { Button } from "./ui";

const OpenSettings = createContext<() => void>(() => {});

/** Opens the settings dialog (token, author) from anywhere inside the layout. */
export function useOpenSettings(): () => void {
  return useContext(OpenSettings);
}

/** Writes are open unless the server says it requires a token (FARM_REQUIRE_TOKEN) and none is stored. */
export function useCanWrite(): boolean {
  const { token } = useSettings();
  // Shares the Layout's health query; skipped entirely once a token is stored.
  const { data } = useQuery({ queryKey: keys.health, queryFn: () => apiJson<Health>("/healthz"), enabled: !token });
  return Boolean(token) || data?.auth_required !== true;
}

export function Layout() {
  const stream = useLiveEvents();
  const canWrite = useCanWrite();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = useCallback(() => setSettingsOpen(true), []);

  return (
    <OpenSettings.Provider value={openSettings}>
      <AppShell stream={stream} canWrite={canWrite} onOpenSettings={openSettings}>
        <Outlet />
      </AppShell>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </OpenSettings.Provider>
  );
}

/** Inline notice for write actions when the server requires a token and none is stored. */
export function TokenNotice() {
  const canWrite = useCanWrite();
  const openSettings = useOpenSettings();
  if (canWrite) return null;
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-warning/25 bg-warning-bg px-3 py-2 text-sm text-warning-fg">
      <span>쓰기 작업에는 API 토큰이 필요합니다.</span>
      <Button size="sm" onClick={openSettings}>
        토큰 입력
      </Button>
    </div>
  );
}
