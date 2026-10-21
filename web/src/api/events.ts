import { type QueryClient, type QueryKey, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { API } from "./client";
import { keys } from "./queries";

/** Event types farm-api writes to the `events` table (spec §4 events). */
export const EVENT_TYPES = [
  "device.updated",
  "reservation.updated",
  "device_command.updated",
  "run.updated",
  "task.updated",
  "workspace.updated",
  "ai_job.updated",
] as const;

export interface StreamEvent {
  type: string;
  run_id: string | null;
  payload: Record<string, unknown>;
}

/** Which queries an event makes stale. */
export function keysFor(event: StreamEvent): QueryKey[] {
  const runId = event.run_id ?? (typeof event.payload.run_id === "string" ? event.payload.run_id : null);
  switch (event.type) {
    case "device.updated":
      return [keys.devices];
    case "reservation.updated":
      return [keys.devices, keys.reservations];
    case "device_command.updated":
      return [keys.devices, ...(typeof event.payload.id === "string" ? [keys.deviceCommand(event.payload.id)] : [])];
    case "ai_job.updated":
      return [...(typeof event.payload.id === "string" ? [keys.aiJob(event.payload.id)] : []), ["ai-jobs"], keys.aiStatus];
    case "run.updated":
    case "task.updated": {
      const id = runId ?? (event.type === "run.updated" ? (event.payload.id as string | undefined) ?? null : null);
      return [keys.runsAll, keys.devices, ...(id ? [keys.run(id)] : [])];
    }
    case "workspace.updated":
      return [keys.workspaces, keys.health];
    default:
      return [];
  }
}

/** Collects keys for `delayMs` and invalidates each distinct key once, so a burst of task events refetches once. */
export function createInvalidator(client: QueryClient, delayMs = 300) {
  const pending = new Map<string, QueryKey>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    const batch = [...pending.values()];
    pending.clear();
    batch.forEach((queryKey) => void client.invalidateQueries({ queryKey }));
  };
  return {
    push(event: StreamEvent) {
      for (const key of keysFor(event)) pending.set(JSON.stringify(key), key);
      if (pending.size && timer === null) timer = setTimeout(flush, delayMs);
    },
    dispose() {
      if (timer !== null) clearTimeout(timer);
    },
  };
}

export type StreamState = "connecting" | "open" | "closed";

/** Subscribes to /api/v1/events for the app's lifetime and keeps TanStack Query caches fresh. */
export function useLiveEvents(): StreamState {
  const client = useQueryClient();
  const [state, setState] = useState<StreamState>("connecting");
  useEffect(() => {
    const invalidator = createInvalidator(client);
    const source = new EventSource(`${API}/events`);
    const onEvent = (message: MessageEvent<string>) => {
      try {
        const data = JSON.parse(message.data) as Omit<StreamEvent, "type">;
        invalidator.push({ type: message.type, run_id: data.run_id ?? null, payload: data.payload ?? {} });
      } catch {
        // ignore malformed frames
      }
    };
    source.onopen = () => {
      setState("open");
      void client.invalidateQueries(); // catch up on anything missed while disconnected
    };
    source.onerror = () => setState(source.readyState === EventSource.CLOSED ? "closed" : "connecting");
    EVENT_TYPES.forEach((type) => source.addEventListener(type, onEvent));
    return () => {
      invalidator.dispose();
      source.close();
    };
  }, [client]);
  return state;
}
