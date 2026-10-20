import { useQuery } from "@tanstack/react-query";

import { apiJson, query } from "./client";
import type { AppBuild, ArtifactListing, Device, Health, RunDetail, RunSummary, Workspace } from "./types";

/** Every query key lives here so the SSE invalidation map (events.ts) stays in sync with the pages. */
export const keys = {
  devices: ["devices"] as const,
  runs: (filters: RunFilters = {}) => ["runs", filters] as const,
  runsAll: ["runs"] as const,
  run: (id: string) => ["run", id] as const,
  artifacts: (taskId: string) => ["artifacts", taskId] as const,
  apps: (pkg?: string) => ["apps", pkg ?? ""] as const,
  appsAll: ["apps"] as const,
  workspaces: ["workspaces"] as const,
  health: ["health"] as const,
};

export interface RunFilters {
  status?: string;
  origin?: string;
  workspace?: string;
  limit?: number;
  before?: string;
}

export function useDevices() {
  return useQuery({ queryKey: keys.devices, queryFn: () => apiJson<Device[]>("/devices") });
}

export function useRuns(filters: RunFilters = {}) {
  return useQuery({ queryKey: keys.runs(filters), queryFn: () => apiJson<RunSummary[]>(`/runs${query({ ...filters })}`) });
}

export function useRun(id: string) {
  return useQuery({ queryKey: keys.run(id), queryFn: () => apiJson<RunDetail>(`/runs/${id}`) });
}

export function useArtifacts(taskId: string | null) {
  return useQuery({
    queryKey: keys.artifacts(taskId ?? ""),
    queryFn: () => apiJson<ArtifactListing>(`/tasks/${taskId}/artifacts`),
    enabled: taskId !== null,
  });
}

export function useApps(pkg?: string) {
  return useQuery({ queryKey: keys.apps(pkg), queryFn: () => apiJson<AppBuild[]>(`/apps${query({ package: pkg })}`) });
}

export function useWorkspaces() {
  return useQuery({ queryKey: keys.workspaces, queryFn: () => apiJson<Workspace[]>("/workspaces") });
}

export function useHealth() {
  return useQuery({ queryKey: keys.health, queryFn: () => apiJson<Health>("/healthz"), refetchInterval: 15_000 });
}
