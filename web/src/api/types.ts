// Mirrors the farm-api response models (server/src/farm/api/routes/*.py). Keep field names identical.

export type RunStatus = "queued" | "running" | "passed" | "failed" | "error" | "cancelled";
export type TaskStatus = RunStatus;
export type DeviceState = "available" | "busy" | "reserved" | "offline" | "unhealthy" | "disabled";
export type RunMode = "matrix" | "split";
export type RunOrigin = "ci" | "dashboard" | "editor" | "ai";
export type FlowSource = "upload" | "workspace" | "draft";

export interface Reservation {
  id: string;
  device_serial: string;
  holder_name: string;
  status: "active" | "released" | "expired";
  created_at: string;
  expires_at: string;
  released_at: string | null;
}

export interface Device {
  serial: string;
  platform: string;
  model: string;
  manufacturer: string;
  os_version: string;
  sdk_int: number;
  battery: number | null;
  tags: string[];
  state: DeviceState;
  state_reason: string;
  disabled: boolean;
  last_seen_at: string | null;
  current_task_id: string | null;
  current_run_id: string | null;
  reservation: Reservation | null;
}

export interface AppRef {
  id: string;
  package_name: string;
  version_name: string;
  version_code: number;
}

export interface RunCounts {
  total: number;
  queued: number;
  running: number;
  passed: number;
  failed: number;
  error: number;
  cancelled: number;
}

export interface CiMeta {
  branch?: string;
  commit?: string;
  pr_url?: string;
  workflow_url?: string;
}

export interface RunSummary {
  id: string;
  origin: RunOrigin;
  mode: RunMode;
  status: RunStatus;
  flow_source: FlowSource;
  created_by: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  ci_meta: CiMeta;
  workspace_id: string | null;
  ref: string | null;
  commit_sha: string | null;
  app: AppRef;
  counts: RunCounts;
}

export interface Task {
  id: string;
  seq: number;
  device_serial: string | null;
  pinned: boolean;
  flows: string[];
  status: TaskStatus;
  attempt: number;
  exit_code: number | null;
  error_code: string | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface CaseResult {
  task_id: string;
  device_serial: string;
  flow_name: string;
  status: "passed" | "failed" | "skipped";
  duration_ms: number;
  failure_message: string | null;
}

export interface DeviceSelector {
  serials?: string[];
  tags?: string[];
  models?: string[];
  min_sdk?: number;
  max_sdk?: number;
}

export interface RunDetail extends RunSummary {
  device_selector: DeviceSelector;
  flow_paths: string[] | null;
  include_tags: string[];
  exclude_tags: string[];
  env: Record<string, string>; // values are always "***"
  task_timeout_sec: number;
  reservation_id: string | null;
  cancel_requested: boolean;
  tasks: Task[];
  results: CaseResult[];
}

export interface ArtifactFile {
  path: string;
  size: number;
}

export interface ArtifactListing {
  task_id: string;
  attempt: number;
  files: ArtifactFile[];
}

export interface AppBuild {
  id: string;
  package_name: string;
  version_name: string;
  version_code: number;
  min_sdk: number;
  label: string;
  sha256: string;
  size_bytes: number;
  source: "ci" | "dashboard";
  ci_meta: CiMeta;
  uploaded_by: string;
  pinned: boolean;
  purged: boolean;
  created_at: string;
}

export interface Workspace {
  id: string;
  name: string;
  repo: string;
  branch: string;
  path: string;
  default_app_package: string | null;
  head_sha: string | null;
  synced_at: string | null;
  sync_error: string | null;
  created_at: string;
}

export interface WorkspaceTree {
  sha: string;
  files: ArtifactFile[];
}

export interface WorkspaceCommit {
  sha: string;
  author_name: string;
  author_email: string;
  authored_at: string; // ISO 8601 with offset (git %aI), not the server's Z format
  message: string;
  co_authors: { name: string; email: string }[];
  files_changed: number;
}

export interface WorkspaceHistory {
  sha: string;
  commits: WorkspaceCommit[];
}

export interface Health {
  status: "ok";
  agent: { id: string; version: string; started_at: string; last_heartbeat_at: string; age_sec: number } | null;
  workspace_sync_errors: { name: string; error: string }[];
  disk_free_bytes: number;
}

/** Options JSON for POST /api/v1/runs (multipart field `options`). */
export interface RunOptions {
  mode: RunMode;
  flow_source?: FlowSource;
  workspace?: string;
  ref?: string;
  device_selector?: DeviceSelector;
  app_build_id?: string;
  app?: string; // "<package>@latest"
  flow_paths?: string[];
  include_tags?: string[];
  exclude_tags?: string[];
  env?: Record<string, string>;
  ci_meta?: CiMeta;
  task_timeout_sec?: number;
  origin?: "ci" | "dashboard" | "editor";
}

export interface FarmEvent {
  id: number;
  type: string;
  ts: string;
  run_id: string | null;
  payload: Record<string, unknown>;
}
