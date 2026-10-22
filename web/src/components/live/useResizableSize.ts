import { type HTMLAttributes, type PointerEvent, useEffect, useLayoutEffect, useRef, useState } from "react";

export const LIVE_DRAWER_STORAGE_KEY = "farm.live.drawer-width";
export const LIVE_HEIGHT_STORAGE_KEYS = {
  normal: "farm.live.height.normal", compact: "farm.live.height.compact", enlarged: "farm.live.height.enlarged",
};

function readSize(key?: string) {
  try {
    const stored = key ? window.localStorage.getItem(key) : null;
    const value = stored === null || stored.trim() === "" ? NaN : Number(stored);
    return Number.isFinite(value) ? value : null;
  } catch { return null; }
}

export function useViewportSize() {
  const measure = () => ({ width: window.innerWidth, height: window.visualViewport?.height ?? window.innerHeight });
  const [viewport, setViewport] = useState(measure);
  useEffect(() => {
    const resize = () => setViewport(measure());
    window.addEventListener("resize", resize); window.visualViewport?.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); window.visualViewport?.removeEventListener("resize", resize); };
  }, []);
  return viewport;
}

/** Layout-only state: callers keep their canvas, stream and children mounted. */
export function useResizableSize({ storageKey, defaultSize, min, max, axis, direction = 1 }: {
  storageKey?: string; defaultSize: number; min: number; max: number; axis: "x" | "y"; direction?: 1 | -1;
}) {
  const maximum = Math.max(0, Math.floor(max)); const minimum = Math.min(min, maximum);
  const clamp = (value: number) => Math.round(Math.max(minimum, Math.min(maximum, value)));
  const [saved, setSaved] = useState(() => ({ key: storageKey, value: readSize(storageKey) }));
  const preference = saved.key === storageKey ? saved.value : readSize(storageKey);
  const size = clamp(preference ?? defaultSize);
  const drag = useRef<{ id: number; start: number; size: number } | null>(null);
  useLayoutEffect(() => {
    drag.current = null;
    setSaved(previous => {
      const value = previous.key === storageKey ? previous.value : readSize(storageKey);
      const next = value === null ? null : clamp(value);
      return previous.key === storageKey && previous.value === next ? previous : { key: storageKey, value: next };
    });
  }, [storageKey, minimum, maximum]);
  useEffect(() => {
    if (!storageKey || preference === null) return;
    try { window.localStorage.setItem(storageKey, String(size)); } catch { /* Storage can be blocked. */ }
  }, [storageKey, preference, size]);
  const change = (value: number) => setSaved({ key: storageKey, value: clamp(value) });
  const reset = () => {
    drag.current = null; setSaved({ key: storageKey, value: null });
    try { if (storageKey) window.localStorage.removeItem(storageKey); } catch { /* Fit still works without storage. */ }
  };
  const stop = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation(); drag.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const handleProps: HTMLAttributes<HTMLDivElement> = {
    role: "separator", tabIndex: 0, "aria-orientation": axis === "y" ? "horizontal" : "vertical",
    "aria-valuemin": minimum, "aria-valuemax": maximum, "aria-valuenow": size, "aria-valuetext": `${size}px`,
    onPointerDown: event => {
      if (event.button !== 0 || drag.current) return;
      event.preventDefault(); event.stopPropagation(); event.currentTarget.focus();
      drag.current = { id: event.pointerId, start: axis === "y" ? event.clientY : event.clientX, size };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerMove: event => {
      const active = drag.current; if (!active || active.id !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      change(active.size + ((axis === "y" ? event.clientY : event.clientX) - active.start) * direction);
    },
    onPointerUp: stop, onPointerCancel: stop, onLostPointerCapture: () => { drag.current = null; },
    onDoubleClick: event => { event.preventDefault(); event.stopPropagation(); reset(); },
    onKeyDown: event => {
      const decrease = axis === "y" ? "ArrowUp" : "ArrowLeft"; const increase = axis === "y" ? "ArrowDown" : "ArrowRight";
      if (![decrease, increase, "Home", "End"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      change(event.key === "Home" ? minimum : event.key === "End" ? maximum : size + (event.key === increase ? 20 : -20) * direction);
    },
  };
  return { size, reset, handleProps };
}
