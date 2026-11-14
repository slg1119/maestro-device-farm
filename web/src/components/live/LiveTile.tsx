import { t } from "../../lib/i18n";
import { useEffect, useRef, useState } from "react";

import type { Device } from "../../api/types";
import { DeviceStateBadge } from "../StatusBadge";
import { Badge } from "../ui";
import type { StreamConfig } from "./decoder";
import { useLiveStream } from "./useLiveStream";

/** Mount only while visible: unmounting releases the socket, retry timers and decoder. */
function TileStream({ serial, onSize }: { serial: string; onSize: (size: StreamConfig) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // A board preview has no ticket, controller role, or input handlers.
  const stream = useLiveStream({ serial, control: "never", canWrite: false, canvas });
  useEffect(() => { if (stream.size) onSize(stream.size); }, [stream.size, onSize]);
  const message = stream.phase === "unsupported" ? t("m_b5c1a97370")
    : stream.message || (stream.phase === "ended" ? t("m_34c1db761b") : stream.phase === "reconnecting" ? t("m_894ceba2cd") : t("m_47831dd182"));

  return <>
    <canvas ref={canvas} aria-label={t("m_69e74b1fb9", [serial])} className="absolute inset-0 h-full w-full object-contain" />
    {(!stream.size || stream.message) && <span role="status" className="absolute inset-0 flex items-center justify-center bg-surface-2/90 p-4 text-center text-xs leading-5 text-fg-muted">{message}</span>}
  </>;
}

export function LiveTile({ device, paused, pauseReason = t("m_2c992a873f"), onOpen }: {
  device: Device; paused: boolean; pauseReason?: string; onOpen: () => void;
}) {
  const root = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [size, setSize] = useState<StreamConfig | null>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.target === root.current) setVisible(entry.isIntersecting);
    });
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const offline = device.state === "offline";
  const active = !offline && !paused && visible;

  return <article ref={root} aria-label={`${device.model} ${device.serial}`} className="min-w-0 overflow-hidden rounded-[10px] border border-border bg-surface">
    <button type="button" aria-label={t("m_6e3299fdb4", [device.model, device.serial])} disabled={offline} onClick={onOpen}
      className="block w-full min-w-0 cursor-pointer text-left outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset disabled:cursor-default">
      <span className="flex min-w-0 flex-col gap-2 p-3">
        <span className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 break-words text-sm font-semibold text-fg">{device.model || t("m_be3841ab14")}</span><DeviceStateBadge state={device.state} /></span>
        <span className="break-all font-mono text-[11px] text-fg-subtle">{device.serial}</span>
      </span>
      <span aria-label={t("m_415ef83496", [device.serial])} className="relative block w-full overflow-hidden border-y border-border bg-surface-2"
        style={{ aspectRatio: size ? `${size.width} / ${size.height}` : "9 / 19.5" }}>
        {active ? <TileStream serial={device.serial} onSize={setSize} />
          : <span className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-fg-muted">{offline ? t("m_7e422cfc63") : paused ? pauseReason : t("m_0a3ef3e9e6")}</span>}
      </span>
      <span className="flex min-w-0 flex-col gap-2 p-3 text-xs text-fg-muted">
        <span className="flex flex-wrap items-center justify-between gap-2"><Badge>{t("m_005c11b79a")}</Badge><span>{t("m_1cc7d22847")}</span></span>
        {device.current_task_id ? <span className="break-all">{t("m_80e16562a0")} <span className="font-mono">{device.current_task_id}</span></span> : <span>{t("m_1c738e4094")}</span>}
      </span>
    </button>
  </article>;
}
