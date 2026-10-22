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
  { value: "all", label: "전체" }, { value: "available", label: "사용 가능" },
  { value: "busy", label: "실행 중" }, { value: "disabled", label: "비활성" },
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
    <PageHeader title="라이브 보드" description="연결된 기기의 화면을 한눈에 확인하세요. 타일을 누르면 크게 보고 조작할 수 있습니다."
      actions={<Button icon={paused ? <Play /> : <Pause />} aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? "모두 재생" : "모두 일시정지"}</Button>} />
    <Card className="mb-5 space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-fg-muted">연결된 기기 {connected.length}대 · 보기 전용</p>
        <label className="flex w-full items-center gap-3 text-xs text-fg-muted sm:w-auto">
          <span className="shrink-0">타일 크기</span>
          <input type="range" aria-label="타일 크기" aria-valuetext={`${tileSize} 픽셀`} min={MIN_SIZE} max={MAX_SIZE} step={10} value={tileSize} className="min-h-8 min-w-0 flex-1 accent-accent sm:w-40"
            onChange={(event) => {
              const value = Number(event.target.value); setTileSize(value);
              try { localStorage.setItem(TILE_SIZE_KEY, String(value)); } catch { /* Keep the session preference. */ }
            }} />
          <output className="w-12 shrink-0 text-right font-mono">{tileSize}px</output>
        </label>
      </div>
      <div role="group" aria-label="기기 상태 필터" className="flex flex-wrap gap-2">
        {FILTERS.map(({ value, label }) => <Button key={value} size="sm" variant={filter === value ? "primary" : "secondary"} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</Button>)}
      </div>
      {(tags.length > 0 || tag) && <div role="group" aria-label="태그 필터" className="flex flex-wrap gap-2">
        <Button size="sm" variant={!tag ? "primary" : "secondary"} aria-pressed={!tag} onClick={() => setTag("")}>모든 태그</Button>
        {[...new Set([...tags, ...(tag ? [tag] : [])])].map((value) => <Button key={value} size="sm" className="max-w-full whitespace-normal break-all" variant={tag === value ? "primary" : "secondary"} aria-pressed={tag === value} onClick={() => setTag(value)}>{value}</Button>)}
      </div>}
      <p className="text-xs leading-5 text-fg-subtle">화면 밖의 타일과 숨겨진 브라우저 탭은 자동으로 일시정지합니다. 확대 중인 기기의 타일도 잠시 멈춥니다.</p>
    </Card>
    {isPending ? <Loading label="기기 목록을 불러오는 중…" /> : error ? <div className="space-y-3">
      <ErrorBox error="기기 목록을 불러오지 못했습니다. 잠시 후 다시 시도하세요." />
      <Button onClick={() => void refetch()}>다시 시도</Button>
    </div> : <>
      {!devices.length ? <Empty>연결된 기기가 없습니다. farm-agent가 실행 중인지 확인하세요.</Empty>
        : !connected.length ? <Empty>연결된 기기가 없습니다. 오프라인 기기는 연결되면 여기에 표시됩니다.</Empty>
        : !filtered.length ? <Empty>조건에 맞는 기기가 없습니다.</Empty> : null}
      <section aria-label="기기 라이브 그리드" className="grid items-start gap-4"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${tileSize}px, 100%), 1fr))` }}>
        {filtered.map((device) => <LiveTile key={device.serial} device={device} paused={paused || !tabVisible || opened?.serial === device.serial}
          pauseReason={opened?.serial === device.serial ? "확대 화면에서 재생 중" : !tabVisible ? "브라우저 탭이 숨겨져 일시정지됨" : "일시정지됨"}
          onOpen={() => setSelected(device.serial)} />)}
      </section>
      {offline.length > 0 && <details className="mt-6 rounded-lg border border-border bg-surface-2 p-3 text-xs text-fg-subtle">
        <summary className="cursor-pointer">오프라인 {offline.length}대 · 화면 연결 안 함</summary>
        <ul className="mt-3 space-y-2">{offline.map((device) => <li key={device.serial} className="flex flex-wrap gap-x-3 gap-y-1"><span className="break-words">{device.model}</span><span className="break-all font-mono">{device.serial}</span></li>)}</ul>
      </details>}
    </>}
    {opened && <Drawer title={`${opened.model} 라이브`} resizable storageKey={LIVE_DRAWER_STORAGE_KEY} onClose={() => setSelected(null)}><LiveView serial={opened.serial} /></Drawer>}
  </>;
}
