from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from farm.db.models import AppBuild, Device, Run, Task
from farm.events import emit
from farm.flows.enumerate import FlowSelectionError, enumerate_flows
from farm.scheduler.payloads import run_payload
from farm.scheduler.selector import DeviceSelector, device_matches

MODES = ("matrix", "split")


class SubmitError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass
class RunRequest:
    run_id: str
    mode: str
    selector: DeviceSelector
    app_build: AppBuild
    flows_dir: Path
    flow_source: str = "upload"
    flow_paths: list[str] | None = None
    include_tags: list[str] = field(default_factory=list)
    exclude_tags: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)
    ci_meta: dict = field(default_factory=dict)
    task_timeout_sec: int = 1800
    origin: str = "ci"
    created_by: str = ""
    reservation_id: str | None = None
    workspace_id: str | None = None
    ref: str | None = None
    commit_sha: str | None = None


def candidate_devices(session: Session, req: RunRequest) -> list[Device]:
    if req.reservation_id:
        query = select(Device).where(Device.reservation_id == req.reservation_id)
    else:
        query = select(Device).where(
            Device.state.in_(("available", "busy")),
            Device.reservation_id.is_(None),
            Device.disabled.is_(False),
        )
    devices = session.scalars(query.order_by(Device.serial))
    return [d for d in devices if device_matches(d, req.selector, req.app_build.min_sdk)]


def _select_flows(req: RunRequest) -> list[str]:
    try:
        if req.mode == "split":
            flows = enumerate_flows(req.flows_dir, req.include_tags, req.exclude_tags, req.flow_paths)
            if not flows:
                raise SubmitError("no_flows", "no flow matched the tag filters")
            return flows
        return enumerate_flows(req.flows_dir, [], [], req.flow_paths) if req.flow_paths else []
    except FlowSelectionError as exc:
        raise SubmitError("flow_not_found", str(exc)) from exc


def create_run(session: Session, req: RunRequest) -> Run:
    if req.mode not in MODES:
        raise SubmitError("invalid_mode", f"mode must be one of {', '.join(MODES)}")
    devices = candidate_devices(session, req)
    if not devices:
        raise SubmitError("no_matching_devices", "no available device matches the selector")
    flows = _select_flows(req)
    run = Run(
        id=req.run_id, origin=req.origin, mode=req.mode, status="queued",
        device_selector=req.selector.model_dump(exclude_none=True), app_build_id=req.app_build.id,
        flow_source=req.flow_source, flows_dir=str(req.flows_dir), flow_paths=req.flow_paths,
        include_tags=list(req.include_tags), exclude_tags=list(req.exclude_tags), env=dict(req.env),
        ci_meta=dict(req.ci_meta), task_timeout_sec=req.task_timeout_sec, reservation_id=req.reservation_id,
        created_by=req.created_by, workspace_id=req.workspace_id, ref=req.ref, commit_sha=req.commit_sha,
    )
    session.add(run)
    if req.mode == "matrix":
        for seq, device in enumerate(devices):
            session.add(Task(run_id=run.id, seq=seq, device_serial=device.serial, pinned=True, flows=list(flows)))
    else:
        for seq, flow in enumerate(flows):
            session.add(Task(run_id=run.id, seq=seq, pinned=False, flows=[flow]))
    session.flush()
    emit(session, "run.updated", run_payload(run), run_id=run.id)
    return run
