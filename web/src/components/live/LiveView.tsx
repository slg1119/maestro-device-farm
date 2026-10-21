import { ArrowLeft, Circle, Square } from "lucide-react";
import { type PointerEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useCanWrite } from "../Layout";
import { IconButton, Input, StatusDot, cx } from "../ui";
import { videoPoint } from "./coords";
import { useLiveStream } from "./useLiveStream";

export function LiveView({ serial, control = "auto", compact = false }: { serial: string; control?: "auto" | "never"; compact?: boolean }) {
  const canWrite = useCanWrite(); const canvas = useRef<HTMLCanvasElement>(null);
  const stream = useLiveStream({ serial, control, canWrite, canvas });
  const [text, setText] = useState("");
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
  return <section aria-label={`${serial} 실시간 화면`} className={cx("min-w-0 space-y-3 text-fg", compact ? "p-3" : "p-4")}>
    {stream.status?.running_task_id && stream.canControl && <p role="alert" className="rounded-lg border border-warning/25 bg-warning-bg p-3 text-xs leading-5 text-warning-fg">CI 테스트 실행 중 · 조작하면 결과가 달라질 수 있음</p>}
    <div className={cx("relative min-w-0 overflow-hidden rounded-xl border border-border bg-surface-2", compact ? "h-[min(50dvh,480px)]" : "h-[min(60dvh,640px)]")}>
      <canvas ref={canvas} aria-label="실시간 기기 화면" className={cx("h-full w-full object-contain", stream.canControl ? "touch-none cursor-crosshair" : "touch-auto")}
        onPointerDown={event => touch(event, "down")} onPointerMove={event => touch(event, "move")} onPointerUp={event => touch(event, "up")}
        onPointerCancel={cancelTouch} onLostPointerCapture={cancelTouch} onContextMenu={event => { if (stream.canControl) event.preventDefault(); }} />
      {!stream.size && <p role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-fg-muted">{stream.phase === "ended" ? "화면 연결 종료" : stream.phase === "reconnecting" ? "다시 연결하는 중…" : "실시간 화면에 연결하는 중…"}</p>}
    </div>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-fg-muted" aria-live="polite">
      <span className="inline-flex items-center gap-1.5"><StatusDot tone={stream.phase === "connected" ? "passed" : "neutral"} />{stream.phase === "connected" ? "연결됨" : stream.phase === "ended" ? "연결 종료" : "연결 중"}</span>
      <span>시청자 {stream.status?.viewers ?? 0}명</span><span className="break-all">조작자 {stream.status?.controller ?? "없음"}</span>
      {stream.status?.recording && <span className="inline-flex items-center gap-1.5 text-failed-fg"><StatusDot tone="failed" />녹화 중</span>}
      {!stream.canControl && <span>보기 전용</span>}
    </div>
    {stream.message && <p role="status" className="break-words text-xs text-warning-fg">{stream.message}</p>}
    <div className="flex flex-wrap items-center gap-2" aria-label="기기 조작">
      <IconButton aria-label="뒤로" title="뒤로" disabled={!stream.canControl} onClick={() => stream.send({ type: "key", key: "BACK" })}><ArrowLeft /></IconButton>
      <IconButton aria-label="홈" title="홈" disabled={!stream.canControl} onClick={() => stream.send({ type: "key", key: "HOME" })}><Circle /></IconButton>
      <IconButton aria-label="최근 앱" title="최근 앱" disabled={!stream.canControl} onClick={() => stream.send({ type: "key", key: "APP_SWITCH" })}><Square /></IconButton>
      <form className="min-w-0 flex-1 basis-36" onSubmit={event => { event.preventDefault(); if (text && stream.send({ type: "text", text })) setText(""); }}>
        <Input aria-label="기기에 텍스트 입력" placeholder="텍스트 입력 후 Enter" maxLength={300} disabled={!stream.canControl} value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }} />
      </form>
    </div>
  </section>;
}
