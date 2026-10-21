import { QueryClient } from "@tanstack/react-query";

import { createInvalidator, EVENT_TYPES, keysFor } from "../events";

test("maps event types to query keys", () => {
  expect(keysFor({ type: "device.updated", run_id: null, payload: {} })).toEqual([["devices"]]);
  expect(keysFor({ type: "task.updated", run_id: "r1", payload: {} })).toEqual([["runs"], ["devices"], ["run", "r1"]]);
  expect(keysFor({ type: "run.updated", run_id: null, payload: { id: "r2" } })).toEqual([["runs"], ["devices"], ["run", "r2"]]);
  expect(keysFor({ type: "workspace.updated", run_id: null, payload: {} })).toEqual([["workspaces"], ["health"]]);
  expect(keysFor({ type: "unknown", run_id: null, payload: {} })).toEqual([]);
});

test("batches a burst of events into one invalidation per key", () => {
  vi.useFakeTimers();
  const client = new QueryClient();
  const spy = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
  const invalidator = createInvalidator(client, 300);
  for (let i = 0; i < 5; i++) invalidator.push({ type: "task.updated", run_id: "r1", payload: {} });
  expect(spy).not.toHaveBeenCalled();
  vi.advanceTimersByTime(300);
  expect(spy.mock.calls.map(([arg]) => arg?.queryKey)).toEqual([["runs"], ["devices"], ["run", "r1"]]);
  vi.useRealTimers();
});

test("invalidates the AI job, job lists and usage after every AI update", () => {
  expect(keysFor({ type: "ai_job.updated", run_id: null, payload: { id: "ai1", status: "running", attempts: 1 } })).toEqual([
    ["ai-job", "ai1"], ["ai-jobs"], ["ai-status"],
  ]);
  expect(keysFor({ type: "ai_job.updated", run_id: null, payload: {} })).toEqual([["ai-jobs"], ["ai-status"]]);
});

test("invalidates device command details and reservations on their events", () => {
  expect(keysFor({ type: "device_command.updated", run_id: null, payload: { id: "cmd1" } })).toEqual([["devices"], ["device-command", "cmd1"]]);
  expect(keysFor({ type: "reservation.updated", run_id: null, payload: {} })).toEqual([["devices"], ["reservations"]]);
});

test("recording updates refresh the exact recording and active device recording lists", () => {
  expect(EVENT_TYPES).toContain("recording.updated");
  expect(keysFor({ type: "recording.updated", run_id: null, payload: { id: "rec1", status: "active", steps: 2 } })).toEqual([["recording", "rec1"], ["device-recordings"]]);
  expect(keysFor({ type: "recording.updated", run_id: null, payload: {} })).toEqual([["device-recordings"]]);
});
