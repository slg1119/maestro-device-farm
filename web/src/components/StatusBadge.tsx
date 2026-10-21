import type { DeviceState, RunStatus } from "../api/types";
import { Badge, StatusDot, type Tone } from "./ui";

const RUN: Record<RunStatus, { label: string; tone: Tone }> = {
  queued: { label: "대기", tone: "neutral" }, running: { label: "실행 중", tone: "running" },
  passed: { label: "통과", tone: "passed" }, failed: { label: "실패", tone: "failed" },
  error: { label: "오류", tone: "warning" }, cancelled: { label: "취소", tone: "neutral" },
};
const DEVICE: Record<DeviceState, { label: string; tone: Tone }> = {
  available: { label: "사용 가능", tone: "passed" }, busy: { label: "실행 중", tone: "running" },
  reserved: { label: "예약됨", tone: "reserved" }, offline: { label: "오프라인", tone: "neutral" },
  unhealthy: { label: "점검 필요", tone: "warning" }, disabled: { label: "정비 모드", tone: "neutral" },
};
export function StatusBadge({ status }: { status: RunStatus }) {
  const { label, tone } = RUN[status] ?? { label: status, tone: "neutral" };
  return <Badge tone={tone}><StatusDot tone={tone} />{label}</Badge>;
}
export function DeviceStateBadge({ state }: { state: DeviceState }) {
  const { label, tone } = DEVICE[state] ?? { label: state, tone: "neutral" };
  return <Badge tone={tone}><StatusDot tone={tone} />{label}</Badge>;
}
