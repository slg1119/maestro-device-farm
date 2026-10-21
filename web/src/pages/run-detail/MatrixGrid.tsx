import type { Device, RunDetail } from "../../api/types";
import { StatusBadge } from "../../components/StatusBadge";
import { Badge, Empty, StatusDot, cx } from "../../components/ui";
import { formatDuration } from "../../lib/format";
import { buildMatrix, type MatrixCell } from "./grid";
import { TaskLive } from "./TaskLive";

const CELL: Record<MatrixCell["status"], { label: string; color: string }> = {
  queued: { label: "대기", color: "bg-neutral-bg" },
  running: { label: "실행 중", color: "bg-running-bg" },
  passed: { label: "통과", color: "bg-passed-bg" },
  failed: { label: "실패", color: "bg-failed-bg" },
  error: { label: "오류", color: "bg-warning-bg" },
  cancelled: { label: "취소", color: "bg-neutral-bg" },
  skipped: { label: "건너뜀", color: "bg-neutral-bg" },
};

export function deviceLabel(serial: string | null, devices: Device[]): string {
  if (!serial) return "기기 배정 대기";
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
  if (!matrix.columns.length) return <Empty>task가 없습니다.</Empty>;
  return (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">기기별 flow 실행 결과</caption>
        <thead className="border-b border-border bg-surface-2 text-xs text-fg-muted">
          <tr>
            <th scope="col" className="px-4 py-3">flow</th>
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
                      {cell.status === "skipped" ? <Badge><StatusDot />건너뜀</Badge> : <StatusBadge status={cell.status} />}
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
