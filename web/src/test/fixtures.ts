import type { AppBuild, Device, RunDetail, RunSummary, Task, Workspace } from "../api/types";

// Factories for API objects. Override only the fields a test cares about.

export function device(overrides: Partial<Device> = {}): Device {
  return {
    serial: "emulator-5554", platform: "android", model: "Pixel 7", manufacturer: "Google", os_version: "14",
    sdk_int: 34, battery: 87, tags: [], state: "available", state_reason: "", disabled: false,
    last_seen_at: "2026-10-20T05:00:00.000000Z", current_task_id: null, current_run_id: null, reservation: null,
    ...overrides,
  };
}

export function app(overrides: Partial<AppBuild> = {}): AppBuild {
  return {
    id: "app1", package_name: "com.example.app", version_name: "1.0", version_code: 1, min_sdk: 24, label: "Example",
    sha256: "f".repeat(64), size_bytes: 12_345_678, source: "ci", ci_meta: {}, uploaded_by: "ci", pinned: false,
    purged: false, created_at: "2026-10-20T05:00:00.000000Z", ...overrides,
  };
}

export function runSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    id: "run1", origin: "ci", mode: "split", status: "passed", flow_source: "upload", created_by: "ci",
    created_at: "2026-10-20T05:00:00.000000Z", started_at: "2026-10-20T05:00:05.000000Z",
    finished_at: "2026-10-20T05:02:05.000000Z", ci_meta: {}, workspace_id: null, ref: null, commit_sha: null,
    app: { id: "app1", package_name: "com.example.app", version_name: "1.0", version_code: 1 },
    counts: { total: 2, queued: 0, running: 0, passed: 2, failed: 0, error: 0, cancelled: 0 },
    ...overrides,
  };
}

export function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task1", seq: 0, device_serial: "emulator-5554", pinned: false, flows: ["login.yaml"], status: "passed",
    attempt: 1, exit_code: 0, error_code: null, error_message: null, started_at: "2026-10-20T05:00:05.000000Z",
    finished_at: "2026-10-20T05:01:05.000000Z", ...overrides,
  };
}

export function runDetail(overrides: Partial<RunDetail> = {}): RunDetail {
  return {
    ...runSummary(), device_selector: {}, flow_paths: null, include_tags: [], exclude_tags: [], env: {},
    task_timeout_sec: 1800, reservation_id: null, cancel_requested: false, tasks: [task()], results: [],
    ...overrides,
  };
}

export function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "ws1", name: "example-app", repo: "example-org/example-app", branch: "main", path: ".maestro",
    default_app_package: "com.example.app", head_sha: "a".repeat(40), synced_at: "2026-10-20T05:00:00.000000Z",
    sync_error: null, created_at: "2026-10-20T04:00:00.000000Z", ...overrides,
  };
}
