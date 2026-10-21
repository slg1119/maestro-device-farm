import type { Device, Task } from "../../api/types";
import { StatusBadge } from "../../components/StatusBadge";
import { Empty, cx } from "../../components/ui";
import { elapsed } from "../../lib/format";
import { deviceLabel } from "./MatrixGrid";

export function TaskList({ tasks, devices, selectedId, onSelect }: {
  tasks: Task[];
  devices: Device[];
  selectedId: string | null;
  onSelect: (taskId: string) => void;
}) {
  if (!tasks.length) return <Empty>task가 없습니다.</Empty>;
  return (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">분할 실행 task 목록</caption>
        <thead className="border-b border-border bg-surface-2 text-xs text-fg-muted">
          <tr>{["순서", "flow", "기기", "상태", "시도", "오류", "소요 시간"].map((label) => <th scope="col" key={label} className="whitespace-nowrap px-4 py-3">{label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">
          {[...tasks].sort((a, b) => a.seq - b.seq).map((task) => {
            const error = [task.error_code, task.error_message].filter(Boolean).join(": ");
            return (
              <tr
                key={task.id}
                tabIndex={0}
                aria-selected={selectedId === task.id}
                onClick={() => onSelect(task.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(task.id);
                  }
                }}
                className={cx("cursor-pointer hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent", selectedId === task.id && "bg-accent-soft")}
              >
                <th scope="row" className="px-4 py-3 font-medium">#{task.seq}</th>
                <td className="min-w-40 max-w-72 break-words px-4 py-3">{task.flows.join(", ") || "-"}</td>
                <td className="min-w-40 px-4 py-3">{deviceLabel(task.device_serial, devices)}</td>
                <td className="whitespace-nowrap px-4 py-3"><StatusBadge status={task.status} /></td>
                <td className="whitespace-nowrap px-4 py-3">{task.attempt > 1 ? `${task.attempt}회차` : "-"}</td>
                <td className="max-w-60 truncate px-4 py-3" title={error || undefined}>{error || "-"}</td>
                <td className="whitespace-nowrap px-4 py-3 text-fg-subtle">{elapsed(task.started_at, task.finished_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
