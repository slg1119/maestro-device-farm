import type { CaseResult, RunDetail, TaskStatus } from "../../api/types";

export interface MatrixCell {
  status: TaskStatus | CaseResult["status"];
  durationMs?: number;
  failure?: string;
}

/** Results identify a cell by task and flow; tasks also cover devices with no results yet. */
export function buildMatrix(run: RunDetail) {
  const flows = [...new Set(run.results.map((result) => result.flow_name))].sort();
  const tasks = [...run.tasks].sort((a, b) => a.seq - b.seq);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const results = new Map<string, Map<string, CaseResult>>();
  for (const result of run.results) {
    const taskResults = results.get(result.task_id) ?? new Map<string, CaseResult>();
    taskResults.set(result.flow_name, result);
    results.set(result.task_id, taskResults);
  }
  return {
    flows: flows.length ? flows : ["(결과 대기)"],
    columns: tasks.map((task) => ({ taskId: task.id, serial: task.device_serial })),
    cell(flow: string, taskId: string): MatrixCell {
      const result = results.get(taskId)?.get(flow);
      if (!result) return { status: taskById.get(taskId)?.status ?? "queued" };
      return {
        status: result.status,
        durationMs: result.duration_ms,
        ...(result.failure_message ? { failure: result.failure_message } : {}),
      };
    },
  };
}
