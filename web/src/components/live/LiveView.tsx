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

  if (stream.phase === "unsupported") return <p role="status" className="p-4 text-sm leading-6 text-fg-muted">이 브라우저는 실시간 화면을 지원하지 않습니다 (Chrome/Edge 최신 버전 권장)</p>;
  return <section ref={section} aria-label={`${serial} 실시간 화면`} className={cx("min-w-0 text-fg", enlarged ? "fixed inset-0 z-[60] flex h-dvh flex-col gap-3 overflow-y-auto overscroll-contain bg-surface p-3 sm:p-4" : cx("space-y-3", compact ? "p-3" : "p-4"))}
    onKeyDown={event => {
      if (!enlarged || event.key !== "Tab" || !event.currentTarget.contains(event.target as Node)) return;
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')];
      const first = items[0]; const last = items.at(-1); event.stopPropagation();
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    {stream.status?.running_task_id && stream.canControl && <p role="alert" className="shrink-0 rounded-lg border border-warning/25 bg-warning-bg p-3 text-xs leading-5 text-warning-fg">테스트 실행 중 · 조작하면 결과가 달라질 수 있음</p>}
    <div ref={screenBox} style={{ height: height.size }} className="relative min-w-0 shrink-0 overflow-hidden rounded-xl border border-border bg-surface-2">
      <canvas ref={canvas} aria-label="실시간 기기 화면" className={cx("block h-[calc(100%-20px)] w-full object-contain", stream.canControl ? "touch-none cursor-crosshair" : "touch-auto")}
        onPointerDown={event => touch(event, "down")} onPointerMove={event => touch(event, "move")} onPointerUp={event => touch(event, "up")}
        onPointerCancel={cancelTouch} onLostPointerCapture={cancelTouch} onContextMenu={event => { if (stream.canControl) event.preventDefault(); }} />
      {!stream.size && <p role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-fg-muted">{stream.phase === "ended" ? "화면 연결 종료" : stream.phase === "reconnecting" ? "다시 연결하는 중…" : "실시간 화면에 연결하는 중…"}</p>}
      <div {...height.handleProps} aria-label="화면 크기 조절" title="드래그 또는 위아래 방향키로 조절 · 두 번 누르면 맞춤"
        className="absolute inset-x-0 bottom-0 flex h-5 touch-none cursor-row-resize items-center justify-center border-t border-border bg-surface text-fg-muted outline-none hover:bg-accent-soft focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
        <span aria-hidden="true" className="h-1 w-10 rounded-full bg-current" />
      </div>
    </div>
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 text-xs text-fg-muted" aria-live="polite">
      <span className="inline-flex items-center gap-1.5"><StatusDot tone={stream.phase === "connected" ? "passed" : "neutral"} />{stream.phase === "connected" ? "연결됨" : stream.phase === "ended" ? "연결 종료" : "연결 중"}</span>
      <span>시청자 {stream.status?.viewers ?? 0}명</span><span className="break-all">조작자 {stream.status?.controller ?? "없음"}</span>
      {stream.status?.recording && <span className="inline-flex items-center gap-1.5 text-failed-fg"><StatusDot tone="failed" />녹화 중</span>}
      {!stream.canControl && <span>보기 전용</span>}
    </div>
    {stream.message && <p role="status" className="shrink-0 break-words text-xs text-warning-fg">{stream.message}</p>}
    <div className="flex shrink-0 flex-wrap items-center gap-2" aria-label="기기 조작">
      <IconButton ref={toggle} aria-label={enlarged ? "작게 보기" : "크게 보기"} title={enlarged ? "작게 보기" : "크게 보기"} aria-pressed={enlarged} onClick={() => { setEnlarged(!enlarged); toggle.current?.focus(); }}>{enlarged ? <Minimize2 /> : <Maximize2 />}</IconButton>
      <Button size="sm" onClick={height.reset}>맞춤</Button>
      <IconButton aria-label="뒤로" title="뒤로" disabled={!stream.canControl} onClick={() => stream.send({ type: "key", key: "BACK" })}><ArrowLeft /></IconButton>
      <IconButton aria-label="홈" title="홈" disabled={!stream.canControl} onClick={() => stream.send({ type: "key", key: "HOME" })}><Circle /></IconButton>
      <IconButton aria-label="최근 앱" title="최근 앱" disabled={!stream.canControl} onClick={() => stream.send({ type: "key", key: "APP_SWITCH" })}><Square /></IconButton>
      <form className="min-w-0 flex-1 basis-36" onSubmit={event => { event.preventDefault(); if (text && stream.send({ type: "text", text })) setText(""); }}>
        <Input aria-label="기기에 텍스트 입력" placeholder="텍스트 입력 후 Enter" maxLength={300} disabled={!stream.canControl} value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }} />
      </form>
    </div>
    <div className={cx("min-w-0 shrink-0", enlarged && "max-h-[min(20dvh,160px)] overflow-y-auto overscroll-contain")}><RecordingControls key={serial} serial={serial} enlarged={enlarged} canControl={stream.canControl && canWrite && control !== "never"} workspace={workspace} appPackage={appPackage} onComplete={onRecordingComplete} /></div>
  </section>;
}
