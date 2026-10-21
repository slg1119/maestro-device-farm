import { useQuery } from "@tanstack/react-query";

import { apiJson, query } from "./client";
import type { AiJob, AiStatus, AppBuild, ArtifactListing, Device, DeviceCommand, Health, Recording, RecordingCreate, RunDetail, RunSummary, StreamTicket, TaskSteps, Workspace } from "./types";
import { getSettings } from "../lib/settings";

export function createStreamTicket(serial: string, signal?: AbortSignal) {
  const author_name = getSettings().authorName.trim();
  return apiJson<StreamTicket>(`/devices/${encodeURIComponent(serial)}/stream-ticket`, { method: "POST", json: { ...(author_name ? { author_name } : {}) }, signal });
}

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
  recording: (id: string) => ["recording", id] as const,
  deviceRecordings: (serial: string) => ["device-recordings", serial] as const,
  deviceRecordingsAll: ["device-recordings"] as const,
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

export function useRecording(id: string | null) {
  return useQuery({ queryKey: keys.recording(id ?? ""), queryFn: ({ signal }) => apiJson<Recording>(`/recordings/${encodeURIComponent(id!)}`, { signal }), enabled: id !== null, retry: false });
}

export function useActiveRecordings(serial: string) {
  return useQuery({ queryKey: keys.deviceRecordings(serial), queryFn: ({ signal }) => apiJson<Recording[]>(`/devices/${encodeURIComponent(serial)}/recordings?status=active`, { signal }), retry: false });
}

export function startRecording(serial: string, body: RecordingCreate) {
  return apiJson<Recording>(`/devices/${encodeURIComponent(serial)}/recordings`, { method: "POST", json: body });
}
export function stopRecording(id: string, aiPolish: boolean) {
  return apiJson<Recording>(`/recordings/${encodeURIComponent(id)}/stop`, { method: "POST", json: { ai_polish: aiPolish } });
}
export function cancelRecording(id: string) {
  return apiJson<Recording>(`/recordings/${encodeURIComponent(id)}`, { method: "DELETE" });
}
