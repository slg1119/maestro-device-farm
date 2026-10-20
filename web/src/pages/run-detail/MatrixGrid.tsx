import type { Device, RunDetail } from "../../api/types";
import { StatusBadge } from "../../components/StatusBadge";
import { Badge, Empty, cx } from "../../components/ui";
import { formatDuration } from "../../lib/format";
import { buildMatrix, type MatrixCell } from "./grid";

const CELL: Record<MatrixCell["status"], { label: string; color: string }> = {
  queued: { label: "대기", color: "bg-slate-50" },
  running: { label: "실행 중", color: "bg-blue-50" },
  passed: { label: "통과", color: "bg-emerald-50" },
  failed: { label: "실패", color: "bg-red-50" },
  error: { label: "오류", color: "bg-amber-50" },
  cancelled: { label: "취소", color: "bg-slate-100" },
  skipped: { label: "건너뜀", color: "bg-slate-50" },
};

export function deviceLabel(serial: string | null, devices: Device[]): string {
  if (!serial) return "기기 배정 대기";
  const model = devices.find((device) => device.serial === serial)?.model;
  return model ? `${model} (${serial})` : serial;
}

export function MatrixGrid({ run, devices, selectedId, onSelect }: {
  run: RunDetail;
  devices: Device[];
  selectedId: string | null;
  onSelect: (taskId: string) => void;
}) {
  const matrix = buildMatrix(run);
  if (!matrix.columns.length) return <Empty>task가 없습니다.</Empty>;
  return (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">기기별 flow 실행 결과</caption>
        <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600">
          <tr>
            <th scope="col" className="px-4 py-3">flow</th>
            {matrix.columns.map((column) => (
              <th scope="col" key={column.taskId} className="min-w-44 px-4 py-3">{deviceLabel(column.serial, devices)}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {matrix.flows.map((flow) => (
            <tr key={flow}>
              <th scope="row" className="max-w-64 break-words px-4 py-3 font-medium">{flow}</th>
              {matrix.columns.map((column) => {
                const cell = matrix.cell(flow, column.taskId);
                const style = CELL[cell.status];
                return (
                  <td key={column.taskId} className="p-1">
                    <button
                      type="button"
                      aria-label={`${flow} · ${deviceLabel(column.serial, devices)} · ${style.label}`}
                      aria-pressed={selectedId === column.taskId}
                      title={cell.failure}
                      onClick={() => onSelect(column.taskId)}
                      className={cx("flex min-h-11 w-full items-center justify-center gap-2 rounded p-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-700", style.color, selectedId === column.taskId && "ring-2 ring-inset ring-slate-500")}
                    >
                      {cell.status === "skipped" ? <Badge>건너뜀</Badge> : <StatusBadge status={cell.status} />}
                      {cell.durationMs !== undefined && <span className="text-xs text-slate-500">{formatDuration(cell.durationMs)}</span>}
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
