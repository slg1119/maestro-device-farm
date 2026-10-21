import { LiveView } from "../../components/live/LiveView";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, MoreHorizontal, Smartphone, Tag } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { API, apiJson } from "../../api/client";
import { keys, useDeviceCommand, useDevices } from "../../api/queries";
import type { Device, DeviceState, HierarchyNode, Reservation } from "../../api/types";
import { TokenNotice, useCanWrite } from "../../components/Layout";
import { DeviceStateBadge } from "../../components/StatusBadge";
import { Badge, Button, Card, Drawer, Empty, ErrorBox, Field, Input, Loading, Menu, Modal, PageHeader, ProgressBar, Segmented, Select, cx } from "../../components/ui";
import { formatTime, parseTs, timeAgo } from "../../lib/format";
import { useSettings } from "../../lib/settings";

const STATES: { state: DeviceState; label: string }[] = [
  { state: "available", label: "사용 가능" }, { state: "busy", label: "실행 중" },
  { state: "reserved", label: "예약됨" }, { state: "unhealthy", label: "점검 필요" },
  { state: "disabled", label: "정비 모드" }, { state: "offline", label: "오프라인" },
];
const FILTERS = [
  { value: "all", label: "전체" }, { value: "available", label: "사용 가능" }, { value: "problem", label: "문제 있음" },
] as const;
type Filter = typeof FILTERS[number]["value"];
type Snapshot = { src: string; count: number | null };

function activeReservation(device: Device) {
  const reservation = device.reservation;
  return reservation?.status === "active" && parseTs(reservation.expires_at).getTime() > Date.now() ? reservation : null;
}

function elementCount(root: HierarchyNode): number {
  return 1 + (root.children ?? []).reduce((count, child) => count + elementCount(child), 0);
}

/** Command file URLs are supplied by the API, including its /api/v1 prefix. */
function commandFilePath(url: string): string {
  if (!url.startsWith(`${API}/device-commands/`)) throw new Error("스냅샷 파일 경로를 확인할 수 없습니다.");
  return url.slice(API.length);
}

