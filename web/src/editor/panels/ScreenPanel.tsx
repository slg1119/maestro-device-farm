import { Camera, Copy, List, Smartphone } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { API, apiJson } from "../../api/client";
import { useDeviceCommand, useDevices } from "../../api/queries";
import type { Reservation } from "../../api/types";
import { useCanWrite } from "../../components/Layout";
import { Badge, Button, Card, Empty, ErrorBox, Input, StatusDot, cx } from "../../components/ui";
import { formatTime } from "../../lib/format";
import { useEditor, useEditorRuntime, type SelectorCandidate } from "../store";
import { candidatesFor, flattenHierarchy, selectorInsertion, selectorText, snapshotCandidates, type ScreenElement, type SelectorCommand } from "./screen/hierarchy";
import { SnapshotImage } from "./screen/SnapshotImage";

interface Snapshot { commandId: string; time: string; nodes: ScreenElement[] }

export function ScreenPanel({ onReserve }: { onReserve?: () => void }) {
  const { reservation, setSnapshotSelectors } = useEditor();
  useEffect(() => { setSnapshotSelectors([]); }, [reservation?.id, setSnapshotSelectors]);
  if (!reservation || reservation.status !== "active") return <div className="p-4"><Empty><Smartphone aria-hidden="true" className="mx-auto mb-3 size-8 text-fg-subtle" /><p>화면을 확인하려면 기기를 예약하세요.</p><Button className="mt-4" onClick={onReserve}>기기 예약</Button></Empty></div>;
  return <ReservedScreen key={reservation.id} reservation={reservation} />;
}

