import { t } from "../../lib/i18n";
import { RecordingLiveView } from "./screen/RecordingLiveView";
import { Camera, Copy, List, Smartphone } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { API, apiJson } from "../../api/client";
import { useDeviceCommand, useDevices } from "../../api/queries";
import type { Reservation } from "../../api/types";
import { useCanWrite } from "../../components/Layout";
import { Badge, Button, Card, Empty, ErrorBox, Input, Segmented, StatusDot, cx } from "../../components/ui";
import { formatTime } from "../../lib/format";
import { useEditor, useEditorRuntime, type SelectorCandidate } from "../store";
import { candidatesFor, flattenHierarchy, selectorInsertion, selectorText, snapshotCandidates, type ScreenElement, type SelectorCommand } from "./screen/hierarchy";
import { SnapshotImage } from "./screen/SnapshotImage";

interface Snapshot { commandId: string; time: string; nodes: ScreenElement[] }

export function ScreenPanel({ onReserve, onDraftImported }: { onReserve?: () => void; onDraftImported?: () => void }) {
  const { reservation, setSnapshotSelectors } = useEditor();
  useEffect(() => { setSnapshotSelectors([]); }, [reservation?.id, setSnapshotSelectors]);
  if (!reservation || reservation.status !== "active") return <div className="p-4"><Empty><Smartphone aria-hidden="true" className="mx-auto mb-3 size-8 text-fg-subtle" /><p>{t("m_da741f4c3c")}</p><Button className="mt-4" onClick={onReserve}>{t("m_6c99a584b4")}</Button></Empty></div>;
  return <ScreenModes key={reservation.id} reservation={reservation} onDraftImported={onDraftImported} />;
}

