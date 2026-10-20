import { describe, expect, test } from "vitest";

import type { CaseResult } from "../../../api/types";
import { runDetail, task } from "../../../test/fixtures";
import { buildMatrix } from "../grid";

const results: CaseResult[] = [
  { task_id: "task1", device_serial: "emulator-5554", flow_name: "login", status: "passed", duration_ms: 1000, failure_message: null },
  { task_id: "task1", device_serial: "emulator-5554", flow_name: "checkout", status: "failed", duration_ms: 2000, failure_message: "결제 버튼을 찾지 못했습니다." },
  { task_id: "task2", device_serial: "emulator-5556", flow_name: "login", status: "passed", duration_ms: 3000, failure_message: null },
];

describe("buildMatrix", () => {
  test("builds sorted unique flows and one column per task using that task's results", () => {
    const matrix = buildMatrix(runDetail({ tasks: [task({ status: "failed" }), task({ id: "task2", seq: 1, device_serial: "emulator-5556", status: "running" })], results }));
    expect(matrix.flows).toEqual(["checkout", "login"]);
    expect(matrix.columns).toEqual([{ taskId: "task1", serial: "emulator-5554" }, { taskId: "task2", serial: "emulator-5556" }]);
    expect(matrix.cell("checkout", "task1")).toEqual({ status: "failed", durationMs: 2000, failure: "결제 버튼을 찾지 못했습니다." });
    expect(matrix.cell("login", "task1")).toMatchObject({ status: "passed", durationMs: 1000 });
    expect(matrix.cell("login", "task2")).toMatchObject({ status: "passed", durationMs: 3000 });
    expect(matrix.cell("checkout", "task2")).toEqual({ status: "running" });
  });

  test("uses the task status when another task has results but this task has none", () => {
    const matrix = buildMatrix(runDetail({ tasks: [task(), task({ id: "task2", status: "running" })], results: results.slice(0, 1) }));
    expect(matrix.cell("login", "task2")).toEqual({ status: "running" });
  });

  test("uses the waiting row and each task's status when there are no results", () => {
    const matrix = buildMatrix(runDetail({ tasks: [task({ status: "queued", device_serial: null }), task({ id: "task2", status: "error" })] }));
    expect(matrix.flows).toEqual(["(결과 대기)"]);
    expect(matrix.cell("(결과 대기)", "task1")).toEqual({ status: "queued" });
    expect(matrix.cell("(결과 대기)", "task2")).toEqual({ status: "error" });
  });
});
