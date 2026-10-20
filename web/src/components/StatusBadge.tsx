import type { DeviceState, RunStatus } from "../api/types";
import { Badge } from "./ui";

const RUN: Record<RunStatus, { label: string; className: string }> = {
  queued: { label: "대기", className: "bg-slate-100 text-slate-700" },
  running: { label: "실행 중", className: "bg-blue-100 text-blue-800" },
  passed: { label: "통과", className: "bg-emerald-100 text-emerald-800" },
  failed: { label: "실패", className: "bg-red-100 text-red-800" },
  error: { label: "오류", className: "bg-amber-100 text-amber-800" },
  cancelled: { label: "취소", className: "bg-slate-200 text-slate-600" },
};

const DEVICE: Record<DeviceState, { label: string; className: string }> = {
  available: { label: "사용 가능", className: "bg-emerald-100 text-emerald-800" },
  busy: { label: "실행 중", className: "bg-blue-100 text-blue-800" },
  reserved: { label: "예약됨", className: "bg-violet-100 text-violet-800" },
  offline: { label: "오프라인", className: "bg-slate-200 text-slate-600" },
  unhealthy: { label: "점검 필요", className: "bg-amber-100 text-amber-800" },
  disabled: { label: "정비 모드", className: "bg-slate-300 text-slate-700" },
};

/** Run and task statuses share one palette. */
export function StatusBadge({ status }: { status: RunStatus }) {
  const style = RUN[status] ?? { label: status, className: undefined };
  return <Badge className={style.className}>{style.label}</Badge>;
}

export function DeviceStateBadge({ state }: { state: DeviceState }) {
  const style = DEVICE[state] ?? { label: state, className: undefined };
  return <Badge className={style.className}>{style.label}</Badge>;
}
