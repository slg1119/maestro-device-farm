"""farmctl: CI client for maestro-device-farm.

Depends only on the standard library and httpx so CI runners can install it on its own.
"""
import argparse
import contextlib
import io
import json
import os
import sys
import time
import urllib.parse
import zipfile
from pathlib import Path

import httpx

EXIT_PASSED, EXIT_FAILED, EXIT_ERROR, EXIT_CANCELLED = 0, 1, 2, 3
STATUS_EXIT = {"passed": EXIT_PASSED, "failed": EXIT_FAILED, "error": EXIT_ERROR, "cancelled": EXIT_CANCELLED}
TERMINAL = set(STATUS_EXIT)


def _csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def _env_pair(value: str) -> tuple[str, str]:
    key, sep, val = value.partition("=")
    if not sep or not key:
        raise argparse.ArgumentTypeError(f"expected KEY=VALUE, got {value!r}")
    return key, val


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="farmctl", description="Submit Maestro runs to maestro-device-farm")
    parser.add_argument("--server", default=os.environ.get("FARM_URL", "http://localhost:8700"))
    parser.add_argument("--token", default=os.environ.get("FARM_TOKEN"),
                        help="API token; only needed when the farm runs with FARM_REQUIRE_TOKEN=true")
    parser.add_argument("--user", default=os.environ.get("FARM_USER"),
                        help="name recorded as the run's creator when no token is used")
    sub = parser.add_subparsers(dest="cmd", required=True)

    run = sub.add_parser("run", help="submit a run")
    source = run.add_mutually_exclusive_group(required=True)
    source.add_argument("--flows", type=Path, help="directory of Maestro flows to zip and upload")
    source.add_argument("--workspace", help="registered workspace name or id")
    run.add_argument("--ref", help="branch or commit SHA for --workspace (default: the workspace branch)")
    app = run.add_mutually_exclusive_group(required=True)
    app.add_argument("--apk", type=Path, help="APK file to upload")
    app.add_argument("--app", help="<package>@latest from the APK library")
    run.add_argument("--mode", choices=["matrix", "split"], default="split")
    run.add_argument("--flow", action="append", dest="flow_paths", help="run only this flow (repeatable)")
    run.add_argument("--device-tags", type=_csv)
    run.add_argument("--serials", type=_csv)
    run.add_argument("--models", type=_csv)
    run.add_argument("--min-sdk", type=int)
    run.add_argument("--max-sdk", type=int)
    run.add_argument("--include-tags", type=_csv, default=[])
    run.add_argument("--exclude-tags", type=_csv, default=[])
    run.add_argument("-e", "--env", type=_env_pair, action="append", default=[])
    run.add_argument("--ci-branch")
    run.add_argument("--ci-commit")
    run.add_argument("--ci-pr-url")
    run.add_argument("--ci-workflow-url")
    run.add_argument("--timeout", type=int, help="per-task timeout in seconds")
    run.add_argument("--wait", action="store_true", help="wait for the run and exit with its status")
    run.add_argument("--wait-timeout", type=float, default=3600)
    run.add_argument("--junit", type=Path, help="write the merged JUnit report here (with --wait)")

    apps = sub.add_parser("apps", help="APK library")
    apps_sub = apps.add_subparsers(dest="apps_cmd", required=True)
    apps_sub.add_parser("upload", help="upload an APK").add_argument("apk", type=Path)
    return parser


def build_options(args: argparse.Namespace) -> dict:
    selector = {key: value for key, value in {
        "tags": args.device_tags, "serials": args.serials, "models": args.models,
        "min_sdk": args.min_sdk, "max_sdk": args.max_sdk,
    }.items() if value is not None}
    ci_meta = {key: value for key, value in {
        "branch": args.ci_branch, "commit": args.ci_commit, "pr_url": args.ci_pr_url,
        "workflow_url": args.ci_workflow_url,
    }.items() if value}
    options = {
        "mode": args.mode, "device_selector": selector, "include_tags": args.include_tags,
        "exclude_tags": args.exclude_tags, "env": dict(args.env), "ci_meta": ci_meta, "origin": "ci",
    }
    if args.workspace:
        options["flow_source"] = "workspace"
        options["workspace"] = args.workspace
        if args.ref:
            options["ref"] = args.ref
    if args.flow_paths:
        options["flow_paths"] = args.flow_paths
    if args.app:
        options["app"] = args.app
    if args.timeout:
        options["task_timeout_sec"] = args.timeout
    return options


def zip_dir(path: Path) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for file in sorted(path.rglob("*")):
            rel = file.relative_to(path)
            if file.is_file() and not any(part.startswith(".") for part in rel.parts):
                zf.write(file, rel.as_posix())
    return buffer.getvalue()


class SseParser:
    """Incremental text/event-stream parser fed one line at a time."""

    def __init__(self) -> None:
        self.event_id: str | None = None
        self.event: str | None = None
        self.data: list[str] = []

    def feed(self, line: str) -> tuple[str | None, str | None, str] | None:
        line = line.rstrip("\r")
        if not line:
            if not self.data:
                self.event = None
                return None
            out = (self.event_id, self.event, "\n".join(self.data))
            self.event, self.data = None, []
            return out
        if line.startswith(":"):
            return None
        field, _, value = line.partition(":")
        value = value.removeprefix(" ")
        if field == "id":
            self.event_id = value
        elif field == "event":
            self.event = value
        elif field == "data":
            self.data.append(value)
        return None


