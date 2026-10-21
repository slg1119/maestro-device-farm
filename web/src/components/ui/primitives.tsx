import { type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

import { ApiError } from "../../api/client";
export type Tone = "passed" | "failed" | "running" | "warning" | "neutral" | "reserved" | "ai";
export const toneBackground: Record<Tone, string> = {
  passed: "bg-passed", failed: "bg-failed", running: "bg-running", warning: "bg-warning", neutral: "bg-neutral", reserved: "bg-reserved", ai: "bg-ai",
};
export const toneBadge: Record<Tone, string> = {
  passed: "bg-passed-bg text-passed-fg", failed: "bg-failed-bg text-failed-fg", running: "bg-running-bg text-running-fg",
  warning: "bg-warning-bg text-warning-fg", neutral: "bg-neutral-bg text-neutral-fg", reserved: "bg-reserved-bg text-reserved-fg", ai: "bg-ai-bg text-ai-fg",
};

export function cx(...classes: (string | false | null | undefined)[]): string { return classes.filter(Boolean).join(" "); }
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "ai";
const buttonStyle: Record<ButtonVariant, string> = {
  primary: "border-transparent bg-accent text-white hover:bg-accent-hover",
  secondary: "border-border-strong bg-surface text-fg hover:bg-surface-2",
  ghost: "border-transparent text-fg-muted hover:bg-neutral-bg hover:text-fg",
  danger: "border-transparent bg-failed text-white hover:brightness-95",
  ai: "border-transparent bg-ai-bg text-ai-fg hover:bg-ai hover:text-white",
};
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md"; icon?: ReactNode; ref?: Ref<HTMLButtonElement> };
export function Button({ variant = "secondary", size = "md", icon, children, className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cx(
    "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-45 max-md:min-h-11",
    size === "sm" ? "min-h-8 px-2.5 text-xs" : "min-h-9 px-3 text-sm", buttonStyle[variant], className,
  )} {...props}>{icon && <span aria-hidden="true" className="inline-flex [&>svg]:size-4 [&>svg]:stroke-[1.8]">{icon}</span>}{children}</button>;
}
export function IconButton({ children, className, variant = "ghost", size = "sm", icon, type = "button", ...props }: ButtonProps & { "aria-label": string }) {
  return <button type={type} {...props} className={cx(
    "inline-flex shrink-0 items-center justify-center rounded-lg border p-0 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-45 max-md:size-11 [&>svg]:size-[18px] [&>svg]:shrink-0 [&>svg]:stroke-[1.8]",
    size === "sm" ? "size-8" : "size-9", buttonStyle[variant], className,
  )}>{icon ?? children}</button>;
}
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("rounded-[10px] border border-border bg-surface", className)} {...props} />;
}
export function PageHeader({ title, description, actions, children }: { title: string; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
    <div className="min-w-0"><h1 className="text-[22px] leading-8 font-bold text-fg">{title}</h1>
      {(description || children) && <div className="mt-1 text-sm text-fg-muted">{description}{children}</div>}</div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>;
}
const fieldStyle = "min-h-9 w-full min-w-0 rounded-lg border border-border-strong bg-surface-2 px-2.5 py-1.5 text-sm text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-50 max-md:min-h-11";
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) { return <input className={cx(fieldStyle, className)} {...props} />; }
export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) { return <select className={cx(fieldStyle, className)} {...props} />; }
export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea className={cx(fieldStyle, "min-h-24 font-mono", className)} {...props} />; }
export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return <label className="block min-w-0"><span className="mb-1.5 block text-xs font-medium text-fg-muted">{label}</span>{children}
    {hint && <span className="mt-1.5 block text-xs text-fg-subtle">{hint}</span>}</label>;
}
export function Checkbox({ className, label, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label?: ReactNode }) {
  const input = <input {...props} type="checkbox" className={cx("size-4 shrink-0 rounded border-border-strong accent-accent focus-visible:outline-2 focus-visible:outline-accent", className)} />;
  return label ? <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-sm text-fg max-md:min-h-11">{input}{label}</label> : input;
}
export function Badge({ className, children, tone = "neutral" }: { className?: string; children: ReactNode; tone?: Tone }) {
  return <span className={cx("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs leading-5 font-medium", toneBadge[tone], className)}>{children}</span>;
}
export function Kbd({ className, ...props }: HTMLAttributes<HTMLElement>) { return <kbd className={cx("rounded border border-border-strong bg-surface-2 px-1 py-0.5 font-mono text-[11px] text-fg-muted", className)} {...props} />; }
export function Loading({ label = "불러오는 중…" }: { label?: string }) { return <div role="status" className="py-8 text-center text-sm text-fg-muted">{label}</div>; }
export function Empty({ children }: { children: ReactNode }) { return <div className="py-8 text-center text-sm text-fg-muted">{children}</div>; }
export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof ApiError ? `${error.message} (${error.code})` : error instanceof Error ? error.message : String(error);
  return <div role="alert" className="rounded-lg border border-failed/25 bg-failed-bg px-3 py-2 text-sm text-failed-fg">{message}</div>;
}
