import { type KeyboardEvent, type ReactNode, useId, useRef } from "react";

import { cx, toneBackground, type Tone } from "./primitives";

export interface Choice<T extends string = string> { value: T; label: ReactNode; disabled?: boolean }
interface ChoiceProps<T extends string> {
  options: readonly Choice<T>[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
  className?: string;
}

function Choices<T extends string>({ options, value, onChange, label, className, tabs }: ChoiceProps<T> & { tabs: boolean }) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const firstEnabled = options.findIndex((option) => !option.disabled);
  const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled);
  const activeIndex = selectedIndex < 0 ? firstEnabled : selectedIndex;
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const enabled = options.map((option, i) => option.disabled ? -1 : i).filter((i) => i >= 0);
    const current = enabled.indexOf(index);
    let next: number | undefined;
    if (event.key === "Home") next = enabled[0];
    else if (event.key === "End") next = enabled.at(-1);
    else if (event.key === "ArrowRight" || event.key === "ArrowDown") next = enabled[(current + 1) % enabled.length];
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = enabled[(current - 1 + enabled.length) % enabled.length];
    if (next === undefined) return;
    event.preventDefault();
    const option = options[next];
    if (option) { onChange(option.value); buttons.current[next]?.focus(); }
  };
  return <div role={tabs ? "tablist" : "radiogroup"} aria-label={label} className={cx(
    "flex max-w-full items-center gap-1 overflow-x-auto",
    tabs ? "border-b border-border" : "w-fit rounded-lg border border-border bg-surface-2 p-1", className,
  )}>
    {options.map((option, index) => <button key={option.value} type="button" id={`${id}-${option.value}`}
      ref={(node) => { buttons.current[index] = node; }} role={tabs ? "tab" : "radio"}
      aria-selected={tabs ? option.value === value : undefined} aria-checked={!tabs ? option.value === value : undefined}
      tabIndex={index === activeIndex ? 0 : -1} disabled={option.disabled} onClick={() => onChange(option.value)}
      onKeyDown={(event) => onKey(event, index)} className={cx(
        "shrink-0 px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset disabled:opacity-50 max-md:min-h-11",
        tabs ? "border-b-2" : "rounded-md",
        option.value === value ? (tabs ? "border-accent text-accent" : "bg-accent-soft text-accent-soft-fg") : "border-transparent text-fg-muted hover:text-fg",
      )}>{option.label}</button>)}
  </div>;
}

export function Tabs<T extends string>(props: ChoiceProps<T>) { return <Choices {...props} tabs />; }
export function Segmented<T extends string>(props: ChoiceProps<T>) { return <Choices {...props} tabs={false} />; }

export function StatusDot({ tone = "neutral", className }: { tone?: Tone; className?: string }) {
  return <span aria-hidden="true" className={cx("inline-block size-1.5 shrink-0 rounded-full", toneBackground[tone], className)} />;
}

export function ProgressBar({ segments, label, total, className }: {
  segments: readonly { value: number; tone: Tone }[];
  label: string;
  total?: number;
  className?: string;
}) {
  const values = segments.map(({ value }) => Number.isFinite(value) ? Math.max(0, value) : 0);
  const sum = values.reduce((a, b) => a + b, 0);
  const maximum = Math.max(sum, total ?? sum, 0);
  return <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuenow={sum} aria-valuemax={maximum || 1}
    className={cx("flex h-1.5 w-full overflow-hidden rounded-full bg-neutral-bg", className)}>
    {segments.map(({ tone }, index) => <span key={index} aria-hidden="true" className={toneBackground[tone]}
      style={{ width: `${maximum ? values[index]! / maximum * 100 : 0}%` }} />)}
  </div>;
}
