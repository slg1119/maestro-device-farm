import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button, cx, IconButton } from "./primitives";

const focusable = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]';
let openDialogs = 0; let bodyOverflow = "";
function useDialog(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    if (openDialogs === 0) { bodyOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; }
    openDialogs += 1;
    const root = ref.current;
    (root?.querySelector<HTMLElement>(focusable) ?? root)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close.current(); }
      if (event.key !== "Tab" || !root) return;
      const items = [...root.querySelectorAll<HTMLElement>(focusable)];
      const first = items[0]; const last = items.at(-1);
      if (!first) { event.preventDefault(); root.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey); openDialogs -= 1;
      if (openDialogs === 0) document.body.style.overflow = bodyOverflow;
      before?.focus();
    };
  }, []);
  return ref;
}
interface DialogProps { title: string; onClose: () => void; children: ReactNode }
const modalWidth = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-3xl", xl: "max-w-6xl" };
export function Modal({ title, onClose, children, wide, size = wide ? "lg" : "md", elevated = false }: DialogProps & { wide?: boolean; size?: keyof typeof modalWidth; elevated?: boolean }) {
  const ref = useDialog(onClose);
  return createPortal(<div className={cx("fixed inset-0 flex items-center justify-center bg-black/40 p-4", elevated ? "z-[70]" : "z-50")}
    onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={cx("flex max-h-[calc(100dvh-32px)] w-full min-w-0 flex-col rounded-xl border border-border bg-surface text-fg shadow-xl outline-none", modalWidth[size])}>
      <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3"><h2 className="text-sm font-semibold">{title}</h2><IconButton aria-label="닫기" onClick={onClose}><X /></IconButton></div>
      <div className="min-h-0 overflow-y-auto p-5">{children}</div>
    </div>
  </div>, document.body);
}
export function Drawer({ title, onClose, children, side = "right", className }: DialogProps & { side?: "left" | "right"; className?: string }) {
  const ref = useDialog(onClose);
  return createPortal(<div className={cx("fixed inset-0 z-50 flex bg-black/40", side === "right" ? "justify-end" : "justify-start")}
    onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={cx("flex h-dvh w-96 max-w-[calc(100vw-32px)] flex-col border border-border bg-surface text-fg shadow-xl outline-none", className)}>
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3"><h2 className="text-sm font-semibold">{title}</h2><IconButton aria-label="닫기" onClick={onClose}><X /></IconButton></div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </div>
  </div>, document.body);
}
export interface MenuItem { label: ReactNode; onClick: () => void; disabled?: boolean }
export function Menu({ label, items, icon }: { label: string; items: readonly MenuItem[]; icon?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);
  return <div ref={root} className="relative inline-block" onKeyDown={(event) => {
    if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (!open) { setOpen(true); return; }
    const choices = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const index = choices.indexOf(document.activeElement as HTMLButtonElement);
    choices[(index + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length]?.focus();
  }}>
    <Button ref={trigger} aria-haspopup="menu" aria-expanded={open} icon={icon} onClick={() => setOpen(!open)}>{label}</Button>
    {open && <div role="menu" aria-label={label} className="absolute right-0 z-40 mt-1 min-w-40 rounded-lg border border-border bg-surface p-1 shadow-lg">
      {items.map((item, index) => <button key={index} type="button" role="menuitem" disabled={item.disabled}
        className="block min-h-8 w-full rounded-md px-3 py-1.5 text-left text-sm text-fg hover:bg-neutral-bg focus:bg-accent-soft focus:outline-none disabled:opacity-50 max-md:min-h-11"
        onClick={() => { item.onClick(); setOpen(false); trigger.current?.focus(); }}>{item.label}</button>)}
    </div>}
  </div>;
}
