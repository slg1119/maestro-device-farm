from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from farm.config import Settings
from farm.db.models import AppBuild, Reservation, Run, Task, TestResult
from farm.flows.enumerate import FlowSelectionError, enumerate_flows
from farm.ids import new_id
from farm.scheduler.selector import DeviceSelector
from farm.scheduler.submit import RunRequest, SubmitError, create_run
from farm.timeutil import now


@dataclass
class RerunPlan:
    new_run_id: str
    flows_dir: Path
    options: dict[str, Any]
    flow_paths: list[str] | None


def _failed_flows(session: Session, run: Run, root: Path) -> list[str]:
    names = set(session.scalars(select(TestResult.flow_name).where(
        TestResult.run_id == run.id, TestResult.status.in_(("failed", "error")))))
    tasks = list(session.scalars(select(Task).where(Task.run_id == run.id, Task.status == "error")))
    if not names and not tasks:
        raise SubmitError("nothing_failed", "the run has no failed flows")
    for task in tasks:
        names.update(task.flows or [])
    try:
        candidates = enumerate_flows(root, run.include_tags or [], run.exclude_tags or [])
        if run.flow_paths:
            candidates.extend(enumerate_flows(root, [], [], run.flow_paths))
    except FlowSelectionError as exc:
        raise SubmitError("flow_not_found", str(exc)) from exc
    every_flow = any(not task.flows for task in tasks)
    selected = sorted({path for path in candidates if every_flow or path in names or Path(path).stem in names})
    if not selected:
        raise SubmitError("nothing_failed", "no failed flows match the run snapshot")
    return selected


def prepare_rerun(session: Session, settings: Settings, run_id: str, *, failed_only: bool) -> RerunPlan:
    """Read an immutable submission plan; the caller copies its snapshot after this transaction ends."""
    run = session.get(Run, run_id)
    if run is None:
        raise SubmitError("run_not_found", f"run {run_id} not found")
    root = Path(run.flows_dir)
    if run.artifacts_purged or not root.is_dir():
        raise SubmitError("snapshot_purged", "the run snapshot is no longer available")
    flow_paths = _failed_flows(session, run, root) if failed_only else deepcopy(run.flow_paths)
    fields = ("mode", "device_selector", "app_build_id", "flow_source", "workspace_id", "ref", "commit_sha",
              "include_tags", "exclude_tags", "env", "ci_meta", "task_timeout_sec", "reservation_id")
    return RerunPlan(new_id(), root, {field: deepcopy(getattr(run, field)) for field in fields}, flow_paths)


def rerun_run(session: Session, plan: RerunPlan, *, flows_dir: Path, created_by: str) -> Run:
    """Submit an already copied snapshot in the caller's creation transaction."""
    options = plan.options
    reservation = session.get(Reservation, options["reservation_id"]) if options["reservation_id"] else None
    reservation_id = (reservation.id if reservation is not None and reservation.status == "active"
                      and reservation.expires_at > now() else None)
    return create_run(session, RunRequest(
        run_id=plan.new_run_id, mode=options["mode"], selector=DeviceSelector(**(options["device_selector"] or {})),
        app_build=session.get(AppBuild, options["app_build_id"]), flows_dir=flows_dir,
        flow_source=options["flow_source"], workspace_id=options["workspace_id"], ref=options["ref"],
        commit_sha=options["commit_sha"], flow_paths=plan.flow_paths,
        include_tags=options["include_tags"] or [], exclude_tags=options["exclude_tags"] or [],
        env=options["env"] or {}, ci_meta=options["ci_meta"] or {}, task_timeout_sec=options["task_timeout_sec"],
        origin="dashboard", created_by=created_by, reservation_id=reservation_id,
    ))