def _headers(args: argparse.Namespace) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {args.token}"} if args.token else {}
    if args.user:
        headers["X-Farm-User"] = urllib.parse.quote(args.user)
    return headers


def _describe(res: httpx.Response) -> str:
    try:
        error = res.json()["error"]
        return f"{res.status_code} {error['code']}: {error['message']}"
    except (ValueError, KeyError, TypeError):
        return f"{res.status_code} {res.text[:200]}"


def _print_progress(event_type: str | None, payload: dict, out) -> None:
    if event_type == "task.updated":
        extra = f" ({payload['error_code']})" if payload.get("error_code") else ""
        print(f"  task {str(payload.get('id', ''))[-6:]} {payload.get('status')} on "
              f"{payload.get('device_serial') or '-'} attempt {payload.get('attempt')}{extra}", file=out)
    elif event_type == "run.updated":
        print(f"  run {payload.get('status')}", file=out)


def _run_status(client: httpx.Client, run_id: str) -> str | None:
    res = client.get(f"/api/v1/runs/{run_id}")
    return res.json().get("status") if res.status_code == 200 else None


def wait_for_run(client: httpx.Client, run_id: str, timeout: float, out=None) -> str | None:
    out = out or sys.stdout
    deadline = time.monotonic() + timeout
    last_id = "0"
    while time.monotonic() < deadline:
        status = _run_status(client, run_id)
        if status in TERMINAL:
            return status
        try:
            with client.stream("GET", "/api/v1/events", params={"run_id": run_id, "since": last_id},
                               timeout=httpx.Timeout(10.0, read=30.0)) as res:
                parser = SseParser()
                for line in res.iter_lines():
                    if time.monotonic() > deadline:
                        return None
                    event = parser.feed(line)
                    if event is None:
                        continue
                    event_id, event_type, data = event
                    last_id = event_id or last_id
                    payload = json.loads(data).get("payload", {})
                    _print_progress(event_type, payload, out)
                    if event_type == "run.updated" and payload.get("status") in TERMINAL:
                        return payload["status"]
        except httpx.HTTPError:
            time.sleep(1)  # the server restarted or the stream stalled: reconnect from last_id
    return None


def cmd_run(args: argparse.Namespace, client: httpx.Client) -> int:
    if args.ref and not args.workspace:
        print("farmctl: --ref needs --workspace", file=sys.stderr)
        return EXIT_ERROR
    if args.flows and not args.flows.is_dir():
        print(f"farmctl: {args.flows} is not a directory", file=sys.stderr)
        return EXIT_ERROR
    with contextlib.ExitStack() as stack:
        files = {"flows": ("flows.zip", zip_dir(args.flows), "application/zip")} if args.flows else {}
        if args.apk:
            files["apk"] = (args.apk.name, stack.enter_context(args.apk.open("rb")),
                            "application/vnd.android.package-archive")
        res = client.post("/api/v1/runs", data={"options": json.dumps(build_options(args))}, files=files or None,
                          headers=_headers(args), timeout=300)
    if res.status_code != 201:
        print(f"farmctl: submit failed: {_describe(res)}", file=sys.stderr)
        return EXIT_ERROR
    run = res.json()
    print(f"run {run['id']} submitted: {run['url']}")
    if not args.wait:
        return EXIT_PASSED
    status = wait_for_run(client, run["id"], args.wait_timeout)
    if status is None:
        print(f"farmctl: stopped waiting after {args.wait_timeout:.0f}s; the run keeps going", file=sys.stderr)
        return EXIT_CANCELLED
    if args.junit:
        args.junit.parent.mkdir(parents=True, exist_ok=True)
        args.junit.write_text(client.get(f"/api/v1/runs/{run['id']}/junit").text, encoding="utf-8")
        print(f"JUnit written to {args.junit}")
    print(f"run {run['id']} finished: {status}")
    return STATUS_EXIT[status]


def cmd_apps_upload(args: argparse.Namespace, client: httpx.Client) -> int:
    with args.apk.open("rb") as fh:
        res = client.post("/api/v1/apps", files={"apk": (args.apk.name, fh, "application/vnd.android.package-archive")},
                          headers=_headers(args), timeout=300)
    if res.status_code not in (200, 201):
        print(f"farmctl: upload failed: {_describe(res)}", file=sys.stderr)
        return EXIT_ERROR
    app = res.json()
    print(f"{app['package_name']} {app['version_name']} ({app['version_code']}) id={app['id']}")
    return EXIT_PASSED


def dispatch(args: argparse.Namespace, client: httpx.Client) -> int:
    if args.cmd == "run":
        return cmd_run(args, client)
    return cmd_apps_upload(args, client)


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    with httpx.Client(base_url=args.server, timeout=60) as client:
        return dispatch(args, client)


if __name__ == "__main__":
    sys.exit(main())