function DeviceCard({ device, hidden }: { device: Device; hidden: boolean }) {
  const canWrite = useCanWrite();
  const client = useQueryClient();
  const { authorName } = useSettings();
  const holderName = authorName.trim() || "대시보드";
  const reservation = activeReservation(device);
  // The reservation contract exposes a holder name, rather than an owner/user id.
  const reservedByOther = reservation !== null && reservation.holder_name !== holderName;
  const unavailable = device.state === "offline" || device.state === "disabled" || device.disabled;
  const [editing, setEditing] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const [tags, setTags] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [snapshotError, setSnapshotError] = useState<unknown>(null);
  const [commandId, setCommandId] = useState<string | null>(null);
  const command = useDeviceCommand(commandId);
  const mounted = useRef(true);
  const capture = useRef<{ temporary: string | null; finishing: boolean } | null>(null);

  const refresh = useCallback(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: keys.devices }),
      client.invalidateQueries({ queryKey: keys.reservations }),
    ]);
  }, [client]);

  const releaseTemporary = useCallback(async () => {
    const id = capture.current?.temporary;
    if (!id) return;
    capture.current!.temporary = null;
    await apiJson(`/reservations/${encodeURIComponent(id)}`, { method: "DELETE" });
    await refresh();
  }, [refresh]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Also covers navigating away while inspect is queued/running.
      void releaseTemporary().catch(() => {});
    };
  }, [releaseTemporary]);

  const finishCapture = useCallback(async (error?: unknown) => {
    let failure = error;
    try { await releaseTemporary(); }
    catch (releaseError) {
      failure = new Error(`${error instanceof Error ? `${error.message} · ` : ""}임시 예약 해제 실패: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`);
      await refresh();
    }
    capture.current = null;
    if (mounted.current) {
      setSnapshotError(failure ?? null);
      setCommandId(null);
      setCapturing(false);
    }
  }, [refresh, releaseTemporary]);

  useEffect(() => {
    if (!commandId || !capture.current || capture.current.finishing) return;
    const result = command.data;
    if (!command.error && result?.status !== "done" && result?.status !== "error") return;
    capture.current.finishing = true;
    void (async () => {
      try {
        if (command.error) throw command.error;
        if (result?.status === "error") throw new Error(result.error_message || "스냅샷을 가져오지 못했습니다.");
        const src = result?.files["screen.png"];
        if (!src) throw new Error("스냅샷 이미지가 없습니다.");
        const hierarchyUrl = result?.files["hierarchy.json"];
        const count = hierarchyUrl ? elementCount(await apiJson<HierarchyNode>(commandFilePath(hierarchyUrl))) : null;
        if (mounted.current) { setSnapshot({ src, count }); setModalOpen(true); }
        await finishCapture();
      } catch (error) { await finishCapture(error); }
    })();
  }, [command.data, command.error, commandId, finishCapture]);

  const patch = useMutation({
    mutationFn: (value: Partial<Pick<Device, "tags" | "disabled">>) =>
      apiJson<Device>(`/devices/${encodeURIComponent(device.serial)}`, { method: "PATCH", json: value }),
    onSuccess: async (_updated, value) => {
      await refresh();
      if (value.tags !== undefined) setEditing(false);
    },
  });
  const reserve = useMutation({
    mutationFn: () => reservation
      ? apiJson<Reservation>(`/reservations/${encodeURIComponent(reservation.id)}`, { method: "DELETE" })
      : apiJson<Reservation>(`/devices/${encodeURIComponent(device.serial)}/reservations`, { method: "POST", json: { holder_name: holderName } }),
    onSuccess: refresh,
  });
  const writesDisabled = !canWrite || patch.isPending || reserve.isPending || capturing;

  const takeSnapshot = async () => {
    if (writesDisabled || unavailable || reservedByOther || capture.current) return;
    patch.reset(); reserve.reset(); setSnapshotError(null); setCapturing(true);
    capture.current = { temporary: null, finishing: false };
    try {
      let current = reservation;
      if (!current) {
        current = await apiJson<Reservation>(`/devices/${encodeURIComponent(device.serial)}/reservations`, { method: "POST", json: { holder_name: holderName } });
        capture.current.temporary = current.id;
        if (!mounted.current) { await releaseTemporary(); return; }
        void refresh();
      }
      const result = await apiJson<{ id: string }>(`/reservations/${encodeURIComponent(current.id)}/inspect`, { method: "POST" });
      if (mounted.current) setCommandId(result.id);
    } catch (error) { await finishCapture(error); }
  };

  const toggleMaintenance = () => {
    if (writesDisabled) return;
    if (!device.disabled && device.state === "busy" && !window.confirm("실행 중인 task는 끝까지 돌고 이후 배정이 멈춥니다. 정비 모드를 켤까요?")) return;
    reserve.reset(); setSnapshotError(null);
    patch.mutate({ disabled: !device.disabled });
  };

  return <article hidden={hidden} aria-label={`${device.model} (${device.serial})`} className="min-w-0">
    <Card className="flex h-full min-w-0 flex-col rounded-xl">
      <div className="flex min-w-0 gap-4 p-5">
        <div className="flex h-32 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border-strong bg-surface-2 text-fg-subtle">
          {snapshot ? <img className="h-full w-full object-contain" src={snapshot.src} alt={`${device.model} 최근 스냅샷`} />
            : <Smartphone aria-hidden="true" className="size-7 stroke-[1.8]" />}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-base font-semibold text-fg">{device.model}</h2>
          <p className="mt-1 break-all font-mono text-[11px] text-fg-subtle">{device.serial}</p>
          <div className="mt-2"><DeviceStateBadge state={device.state} /></div>
          <p className="mt-3 text-xs text-fg-muted">Android {device.os_version} · SDK {device.sdk_int}</p>
          <div className="mt-2 flex items-center gap-2">
            <ProgressBar className="max-w-24" total={100} label="배터리" segments={device.battery === null ? [] : [{ value: device.battery, tone: device.battery < 20 ? "failed" : "passed" }]} />
            <span className={cx("text-xs", device.battery !== null && device.battery < 20 ? "text-failed-fg" : "text-fg-muted")}>
              {device.battery === null ? "배터리 정보 없음" : `${device.battery}%`}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 px-5 pb-4">
        <div className="space-y-1 break-words text-xs text-fg-muted">
          {device.current_run_id && <Link className="inline-block min-h-6 text-accent hover:underline max-md:min-h-11 max-md:py-3" to={`/runs/${device.current_run_id}`}>실행 중인 run</Link>}
          {device.reservation && <p>예약: {device.reservation.holder_name} · {parseTs(device.reservation.expires_at).getTime() <= Date.now() ? "만료됨" : `${formatTime(device.reservation.expires_at)}까지`}</p>}
          {device.state_reason && <p>{device.state_reason}</p>}
          {!device.current_run_id && !device.reservation && !device.state_reason && <p title={formatTime(device.last_seen_at)}>마지막 확인 {timeAgo(device.last_seen_at)}</p>}
        </div>
        {editing ? <form className="space-y-2" onSubmit={(event) => {
          event.preventDefault();
          if (!writesDisabled) patch.mutate({ tags: [...new Set(tags.split(",").map((tag) => tag.trim()).filter(Boolean))].sort() });
        }}>
          <Field label="태그" hint="쉼표로 구분해 입력하세요."><Input autoFocus value={tags} disabled={writesDisabled} onChange={(event) => setTags(event.target.value)} /></Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={writesDisabled}>저장</Button>
            <Button disabled={patch.isPending} onClick={() => { setEditing(false); patch.reset(); }}>취소</Button>
          </div>
        </form> : <div className="flex flex-wrap gap-1.5">
          {device.tags.length ? device.tags.map((tag) => <Badge key={tag}><span className="break-all">{tag}</span></Badge>) : <span className="text-xs text-fg-subtle">태그 없음</span>}
        </div>}
        {capturing && <p role="status" className="text-xs text-fg-muted">스냅샷을 가져오는 중…</p>}
        <ErrorBox error={patch.error || reserve.error || snapshotError} />
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
        {!unavailable && <Button size="sm" disabled={writesDisabled} onClick={() => { patch.reset(); setSnapshotError(null); reserve.mutate(); }}>{reservation ? "예약 해제" : "예약"}</Button>}
        <Button size="sm" disabled={device.state === "offline"} onClick={() => setLiveOpen(true)}>라이브</Button>
        <Button size="sm" icon={<Camera />} disabled={writesDisabled || unavailable || reservedByOther} title={reservedByOther ? "다른 사용자가 예약한 기기입니다." : undefined} onClick={() => void takeSnapshot()}>스냅샷</Button>
        {!editing && <Button size="sm" variant="ghost" icon={<Tag />} disabled={writesDisabled} onClick={() => { setTags(device.tags.join(", ")); patch.reset(); reserve.reset(); setSnapshotError(null); setEditing(true); }}>태그</Button>}
        <div className="ml-auto"><Menu label="기기 메뉴" icon={<MoreHorizontal />} items={[{ label: device.disabled ? "정비 모드 끄기" : "정비 모드 켜기", disabled: writesDisabled, onClick: toggleMaintenance }]} /></div>
      </div>
    </Card>
    {liveOpen && <Drawer title={`${device.model} 라이브`} onClose={() => setLiveOpen(false)}><LiveView serial={device.serial} /></Drawer>}
    {modalOpen && snapshot && <Modal title={`${device.model} 스냅샷`} onClose={() => setModalOpen(false)}>
      <p className="mb-3 text-xs text-fg-muted">{snapshot.count === null ? "계층 정보 없음" : `계층 요소 ${snapshot.count}개`}</p>
      <img src={snapshot.src} alt={`${device.model} 화면`} className="mx-auto max-h-[65dvh] max-w-full rounded-lg border border-border object-contain" />
    </Modal>}
  </article>;
}

