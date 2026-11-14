import { t } from "../../../lib/i18n";
import { useRef, useState } from "react";
import { hitTest, type ScreenElement } from "./hierarchy";

export function SnapshotImage({ src, nodes, selected, onSelect, onList, onError }: { src: string; nodes: ScreenElement[]; selected: ScreenElement | null; onSelect(node: ScreenElement | null): void; onList(): void; onError(): void }) {
  const image = useRef<HTMLImageElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const bounds = selected?.bounds;
  return <div className="flex justify-center overflow-hidden rounded-[10px] border border-border bg-surface-2 p-2">
    <button type="button" aria-label={t("m_aab2dbb39d")} className="relative block max-w-full cursor-crosshair overflow-hidden rounded focus-visible:outline-2 focus-visible:outline-accent"
      onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onList(); } }}
      onClick={event => {
        if (event.detail === 0 && event.clientX === 0 && event.clientY === 0) { onList(); return; }
        const rect = image.current?.getBoundingClientRect();
        if (size && rect?.width && rect.height) onSelect(hitTest(nodes, (event.clientX - rect.left) * size.width / rect.width, (event.clientY - rect.top) * size.height / rect.height));
      }}>
      <img ref={image} src={src} alt={t("m_b936314600")} className="block max-h-[420px] max-w-full w-auto" draggable={false}
        onLoad={event => { const img = event.currentTarget; if (img.naturalWidth && img.naturalHeight) setSize({ width: img.naturalWidth, height: img.naturalHeight }); }} onError={onError} />
      {size && <svg data-testid="screen-bounds" aria-hidden="true" viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full overflow-hidden">
        {nodes.filter(node => node.bounds && node.key !== selected?.key).map(node => <rect key={node.key} {...node.bounds!} fill="none" vectorEffect="non-scaling-stroke" strokeDasharray="4 3" className="stroke-fg-muted" />)}
        {bounds && <rect {...bounds} data-selected="true" fill="none" strokeWidth="2" vectorEffect="non-scaling-stroke" className="stroke-accent" />}
      </svg>}
      {bounds && size && <span className="pointer-events-none absolute max-w-full truncate rounded border border-accent bg-accent-soft px-1.5 py-1 text-left font-mono text-[10px] text-accent-soft-fg" style={{ left: `${Math.max(0, Math.min(55, bounds.x / size.width * 100))}%`, top: `${Math.max(0, Math.min(90, bounds.y / size.height * 100))}%` }}>{selected?.attributes.class ?? t("m_a2314fdb82")} · {selected?.attributes["resource-id"] ?? t("m_eca8ac62cc")}</span>}
    </button>
  </div>;
}
