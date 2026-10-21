import { useQuery } from "@tanstack/react-query";

import { apiJson, query } from "./client";
import type { AiJob, AiStatus, AppBuild, ArtifactListing, Device, DeviceCommand, Health, RunDetail, RunSummary, TaskSteps, Workspace } from "./types";

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
  steps: (taskId: string) => ["steps", taskId] as const,
  aiStatus: ["ai-status"] as const,
  aiJob: (id: string) => ["ai-job", id] as const,
  aiJobs: (workspace?: string) => ["ai-jobs", workspace ?? ""] as const,
  workspaceTree: (id: string, sha: string) => ["workspace-tree", id, sha] as const,
  workspaceFile: (id: string, sha: string, path: string) => ["workspace-file", id, sha, path] as const,
  workspaceHistory: (id: string, sha: string, path?: string) => ["workspace-history", id, sha, path ?? ""] as const,
  deviceCommand: (id: string) => ["device-command", id] as const,
  reservations: ["reservations"] as const,
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


export function useTaskSteps(taskId: string | null) {
  return useQuery({ queryKey: keys.steps(taskId ?? ""), queryFn: () => apiJson<TaskSteps>(`/tasks/${encodeURIComponent(taskId!)}/steps`), enabled: taskId !== null });
}

export function useAiStatus() {
  return useQuery({ queryKey: keys.aiStatus, queryFn: () => apiJson<AiStatus>("/ai/status") });
}

export function useAiJob(id: string | null) {
  return useQuery({ queryKey: keys.aiJob(id ?? ""), queryFn: () => apiJson<AiJob>(`/ai/jobs/${encodeURIComponent(id!)}`), enabled: id !== null });
}

export function useDeviceCommand(id: string | null) {
  return useQuery({
    queryKey: keys.deviceCommand(id ?? ""), queryFn: () => apiJson<DeviceCommand>(`/device-commands/${encodeURIComponent(id!)}`), enabled: id !== null,
    refetchInterval: (query) => query.state.data?.status === "queued" || query.state.data?.status === "running" ? 1000 : false,
  });
}