function ReservedScreen({ reservation }: { reservation: Reservation }) {
  const api = useEditor(); const runtime = useEditorRuntime(); const canWrite = useCanWrite(); const devices = useDevices();
  const current = useRef({ api, runtime }); current.current = { api, runtime };
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [commandId, setCommandId] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [feedback, setFeedback] = useState("");
  const [showList, setShowList] = useState(false);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<ScreenElement | null>(null);
  const [inserting, setInserting] = useState(false);
  const command = useDeviceCommand(commandId);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => { controller.abort(); }; }, []);

  useEffect(() => {
    if (!commandId) return;
    const result = command.data;
    if (!command.error && result?.status !== "done" && result?.status !== "error") return;
    let active = true;
    void (async () => {
      try {
        if (command.error) throw command.error;
        if (!result || result.status === "error") throw new Error(result?.error_message || "스냅샷을 가져오지 못했습니다.");
        if (result.reservation_id !== reservation.id || result.device_serial !== reservation.device_serial) throw new Error("예약 기기와 스냅샷이 일치하지 않습니다.");
        if (!result.files["screen.png"] || !result.files["hierarchy.json"]) throw new Error("스냅샷 이미지 또는 요소 정보가 없습니다.");
        const root = await apiJson<unknown>(`/device-commands/${encodeURIComponent(commandId)}/files/hierarchy.json`, { signal: lifetime.current?.signal });
        if (!root || typeof root !== "object") throw new Error("화면 요소 정보를 읽을 수 없습니다.");
        if (!active || lifetime.current?.signal.aborted) return;
        const nodes = flattenHierarchy(root);
        setSnapshot({ commandId, time: result.finished_at ?? new Date().toISOString(), nodes });
        setSelected(null); setFilter(""); setFeedback("");
        current.current.api.setSnapshotSelectors(snapshotCandidates(nodes));
      } catch (failure) { if (active && !lifetime.current?.signal.aborted) setError(failure); }
      finally { if (active && !lifetime.current?.signal.aborted) { setCommandId(null); setCapturing(false); } }
    })();
    return () => { active = false; };
  }, [commandId, command.data, command.error, reservation.id, reservation.device_serial]);

  const takeSnapshot = async () => {
    if (!canWrite || capturing) return;
    setCapturing(true); setError(null); setFeedback("");
    try {
      const result = await apiJson<{ id: string }>(`/reservations/${encodeURIComponent(reservation.id)}/inspect`, { method: "POST", signal: lifetime.current?.signal });
      if (!result.id) throw new Error("스냅샷 명령을 확인할 수 없습니다.");
      if (!lifetime.current?.signal.aborted) setCommandId(result.id);
    } catch (failure) { if (!lifetime.current?.signal.aborted) { setError(failure); setCapturing(false); } }
  };
  const nodes = snapshot?.nodes ?? [];
  const candidates = useMemo(() => selected ? candidatesFor(selected, nodes) : [], [selected, nodes]);
  const filtered = useMemo(() => nodes.filter(node => [node.attributes["resource-id"], node.attributes.text, node.attributes.accessibilityText].some(value => value?.trim()) && Object.values(node.attributes).join(" ").toLocaleLowerCase().includes(filter.toLocaleLowerCase())), [nodes, filter]);
  const device = devices.data?.find(item => item.serial === reservation.device_serial);
  const canInsert = canWrite && Boolean(api.activePath && /\.ya?ml$/i.test(api.activePath)) && !inserting;

  const copy = async (candidate: SelectorCandidate) => {
    try { await navigator.clipboard.writeText(selectorText(candidate)); if (!lifetime.current?.signal.aborted) setFeedback("셀렉터를 복사했습니다."); }
    catch { if (!lifetime.current?.signal.aborted) setError(new Error("셀렉터를 복사하지 못했습니다. 브라우저의 클립보드 권한을 확인하세요.")); }
  };
  const insert = async (action: SelectorCommand, candidate: SelectorCandidate) => {
    const path = api.activePath; const cursor = { ...runtime.cursor };
    if (!canInsert || !path) return;
    setInserting(true); setError(null);
    try {
      const content = await api.readFile(path);
      if (lifetime.current?.signal.aborted) return;
      if (current.current.api.activePath !== path || current.current.runtime.cursor.line !== cursor.line || current.current.runtime.cursor.column !== cursor.column) throw new Error("삽입 위치가 바뀌었습니다. 다시 삽입하세요.");
      current.current.api.insertAtCursor(selectorInsertion(action, candidate, content, cursor));
      setFeedback(`${action} 명령을 삽입했습니다.`);
    } catch (failure) { if (!lifetime.current?.signal.aborted) setError(failure); }
    finally { if (!lifetime.current?.signal.aborted) setInserting(false); }
  };

  return <div className="min-w-0 space-y-4 p-3 text-fg">
    <header className="space-y-3">
      <div className="flex min-w-0 items-start gap-2"><Smartphone aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-muted" /><div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{device?.model || reservation.device_serial}</h2><p className="truncate font-mono text-[11px] text-fg-subtle">{reservation.device_serial}</p></div><Badge tone="reserved"><StatusDot tone="reserved" />예약됨</Badge></div>
      <div className="flex flex-wrap items-center justify-between gap-2"><div className="text-xs text-fg-muted">{snapshot ? <><time dateTime={snapshot.time}>{formatTime(snapshot.time)}</time><span className="ml-2">요소 {nodes.length}개</span></> : "아직 찍은 화면이 없습니다."}</div></div>
      <div className="flex flex-wrap gap-2"><Button size="sm" icon={<List />} aria-pressed={showList} aria-controls="screen-elements" onClick={() => setShowList(!showList)}>요소 목록</Button><Button size="sm" variant="primary" icon={<Camera />} disabled={!canWrite || capturing} onClick={() => { void takeSnapshot(); }}>{capturing ? "찍는 중…" : "다시 찍기"}</Button></div>
    </header>
    <ErrorBox error={error} />
    {capturing && <p role="status" className="text-xs text-fg-muted">예약 기기의 화면과 요소 정보를 가져오는 중입니다.</p>}
    {snapshot ? <><SnapshotImage key={snapshot.commandId} src={`${API}/device-commands/${encodeURIComponent(snapshot.commandId)}/files/screen.png`} nodes={nodes} selected={selected} onSelect={node => { setSelected(node); setFeedback(""); }} onList={() => setShowList(true)} onError={() => setError(new Error("스냅샷 이미지를 불러오지 못했습니다. 다시 찍기를 눌러주세요."))} /><p className="text-xs leading-5 text-fg-subtle">화면을 눌러 요소를 선택하세요. 겹친 요소 중 가장 작은 요소가 선택됩니다.</p></> : !capturing && <Empty>다시 찍기를 눌러 현재 화면을 확인하세요.</Empty>}
    {showList && <section id="screen-elements" aria-label="요소 목록" className="space-y-2"><Input type="search" aria-label="요소 검색" placeholder="id, 텍스트, 클래스 검색" value={filter} onChange={event => setFilter(event.target.value)} />
      <ul aria-label="화면 요소" className="max-h-64 space-y-1 overflow-y-auto">{filtered.map(node => <li key={node.key}><button type="button" aria-pressed={selected?.key === node.key} onClick={() => { setSelected(node); setFeedback(""); }} className={cx("w-full min-w-0 rounded-lg border p-2 text-left text-xs focus-visible:outline-2 focus-visible:outline-accent max-md:min-h-11", selected?.key === node.key ? "border-accent bg-accent-soft text-accent-soft-fg" : "border-border bg-surface-2 hover:border-border-strong")}><span className="block truncate font-mono">{node.attributes["resource-id"] || node.attributes.text || node.attributes.accessibilityText}</span><span className="mt-1 block truncate text-[11px] text-fg-subtle">{node.attributes.class ?? "요소"} · {node.attributes.text || node.attributes.accessibilityText || "텍스트 없음"}</span></button></li>)}</ul>{!filtered.length && <p className="text-xs text-fg-subtle">{snapshot ? "일치하는 요소가 없습니다." : "화면을 찍으면 요소가 표시됩니다."}</p>}
    </section>}
    {selected && <section aria-label="선택한 요소"><Card className="min-w-0 space-y-3 p-3"><h3 className="text-sm font-semibold">선택한 요소</h3><dl className="space-y-2 text-xs"><div><dt className="text-fg-subtle">클래스</dt><dd className="mt-1 break-all font-mono">{selected.attributes.class ?? "정보 없음"}</dd></div><div><dt className="text-fg-subtle">영역</dt><dd className="mt-1 break-all font-mono">{selected.attributes.bounds ?? "정보 없음"}</dd></div><div><dt className="text-fg-subtle">클릭</dt><dd className="mt-1">{selected.attributes.clickable === "true" ? "클릭 가능" : "클릭 불가"}</dd></div></dl>
      <h4 className="border-t border-border pt-3 text-xs font-semibold">셀렉터 후보</h4><ul aria-label="셀렉터 후보" className="space-y-3">{candidates.map(candidate => <li key={candidate.kind} className="min-w-0 space-y-2"><code className="block break-all rounded bg-surface-2 p-2 text-[11px]">{selectorText(candidate)}</code><p className="text-[11px] text-fg-muted">{candidate.note}</p><div className="flex flex-wrap gap-1.5"><Button size="sm" icon={<Copy />} onClick={() => { void copy(candidate); }}>복사</Button><Button size="sm" disabled={!canInsert} onClick={() => { void insert("tapOn", candidate); }}>tapOn 삽입</Button><Button size="sm" disabled={!canInsert} onClick={() => { void insert("assertVisible", candidate); }}>assertVisible 삽입</Button></div></li>)}</ul>{!candidates.length && <p className="text-xs text-fg-subtle">사용할 수 있는 셀렉터가 없습니다. 요소 목록에서 다른 요소를 선택하세요.</p>}{!api.activePath || !/\.ya?ml$/i.test(api.activePath) ? <p className="text-xs text-fg-subtle">명령을 삽입하려면 YAML 파일을 여세요.</p> : null}
    </Card></section>}
    <p role="status" className="text-xs text-passed-fg" aria-live="polite">{feedback}</p>
  </div>;
}