function ScreenModes({ reservation, onDraftImported }: { reservation: Reservation; onDraftImported?: () => void }) {
  const [mode, setMode] = useState<"live" | "snapshot">("live");
  return <div className="min-w-0"><div className="p-3 pb-0"><Segmented label={t("m_dd9a9c5418")} options={[{ value: "live", label: t("m_db12b62c3a") }, { value: "snapshot", label: t("m_d019d21f90") }]} value={mode} onChange={setMode} /></div>
    {mode === "live" ? <RecordingLiveView serial={reservation.device_serial} onImported={onDraftImported} /> : <ReservedScreen reservation={reservation} />}
  </div>;
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
        if (!result || result.status === "error") throw new Error(result?.error_message || t("m_8606d100e7"));
        if (result.reservation_id !== reservation.id || result.device_serial !== reservation.device_serial) throw new Error(t("m_8d5a26c8de"));
        if (!result.files["screen.png"] || !result.files["hierarchy.json"]) throw new Error(t("m_dee78443bc"));
        const root = await apiJson<unknown>(`/device-commands/${encodeURIComponent(commandId)}/files/hierarchy.json`, { signal: lifetime.current?.signal });
        if (!root || typeof root !== "object") throw new Error(t("m_dcceab15d1"));
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
      if (!result.id) throw new Error(t("m_eeac7cffda"));
      if (!lifetime.current?.signal.aborted) setCommandId(result.id);
    } catch (failure) { if (!lifetime.current?.signal.aborted) { setError(failure); setCapturing(false); } }
  };
  const nodes = snapshot?.nodes ?? [];
  const candidates = useMemo(() => selected ? candidatesFor(selected, nodes) : [], [selected, nodes]);
  const filtered = useMemo(() => nodes.filter(node => [node.attributes["resource-id"], node.attributes.text, node.attributes.accessibilityText].some(value => value?.trim()) && Object.values(node.attributes).join(" ").toLocaleLowerCase().includes(filter.toLocaleLowerCase())), [nodes, filter]);
  const device = devices.data?.find(item => item.serial === reservation.device_serial);
  const canInsert = canWrite && Boolean(api.activePath && /\.ya?ml$/i.test(api.activePath)) && !inserting;

  const copy = async (candidate: SelectorCandidate) => {
    try { await navigator.clipboard.writeText(selectorText(candidate)); if (!lifetime.current?.signal.aborted) setFeedback(t("m_f3875c73b1")); }
    catch { if (!lifetime.current?.signal.aborted) setError(new Error(t("m_60db3d99df"))); }
  };
  const insert = async (action: SelectorCommand, candidate: SelectorCandidate) => {
    const path = api.activePath; const cursor = { ...runtime.cursor };
    if (!canInsert || !path) return;
    setInserting(true); setError(null);
    try {
      const content = await api.readFile(path);
      if (lifetime.current?.signal.aborted) return;
      if (current.current.api.activePath !== path || current.current.runtime.cursor.line !== cursor.line || current.current.runtime.cursor.column !== cursor.column) throw new Error(t("m_5c4d5adc64"));
      current.current.api.insertAtCursor(selectorInsertion(action, candidate, content, cursor));
      setFeedback(t("m_5f3bf95de1", [action]));
    } catch (failure) { if (!lifetime.current?.signal.aborted) setError(failure); }
    finally { if (!lifetime.current?.signal.aborted) setInserting(false); }
  };

  return <div className="min-w-0 space-y-4 p-3 text-fg">
    <header className="space-y-3">
      <div className="flex min-w-0 items-start gap-2"><Smartphone aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-muted" /><div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{device?.model || reservation.device_serial}</h2><p className="truncate font-mono text-[11px] text-fg-subtle">{reservation.device_serial}</p></div><Badge tone="reserved"><StatusDot tone="reserved" />{t("m_69692a2a38")}</Badge></div>
      <div className="flex flex-wrap items-center justify-between gap-2"><div className="text-xs text-fg-muted">{snapshot ? <><time dateTime={snapshot.time}>{formatTime(snapshot.time)}</time><span className="ml-2">{t("m_a2314fdb82")} {nodes.length}{t("m_11600c9ada")}</span></> : t("m_00dbdab3d4")}</div></div>
      <div className="flex flex-wrap gap-2"><Button size="sm" icon={<List />} aria-pressed={showList} aria-controls="screen-elements" onClick={() => setShowList(!showList)}>{t("m_38d3de4301")}</Button><Button size="sm" variant="primary" icon={<Camera />} disabled={!canWrite || capturing} onClick={() => { void takeSnapshot(); }}>{capturing ? t("m_05c94074ef") : t("m_6e794da935")}</Button></div>
    </header>
    <ErrorBox error={error} />
    {capturing && <p role="status" className="text-xs text-fg-muted">{t("m_291af8423f")}</p>}
    {snapshot ? <><SnapshotImage key={snapshot.commandId} src={`${API}/device-commands/${encodeURIComponent(snapshot.commandId)}/files/screen.png`} nodes={nodes} selected={selected} onSelect={node => { setSelected(node); setFeedback(""); }} onList={() => setShowList(true)} onError={() => setError(new Error(t("m_bd3b4ebbc0")))} /><p className="text-xs leading-5 text-fg-subtle">{t("m_c8137d0349")}</p></> : !capturing && <Empty>{t("m_34f81d8590")}</Empty>}
    {showList && <section id="screen-elements" aria-label={t("m_38d3de4301")} className="space-y-2"><Input type="search" aria-label={t("m_2ea2482997")} placeholder={t("m_b3d1081ed6")} value={filter} onChange={event => setFilter(event.target.value)} />
      <ul aria-label={t("m_7b1cab3d43")} className="max-h-64 space-y-1 overflow-y-auto">{filtered.map(node => <li key={node.key}><button type="button" aria-pressed={selected?.key === node.key} onClick={() => { setSelected(node); setFeedback(""); }} className={cx("w-full min-w-0 rounded-lg border p-2 text-left text-xs focus-visible:outline-2 focus-visible:outline-accent max-md:min-h-11", selected?.key === node.key ? "border-accent bg-accent-soft text-accent-soft-fg" : "border-border bg-surface-2 hover:border-border-strong")}><span className="block truncate font-mono">{node.attributes["resource-id"] || node.attributes.text || node.attributes.accessibilityText}</span><span className="mt-1 block truncate text-[11px] text-fg-subtle">{node.attributes.class ?? t("m_a2314fdb82")} · {node.attributes.text || node.attributes.accessibilityText || t("m_1922271063")}</span></button></li>)}</ul>{!filtered.length && <p className="text-xs text-fg-subtle">{snapshot ? t("m_daf7d0ede2") : t("m_8dbf30bd43")}</p>}
    </section>}
    {selected && <section aria-label={t("m_cc2ea8e123")}><Card className="min-w-0 space-y-3 p-3"><h3 className="text-sm font-semibold">{t("m_cc2ea8e123")}</h3><dl className="space-y-2 text-xs"><div><dt className="text-fg-subtle">{t("m_876d4d87b2")}</dt><dd className="mt-1 break-all font-mono">{selected.attributes.class ?? t("m_534fb589c8")}</dd></div><div><dt className="text-fg-subtle">{t("m_b1f8cae0b1")}</dt><dd className="mt-1 break-all font-mono">{selected.attributes.bounds ?? t("m_534fb589c8")}</dd></div><div><dt className="text-fg-subtle">{t("m_6e3b1fc9f9")}</dt><dd className="mt-1">{selected.attributes.clickable === "true" ? t("m_c8d3ac86fb") : t("m_36cfb51376")}</dd></div></dl>
      <h4 className="border-t border-border pt-3 text-xs font-semibold">{t("m_369c22d55d")}</h4><ul aria-label={t("m_369c22d55d")} className="space-y-3">{candidates.map(candidate => <li key={candidate.kind} className="min-w-0 space-y-2"><code className="block break-all rounded bg-surface-2 p-2 text-[11px]">{selectorText(candidate)}</code><p className="text-[11px] text-fg-muted">{candidate.note}</p><div className="flex flex-wrap gap-1.5"><Button size="sm" icon={<Copy />} onClick={() => { void copy(candidate); }}>{t("m_a55b1ecb20")}</Button><Button size="sm" disabled={!canInsert} onClick={() => { void insert("tapOn", candidate); }}>{t("m_d899700e5b")}</Button><Button size="sm" disabled={!canInsert} onClick={() => { void insert("assertVisible", candidate); }}>{t("m_0a9aec6ad2")}</Button></div></li>)}</ul>{!candidates.length && <p className="text-xs text-fg-subtle">{t("m_ac3112f5bb")}</p>}{!api.activePath || !/\.ya?ml$/i.test(api.activePath) ? <p className="text-xs text-fg-subtle">{t("m_ff37e9322a")}</p> : null}
    </Card></section>}
    <p role="status" className="text-xs text-passed-fg" aria-live="polite">{feedback}</p>
  </div>;
}
