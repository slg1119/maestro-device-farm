import { t } from "../../lib/i18n";
import type { Device, RunDetail } from "../../api/types";
import { StatusBadge } from "../../components/StatusBadge";
import { Badge, Empty, StatusDot, cx } from "../../components/ui";
import { formatDuration } from "../../lib/format";
import { buildMatrix, type MatrixCell } from "./grid";
import { TaskLive } from "./TaskLive";

const CELL: Record<MatrixCell["status"], { label: string; color: string }> = {
  queued: { label: t("m_df72a8753d"), color: "bg-neutral-bg" },
  running: { label: t("m_0d01d3e76a"), color: "bg-running-bg" },
  passed: { label: t("m_66409b6272"), color: "bg-passed-bg" },
  failed: { label: t("m_732fe33ab1"), color: "bg-failed-bg" },
  error: { label: t("m_3efa8afd60"), color: "bg-warning-bg" },
  cancelled: { label: t("m_19b2d19bc1"), color: "bg-neutral-bg" },
  skipped: { label: t("m_0d8285629e"), color: "bg-neutral-bg" },
};

export function deviceLabel(serial: string | null, devices: Device[]): string {
  if (!serial) return t("m_f85265eb7d");
  const model = devices.find((device) => device.serial === serial)?.model;
  return model ? `${model} (${serial})` : serial;
}

export function MatrixGrid({ run, devices, selectedId, selectedFlow, onSelect }: {
  run: RunDetail;
  devices: Device[];
  selectedId: string | null;
  selectedFlow?: string | null;
  onSelect: (taskId: string, flow: string) => void;
}) {
  const matrix = buildMatrix(run);
  if (!matrix.columns.length) return <Empty>{t("m_b4d3ba7a4c")}</Empty>;
  return (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{t("m_6b9038c4bb")}</caption>
        <thead className="border-b border-border bg-surface-2 text-xs text-fg-muted">
          <tr>
            <th scope="col" className="px-4 py-3">{t("e_d8f7e9c783")}</th>
            {matrix.columns.map((column) => (
              <th scope="col" key={column.taskId} aria-label={deviceLabel(column.serial, devices)} className="min-w-44 px-4 py-3">{deviceLabel(column.serial, devices)}<TaskLive task={run.tasks.find(task => task.id === column.taskId)!} /></th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {matrix.flows.map((flow) => (
            <tr key={flow}>
              <th scope="row" className="max-w-64 break-words px-4 py-3 font-medium">{flow}</th>
              {matrix.columns.map((column) => {
                const cell = matrix.cell(flow, column.taskId);
                const style = CELL[cell.status];
                const selected = selectedId === column.taskId && (selectedFlow === flow || (!selectedFlow && flow === matrix.flows[0]));
                return (
                  <td key={column.taskId} className="p-1">
                    <button
                      type="button"
                      aria-label={`${flow} · ${deviceLabel(column.serial, devices)} · ${style.label}`}
                      aria-pressed={selected}
                      title={cell.failure}
                      onClick={() => onSelect(column.taskId, flow)}
                      className={cx("flex min-h-11 w-full items-center justify-center gap-2 rounded p-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent", style.color, selected && "ring-2 ring-inset ring-accent")}
                    >
                      {cell.status === "skipped" ? <Badge><StatusDot />{t("m_0d8285629e")}</Badge> : <StatusBadge status={cell.status} />}
                      {cell.durationMs !== undefined && <span className="text-xs text-fg-subtle">{formatDuration(cell.durationMs)}</span>}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
