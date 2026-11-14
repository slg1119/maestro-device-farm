import { t } from "../lib/i18n";
import type { DeviceState, RunStatus } from "../api/types";
import { Badge, StatusDot, type Tone } from "./ui";

const RUN: Record<RunStatus, { label: string; tone: Tone }> = {
  queued: { label: t("m_df72a8753d"), tone: "neutral" }, running: { label: t("m_0d01d3e76a"), tone: "running" },
  passed: { label: t("m_66409b6272"), tone: "passed" }, failed: { label: t("m_732fe33ab1"), tone: "failed" },
  error: { label: t("m_3efa8afd60"), tone: "warning" }, cancelled: { label: t("m_19b2d19bc1"), tone: "neutral" },
};
const DEVICE: Record<DeviceState, { label: string; tone: Tone }> = {
  available: { label: t("m_d4bbb3d8e2"), tone: "passed" }, busy: { label: t("m_0d01d3e76a"), tone: "running" },
  reserved: { label: t("m_69692a2a38"), tone: "reserved" }, offline: { label: t("m_7e422cfc63"), tone: "neutral" },
  unhealthy: { label: t("m_96a951f890"), tone: "warning" }, disabled: { label: t("m_fc3f661f68"), tone: "neutral" },
};
export function StatusBadge({ status }: { status: RunStatus }) {
  const { label, tone } = RUN[status] ?? { label: status, tone: "neutral" };
  return <Badge tone={tone}><StatusDot tone={tone} />{label}</Badge>;
}
export function DeviceStateBadge({ state }: { state: DeviceState }) {
  const { label, tone } = DEVICE[state] ?? { label: state, tone: "neutral" };
  return <Badge tone={tone}><StatusDot tone={tone} />{label}</Badge>;
}