export function DevicesPage() {
  const { data, isPending, error } = useDevices();
  const [filter, setFilter] = useState<Filter>("all");
  const [tag, setTag] = useState("");
  const summary = STATES.map(({ state, label }) => {
    const count = data?.filter((device) => device.state === state).length ?? 0;
    return count ? `${label} ${count}` : null;
  }).filter(Boolean).join(" · ");
  const matches = (device: Device) => (filter === "all" || (filter === "available" ? device.state === "available" : ["unhealthy", "offline", "disabled"].includes(device.state) || device.disabled)) && (!tag || device.tags.includes(tag));
  const tags = [...new Set(data?.flatMap((device) => device.tags) ?? [])].sort();

  return <>
    <PageHeader title="기기">{summary}</PageHeader>
    <TokenNotice />
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <Segmented label="기기 상태 필터" options={FILTERS} value={filter} onChange={setFilter} />
      <Select aria-label="태그 필터" className="w-full md:w-44" value={tag} onChange={(event) => setTag(event.target.value)}>
        <option value="">모든 태그</option>
        {tag && !tags.includes(tag) && <option value={tag}>{tag}</option>}
        {tags.map((value) => <option key={value} value={value}>{value}</option>)}
      </Select>
    </div>
    {isPending ? <Loading /> : error ? <ErrorBox error={error} /> : !data?.length ? <Empty>연결된 기기가 없습니다. farm-agent가 실행 중인지 확인하세요.</Empty> : <>
      {!data.some(matches) && <Empty>조건에 맞는 기기가 없습니다.</Empty>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-4">
        {/* Keep card sessions mounted during filtering so in-flight captures still release their reservation. */}
        {[...data].sort((a, b) => a.serial.localeCompare(b.serial)).map((device) => <DeviceCard key={device.serial} device={device} hidden={!matches(device)} />)}
      </div>
    </>}
  </>;
}
