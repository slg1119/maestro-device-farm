import { t } from "../../lib/i18n";
import { Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, apiJson } from "../../api/client";
import { keys, useApps, useDevices } from "../../api/queries";
import type { RunOptions } from "../../api/types";
import { useCanWrite } from "../../components/Layout";
import { DeviceStateBadge } from "../../components/StatusBadge";
import { Button, Empty, ErrorBox, Field, Kbd, Loading, Segmented, Select, Textarea, cx } from "../../components/ui";
import { useEditor } from "../store";
import { readSessionRuns, RunResults, type SessionRun } from "./run/RunResults";

export function RunPanel({ onShowScreen }: { onShowScreen?: () => void } = {}) {
  const editor = useEditor();
  const devices = useDevices();
  const apps = useApps();
  const client = useQueryClient();
  const canWrite = useCanWrite();
  const [serial, setSerial] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const sessionKey = `farm.editor.runs.${editor.workspace.id}`;
  const [runs, setRuns] = useState<SessionRun[]>(() => readSessionRuns(sessionKey));
  const [targetChoice, setTargetChoice] = useState<"current" | "all">("current");
  const [envText, setEnvText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const flowActive = Boolean(editor.activePath && /\.ya?ml$/.test(editor.activePath) && !/(^|\/)config\.ya?ml$/.test(editor.activePath) && editor.files.some(file => file.path === editor.activePath) && editor.drafts[editor.activePath]?.status !== "deleted");
  const target = flowActive ? targetChoice : "all";
  const builds = [...(apps.data ?? [])].filter(a => !a.purged).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const packages = [...new Set(builds.map(a => a.package_name))];
  const recentBuilds = builds.filter((build, index) => index < 20 || build.id === editor.appChoice.app_build_id);
  const appValue = editor.appChoice.app_build_id ? `build:${editor.appChoice.app_build_id}` : editor.appChoice.app ? `latest:${editor.appChoice.app}` : "";
  const appAvailable = editor.appChoice.app_build_id ? builds.some(a => a.id === editor.appChoice.app_build_id) : packages.some(pkg => `${pkg}@latest` === editor.appChoice.app);
  const canRun = canWrite && editor.reservation?.status === "active" && Boolean(editor.baseSha) && appAvailable && !pending && !submitting;
  const draftCount = Object.keys(editor.drafts).length;
  const submit = async () => {
    if (!canRun || inFlight.current || !editor.reservation) return;
    inFlight.current = true; setSubmitting(true); setError(null);
    try {
      const env: Record<string, string> = Object.create(null);
      for (const [index, line] of envText.split(/\r?\n/).entries()) {
        if (!line.trim()) continue;
        const equals = line.indexOf("="); const key = line.slice(0, equals).trim();
        if (equals < 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(t("m_9398eae4ab", [index + 1]));
        env[key] = line.slice(equals + 1);
      }
      const changes = editor.changes();
      const options: RunOptions = {
        origin: "editor", mode: "matrix", device_selector: { serials: [editor.reservation.device_serial] }, reservation_id: editor.reservation.id,
        ...editor.appChoice, workspace: editor.workspace.name, env,
        ...(changes.length ? { flow_source: "draft", base_sha: editor.baseSha, changes } : { flow_source: "workspace", ref: editor.baseSha }),
        ...(target === "current" && editor.activePath ? { flow_paths: [editor.activePath] } : {}),
      };
      const body = new FormData(); body.set("options", JSON.stringify(options));
      const result = await apiJson<{ id: string; url: string }>("/runs", { method: "POST", body });
      const next = [{ id: result.id, createdAt: new Date().toISOString() }, ...runs.filter(run => run.id !== result.id)].slice(0, 5);
      setRuns(next);
      try { sessionStorage.setItem(sessionKey, JSON.stringify(next)); } catch { /* Results remain available in memory. */ }
      void client.invalidateQueries({ queryKey: keys.runsAll });
      void client.invalidateQueries({ queryKey: keys.devices });
    } catch (e) {
      if (e instanceof ApiError && e.code === "no_matching_devices") {
        setError(new Error(t("m_6cb4ca7b8e")));
      } else if (e instanceof ApiError && e.code === "reservation_not_active") {
        setError(new Error(t("m_62ce98016f")));
      } else { setError(e); }
    } finally { inFlight.current = false; setSubmitting(false); }
  };
  const submitRef = useRef(submit); submitRef.current = submit;
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !event.repeat && !event.isComposing) { event.preventDefault(); void submitRef.current(); } };
    // Monaco consumes keyboard events; capture the run shortcut before its handlers.
    window.addEventListener("keydown", shortcut, true); return () => window.removeEventListener("keydown", shortcut, true);
  }, []);
  const list = [...(devices.data ?? [])].sort((a, b) => Number(b.state === "available" && !b.disabled) - Number(a.state === "available" && !a.disabled) || a.model.localeCompare(b.model));
  const selected = list.find(d => d.serial === serial);
  const selectable = selected && !selected.disabled && !selected.reservation && (selected.state === "available" || selected.state === "busy");
  const reserved = list.find(d => d.serial === editor.reservation?.device_serial);
  const changeReservation = async () => {
    if (!canWrite || pending || inFlight.current) return;
    setPending(true); setError(null);
    try { if (editor.reservation) await editor.release(); else if (selectable) await editor.reserve(serial); }
    catch (e) { setError(e); } finally { setPending(false); }
  };
  return <div className="min-w-0 space-y-5 p-4 text-sm text-fg">
    <section aria-label={t("m_213d741d67")} className="space-y-3">
      <h2 className="text-sm font-semibold">{t("m_d79c455f9b")}</h2>
      {editor.reservation ? <div className="space-y-2 rounded-xl border border-reserved/30 bg-reserved-bg p-3">
        <div className="flex min-w-0 items-center justify-between gap-2"><span className="truncate font-medium">{reserved?.model ?? editor.reservation.device_serial}</span><Button size="sm" disabled={!canWrite || pending || submitting} onClick={() => void changeReservation()}>{t("m_a7abea5bbb")}</Button></div>
        <p className="break-all font-mono text-xs text-fg-muted">{editor.reservation.device_serial}</p>
        <p className="text-xs text-reserved-fg">{t("m_3173ef71a4")} {new Date(editor.reservation.expires_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false })}{t("m_e16d220551")}</p>
      </div> : <>
        {devices.isLoading && <Loading />}
        <ErrorBox error={devices.error} />
        <div role="radiogroup" aria-label={t("m_d79c455f9b")} className="max-h-64 space-y-2 overflow-y-auto">
          {list.map(d => <button key={d.serial} type="button" role="radio" aria-checked={serial === d.serial} disabled={!canWrite || pending || d.disabled || Boolean(d.reservation) || (d.state !== "available" && d.state !== "busy")} onClick={() => setSerial(d.serial)} className={cx("flex min-h-14 w-full min-w-0 items-center justify-between gap-2 rounded-xl border bg-surface-2 p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50", serial === d.serial ? "border-accent" : "border-border")}>
            <span className="min-w-0"><span className="block truncate font-medium">{d.model}</span><span className="block break-all font-mono text-[11px] text-fg-subtle">{d.serial}</span></span>
            <DeviceStateBadge state={d.disabled ? "disabled" : d.reservation ? "reserved" : d.state} />
          </button>)}
        </div>
        {!devices.isLoading && !devices.error && !list.length && <Empty>{t("m_6900e5ebe6")}</Empty>}
        <Button className="w-full" disabled={!canWrite || !selectable || pending} onClick={() => void changeReservation()}>{pending ? t("m_2ab47ba61f") : t("m_17f4b4781b")}</Button>
      </>}
    </section>
    <section className="space-y-3" aria-label={t("m_8c5a711d8e")}>
      <Field label={t("m_abb7e84db5")}><Select aria-label={t("m_abb7e84db5")} value={appValue} onChange={event => { const value = event.target.value; editor.setAppChoice(value.startsWith("build:") ? { app_build_id: value.slice(6) } : value ? { app: value.slice(7) } : {}); }}>
        <option value="">{t("m_5aa75f8161")}</option>
        <optgroup label={t("m_e201106596")}>{packages.map(pkg => <option key={pkg} value={`latest:${pkg}@latest`}>{pkg}{t("e_fe9ca6d9f0")}</option>)}</optgroup>
        <optgroup label={t("m_a3896ce0e1")}>{recentBuilds.map(build => <option key={build.id} value={`build:${build.id}`}>{build.package_name} · {build.version_name} ({build.version_code}) · {build.id.slice(0, 7)}</option>)}</optgroup>
      </Select></Field>
      {apps.isLoading && <p className="text-xs text-fg-muted">{t("m_03eb81b9e8")}</p>}
      <ErrorBox error={apps.error} />
      <div className="space-y-1.5"><h2 className="text-xs font-medium text-fg-muted">{t("m_6bf537cb7e")}</h2><Segmented label={t("m_38aaab3dc3")} options={[{ value: "current", label: t("m_9e633f54f0"), disabled: !flowActive }, { value: "all", label: t("m_1723749118") }]} value={target} onChange={setTargetChoice} /></div>
      <details className="rounded-lg border border-border bg-surface-2">
        <summary className="min-h-9 cursor-pointer px-3 py-2 text-xs font-medium text-fg-muted focus-visible:outline-accent max-md:min-h-11">{t("m_e82c01609e")}</summary>
        <div className="space-y-2 px-3 pb-3"><Textarea aria-label={t("m_e82c01609e")} placeholder={t("e_5626d54413")} value={envText} onChange={event => setEnvText(event.target.value)} spellCheck={false} autoComplete="off" autoCapitalize="off" /><p className="text-xs text-fg-subtle">{t("m_c114a025c9")}</p></div>
      </details>
      {draftCount > 0 && <p className="text-xs text-warning-fg">{t("m_b73d9bffbc")} {draftCount}{t("m_ee63b83597")}</p>}
      <ErrorBox error={error} />
      <Button variant="primary" icon={<Play />} className="w-full min-w-0" disabled={!canRun} onClick={() => void submit()} aria-keyshortcuts="Meta+Enter Control+Enter"><span className="truncate">{submitting ? t("m_5449e1a686") : target === "current" ? t("m_80177e818f", [editor.activePath?.split("/").at(-1)]) : t("m_8ac7d6201d")}</span><Kbd className="ml-auto shrink-0">⌘↵</Kbd></Button>
      {!editor.reservation && <p className="text-xs text-fg-subtle">{t("m_c84e353411")}</p>}
    </section>
    <RunResults runs={runs} onShowScreen={onShowScreen} />
  </div>;
}
