import { useEffect, useRef } from "react";
export function ResizeHandle({ label, value, min, max, reverse, onChange }: { label: string; value: number; min: number; max: number; reverse?: boolean; onChange(v: number): void }) {
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  const adjust = (v: number) => onChange(Math.min(max, Math.max(min, v)));
  return <div role="separator" aria-label={label} aria-orientation="vertical" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} tabIndex={0}
    className="hidden w-1 shrink-0 cursor-col-resize bg-border outline-none hover:bg-accent focus:bg-accent md:block"
    onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); adjust(value + (event.key === "ArrowRight" ? 10 : -10) * (reverse ? -1 : 1)); } }}
    onPointerDown={event => { event.preventDefault(); cleanup.current?.(); const start = event.clientX; const move = (e: PointerEvent) => adjust(value + (e.clientX - start) * (reverse ? -1 : 1)); const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); window.removeEventListener("pointercancel", stop); }; cleanup.current = stop; window.addEventListener("pointermove", move); window.addEventListener("pointerup", stop); window.addEventListener("pointercancel", stop); }} />;
}
