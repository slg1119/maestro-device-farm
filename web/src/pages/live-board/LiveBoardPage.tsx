import { t, tp } from "../../lib/i18n";
import { Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";

import { useDevices } from "../../api/queries";
import type { Device } from "../../api/types";
import { LiveTile } from "../../components/live/LiveTile";
import { LiveView } from "../../components/live/LiveView";
import { LIVE_DRAWER_STORAGE_KEY } from "../../components/live/useResizableSize";
import { Button, Card, Drawer, Empty, ErrorBox, Loading, PageHeader } from "../../components/ui";

const TILE_SIZE_KEY = "farm.live-board.tile-size";
const MIN_SIZE = 160; const MAX_SIZE = 480; const DEFAULT_SIZE = 240;
function readTileSize() {
  try {
    const stored = localStorage.getItem(TILE_SIZE_KEY);
    const value = Number(stored);
    return stored && Number.isFinite(value) && value >= MIN_SIZE && value <= MAX_SIZE ? value : DEFAULT_SIZE;
  } catch { return DEFAULT_SIZE; }
}
const FILTERS = [
  { value: "all", label: t("m_934dd25ec5") }, { value: "available", label: t("m_d4bbb3d8e2") },
  { value: "busy", label: t("m_0d01d3e76a") }, { value: "disabled", label: t("m_fae2014b52") },
] as const;
type Filter = typeof FILTERS[number]["value"];
function matchesState(device: Device, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "disabled") return device.state === "disabled" || device.disabled;
  return device.state === filter && !device.disabled;
}

export function LiveBoardPage() {
  const { data, isPending, error, refetch } = useDevices();
  const [tileSize, setTileSize] = useState(readTileSize);
  const [filter, setFilter] = useState<Filter>("all");
  const [tag, setTag] = useState("");
  const [paused, setPaused] = useState(false);
  const [tabVisible, setTabVisible] = useState(() => document.visibilityState !== "hidden");
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setTabVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const devices = data ?? [];
  const connected = devices.filter((device) => device.state !== "offline");
  const offline = devices.filter((device) => device.state === "offline");
  const tags = [...new Set(connected.flatMap((device) => device.tags))].sort();
  const filtered = connected.filter((device) => matchesState(device, filter) && (!tag || device.tags.includes(tag)))
    .sort((a, b) => a.serial.localeCompare(b.serial));
  const opened = connected.find((device) => device.serial === selected);

  return <>
    <PageHeader title={t("m_7ba2177d50")} description={t("m_4b330cc1b6")}
      actions={<Button icon={paused ? <Play /> : <Pause />} aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? t("m_bca5ad6952") : t("m_cd190cedf1")}</Button>} />
    <Card className="mb-5 space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-fg-muted">{tp("live.connectedCount", connected.length)}</p>
        <label className="flex w-full items-center gap-3 text-xs text-fg-muted sm:w-auto">
          <span className="shrink-0">{t("m_356a0bad18")}</span>
          <input type="range" aria-label={t("m_356a0bad18")} aria-valuetext={t("m_0ab06b19c0", [tileSize])} min={MIN_SIZE} max={MAX_SIZE} step={10} value={tileSize} className="min-h-8 min-w-0 flex-1 accent-accent sm:w-40"
            onChange={(event) => {
              const value = Number(event.target.value); setTileSize(value);
              try { localStorage.setItem(TILE_SIZE_KEY, String(value)); } catch { /* Keep the session preference. */ }
            }} />
          <output className="w-12 shrink-0 text-right font-mono">{tileSize}{t("e_07a65dd648")}</output>
        </label>
      </div>
      <div role="group" aria-label={t("m_793a2ba251")} className="flex flex-wrap gap-2">
        {FILTERS.map(({ value, label }) => <Button key={value} size="sm" variant={filter === value ? "primary" : "secondary"} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</Button>)}
      </div>
      {(tags.length > 0 || tag) && <div role="group" aria-label={t("m_de0e38a53f")} className="flex flex-wrap gap-2">
        <Button size="sm" variant={!tag ? "primary" : "secondary"} aria-pressed={!tag} onClick={() => setTag("")}>{t("m_e88a36f55b")}</Button>
        {[...new Set([...tags, ...(tag ? [tag] : [])])].map((value) => <Button key={value} size="sm" className="max-w-full whitespace-normal break-all" variant={tag === value ? "primary" : "secondary"} aria-pressed={tag === value} onClick={() => setTag(value)}>{value}</Button>)}
      </div>}
      <p className="text-xs leading-5 text-fg-subtle">{t("m_fb5aae7628")}</p>
    </Card>
    {isPending ? <Loading label={t("m_8e3ec999b8")} /> : error ? <div className="space-y-3">
      <ErrorBox error={t("m_382d89e727")} />
      <Button onClick={() => void refetch()}>{t("m_0c767cecf6")}</Button>
    </div> : <>
      {!devices.length ? <Empty>{t("m_a8e9093964")}</Empty>
        : !connected.length ? <Empty>{t("m_478a98e254")}</Empty>
        : !filtered.length ? <Empty>{t("m_4833bb9e9c")}</Empty> : null}
      <section aria-label={t("m_8a9f908488")} className="grid items-start gap-4"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${tileSize}px, 100%), 1fr))` }}>
        {filtered.map((device) => <LiveTile key={device.serial} device={device} paused={paused || !tabVisible || opened?.serial === device.serial}
          pauseReason={opened?.serial === device.serial ? t("m_8257fa0b4f") : !tabVisible ? t("m_a9bf9ff64e") : t("m_2c992a873f")}
          onOpen={() => setSelected(device.serial)} />)}
      </section>
      {offline.length > 0 && <details className="mt-6 rounded-lg border border-border bg-surface-2 p-3 text-xs text-fg-subtle">
        <summary className="cursor-pointer">{tp("live.offlineCount", offline.length)}</summary>
        <ul className="mt-3 space-y-2">{offline.map((device) => <li key={device.serial} className="flex flex-wrap gap-x-3 gap-y-1"><span className="break-words">{device.model}</span><span className="break-all font-mono">{device.serial}</span></li>)}</ul>
      </details>}
    </>}
    {opened && <Drawer title={t("m_bdd0003871", [opened.model])} resizable storageKey={LIVE_DRAWER_STORAGE_KEY} onClose={() => setSelected(null)}><LiveView serial={opened.serial} /></Drawer>}
  </>;
}
