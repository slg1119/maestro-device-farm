import { QueryClient } from "@tanstack/react-query";

import { createInvalidator, keysFor } from "../events";

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
