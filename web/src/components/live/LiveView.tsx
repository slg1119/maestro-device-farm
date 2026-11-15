import { t, tp } from "../../lib/i18n";
import { ArrowLeft, Circle, Maximize2, Minimize2, Square } from "lucide-react";
import { type PointerEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useCanWrite } from "../Layout";
import { Button, IconButton, Input, StatusDot, cx } from "../ui";
import { videoPoint } from "./coords";
import { useLiveStream } from "./useLiveStream";
import { RecordingControls, type RecordingControlsProps } from "./RecordingControls";
import { LIVE_HEIGHT_STORAGE_KEYS, useResizableSize, useViewportSize } from "./useResizableSize";

export function LiveView({ serial, control = "auto", compact = false, workspace, appPackage, onRecordingComplete }: { serial: string; control?: "auto" | "never"; compact?: boolean; workspace?: RecordingControlsProps["workspace"]; appPackage?: RecordingControlsProps["appPackage"]; onRecordingComplete?: RecordingControlsProps["onComplete"] }) {
  const canWrite = useCanWrite(); const canvas = useRef<HTMLCanvasElement>(null);
  const stream = useLiveStream({ serial, control, canWrite, canvas });
  const [text, setText] = useState("");
  const [enlarged, setEnlarged] = useState(false); const toggle = useRef<HTMLButtonElement>(null);
  const section = useRef<HTMLElement>(null);
  const screenBox = useRef<HTMLDivElement>(null); const viewport = useViewportSize();
  const [availableHeight, setAvailableHeight] = useState(viewport.height);
  useLayoutEffect(() => {
    const root = section.current; if (!enlarged || !root) return;
    const controls = [...root.children].filter(child => child !== screenBox.current);
    const measure = () => {
      const style = getComputedStyle(root);
      const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
      const gaps = (parseFloat(style.rowGap) || 0) * controls.length;
      setAvailableHeight(Math.max(0, viewport.height - padding - gaps - controls.reduce((height, child) => height + child.getBoundingClientRect().height, 0)));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(root); controls.forEach(child => observer?.observe(child));
    return () => observer?.disconnect();
  }, [enlarged, viewport.height, stream.phase, stream.message, stream.canControl, stream.status?.running_task_id]);
  const height = useResizableSize({
    storageKey: LIVE_HEIGHT_STORAGE_KEYS[enlarged ? "enlarged" : compact ? "compact" : "normal"],
    defaultSize: enlarged ? availableHeight : Math.min(viewport.height * (compact ? 0.5 : 0.6), compact ? 480 : 640),
    min: 200, max: enlarged ? availableHeight : viewport.height * 0.9, axis: "y",
  });
  useEffect(() => {
    if (!enlarged) return;
    // Capture Escape inside the view before the Drawer, leaving portaled dialogs to handle it.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!section.current?.contains(event.target instanceof Node ? event.target : null) && !section.current?.contains(document.activeElement)) return;
      event.preventDefault(); event.stopPropagation(); setEnlarged(false); toggle.current?.focus();
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [enlarged]);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  // Layout cleanup precedes the stream hook's passive socket cleanup.
  useLayoutEffect(() => () => {
    const active = pointer.current; pointer.current = null;
    if (active) stream.send({ type: "touch", action: "up", x: active.x, y: active.y });
  }, [stream.canControl, stream.size, stream.send]);

  const point = (event: { clientX: number; clientY: number }, clamp = false) => canvas.current && stream.size
    ? videoPoint(event.clientX, event.clientY, canvas.current.getBoundingClientRect(), stream.size, clamp) : null;
  const touch = (event: PointerEvent<HTMLCanvasElement>, action: "down" | "move" | "up") => {
    if (!stream.canControl || (action === "down" && (pointer.current || event.button !== 0))) return;
    if (action !== "down" && pointer.current?.id !== event.pointerId) return;
    const position = point(event, action !== "down"); if (!position) return;
    if (!stream.send({ type: "touch", action, ...position })) return;
    event.preventDefault();
    if (action === "down") { pointer.current = { id: event.pointerId, ...position }; event.currentTarget.setPointerCapture?.(event.pointerId); }
    else if (action === "move") pointer.current = { id: event.pointerId, ...position };
    else { pointer.current = null; if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }
  };
  const cancelTouch = () => {
    const active = pointer.current; pointer.current = null;
    if (active) stream.send({ type: "touch", action: "up", x: active.x, y: active.y });
  };
  // React's delegated wheel listener is passive. A native listener allows control
  // gestures to prevent page scrolling, while viewing still permits normal scroll.
  useEffect(() => {
    const node = canvas.current; if (!node) return;
    const wheel = (event: WheelEvent) => {
      if (!stream.canControl || !stream.size) return;
      const position = videoPoint(event.clientX, event.clientY, node.getBoundingClientRect(), stream.size);
      if (!position) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1;
      const axis = (delta: number) => Math.max(-16, Math.min(16, delta * unit / 100));
      if (stream.send({ type: "scroll", ...position, dx: axis(event.deltaX), dy: axis(event.deltaY) })) event.preventDefault();
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [stream.canControl, stream.size, stream.send]);

  if (stream.phase === "unsupported") return <p role="status" className="p-4 text-sm leading-6 text-fg-muted">{t("m_2bfeb65162")}</p>;
  return <section ref={section} aria-label={t("m_ad71f982e6", [serial])} className={cx("min-w-0 text-fg", enlarged ? "fixed inset-0 z-[60] flex h-dvh flex-col gap-3 overflow-y-auto overscroll-contain bg-surface p-3 sm:p-4" : cx("space-y-3", compact ? "p-3" : "p-4"))}
    onKeyDown={event => {
      if (!enlarged || event.key !== "Tab" || !event.currentTarget.contains(event.target as Node)) return;
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')];
      const first = items[0]; const last = items.at(-1); event.stopPropagation();
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    {stream.status?.running_task_id && stream.canControl && <p role="alert" className="shrink-0 rounded-lg border border-warning/25 bg-warning-bg p-3 text-xs leading-5 text-warning-fg">{t("m_2aa093186e")}</p>}
    <div ref={screenBox} style={{ height: height.size }} className="relative min-w-0 shrink-0 overflow-hidden rounded-xl border border-border bg-surface-2">
      <canvas ref={canvas} aria-label={t("m_995c125bcf")} className={cx("block h-[calc(100%-20px)] w-full object-contain", stream.canControl ? "touch-none cursor-crosshair" : "touch-auto")}
        onPointerDown={event => touch(event, "down")} onPointerMove={event => touch(event, "move")} onPointerUp={event => touch(event, "up")}
        onPointerCancel={cancelTouch} onLostPointerCapture={cancelTouch} onContextMenu={event => { if (stream.canControl) event.preventDefault(); }} />
      {!stream.size && <p role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-fg-muted">{stream.phase === "ended" ? t("m_34c1db761b") : stream.phase === "reconnecting" ? t("m_894ceba2cd") : t("m_47831dd182")}</p>}
      <div {...height.handleProps} aria-label={t("m_a498b62c02")} title={t("m_a44fa7f327")}
        className="absolute inset-x-0 bottom-0 flex h-5 touch-none cursor-row-resize items-center justify-center border-t border-border bg-surface text-fg-muted outline-none hover:bg-accent-soft focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
        <span aria-hidden="true" className="h-1 w-10 rounded-full bg-current" />
      </div>
    </div>
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 text-xs text-fg-muted" aria-live="polite">
      <span className="inline-flex items-center gap-1.5"><StatusDot tone={stream.phase === "connected" ? "passed" : "neutral"} />{stream.phase === "connected" ? t("m_ca3372f3bc") : stream.phase === "ended" ? t("m_6eaa84e039") : t("m_1ed5386f93")}</span>
      <span>{tp("live.viewerCount", stream.status?.viewers ?? 0)}</span><span className="break-all">{t("m_faa27e9eec")} {stream.status?.controller ?? t("m_d58fa73adc")}</span>
      {stream.status?.recording && <span className="inline-flex items-center gap-1.5 text-failed-fg"><StatusDot tone="failed" />{t("m_44457015d2")}</span>}
      {!stream.canControl && <span>{t("m_005c11b79a")}</span>}
    </div>
    {stream.message && <p role="status" className="shrink-0 break-words text-xs text-warning-fg">{stream.message}</p>}
    <div className="flex shrink-0 flex-wrap items-center gap-2" aria-label={t("m_2d28e885a9")}>
      <IconButton ref={toggle} aria-label={enlarged ? t("m_dc6f39669d") : t("m_b98c80ee2b")} title={enlarged ? t("m_dc6f39669d") : t("m_b98c80ee2b")} aria-pressed={enlarged} onClick={() => { setEnlarged(!enlarged); toggle.current?.focus(); }}>{enlarged ? <Minimize2 /> : <Maximize2 />}</IconButton>
      <Button size="sm" onClick={height.reset}>{t("m_a210552e15")}</Button>
      <IconButton aria-label={t("m_8411beea5e")} title={t("m_8411beea5e")} disabled={!stream.canControl} onClick={() => stream.send({ type: "key", key: "BACK" })}><ArrowLeft /></IconButton>
      <IconButton aria-label={t("m_13a46f96e1")} title={t("m_13a46f96e1")} disabled={!stream.canControl} onClick={() => stream.send({ type: "key", key: "HOME" })}><Circle /></IconButton>
      <IconButton aria-label={t("m_c769699cf4")} title={t("m_c769699cf4")} disabled={!stream.canControl} onClick={() => stream.send({ type: "key", key: "APP_SWITCH" })}><Square /></IconButton>
      <form className="min-w-0 flex-1 basis-36" onSubmit={event => { event.preventDefault(); if (text && stream.send({ type: "text", text })) setText(""); }}>
        <Input aria-label={t("m_0be2416eb3")} placeholder={t("m_ba772dae5a")} maxLength={300} disabled={!stream.canControl} value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }} />
      </form>
    </div>
    <div className={cx("min-w-0 shrink-0", enlarged && "max-h-[min(20dvh,160px)] overflow-y-auto overscroll-contain")}><RecordingControls key={serial} serial={serial} enlarged={enlarged} canControl={stream.canControl && canWrite && control !== "never"} workspace={workspace} appPackage={appPackage} onComplete={onRecordingComplete} /></div>
  </section>;
}
