from pathlib import Path

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from farm.db.models import AppBuild, Device, Run, Task
from farm.devices.state import set_device_state
from farm.events import emit
from farm.scheduler.payloads import run_payload, task_payload
from farm.scheduler.selector import DeviceSelector, device_matches
from farm.timeutil import now

CLAIMABLE_DEVICE_STATES = ("available", "reserved")
SCAN_LIMIT = 200


def claim_next(session: Session, serial: str, data_dir: Path) -> Task | None:
    device = session.get(Device, serial)
    if (device is None or device.state not in CLAIMABLE_DEVICE_STATES or device.disabled
            or device.current_task_id is not None):
        return None
    if device.reservation_id:
        reservation_match = Run.reservation_id == device.reservation_id
    else:
        reservation_match = Run.reservation_id.is_(None)
    rows = session.execute(
        select(Task, Run, AppBuild)
        .join(Run, Task.run_id == Run.id)
        .join(AppBuild, Run.app_build_id == AppBuild.id)
        .where(
            Task.status == "queued",
            or_(Task.not_before.is_(None), Task.not_before <= now()),
            Run.cancel_requested.is_(False),
            reservation_match,
            or_(and_(Task.pinned.is_(True), Task.device_serial == serial), Task.pinned.is_(False)),
        )
        .order_by(Run.created_at, Run.id, Task.seq)
        .limit(SCAN_LIMIT)
    ).all()
    for task, run, app in rows:
        if not task.pinned and not device_matches(
            device, DeviceSelector.model_validate(run.device_selector), app.min_sdk
        ):
            continue
        return _start(session, device, task, run, data_dir)
    return None


def _start(session: Session, device: Device, task: Task, run: Run, data_dir: Path) -> Task:
    ts = now()
    task.status = "running"
    task.not_before = None
    task.device_serial = device.serial
    task.started_at = ts
    task.artifacts_dir = str(data_dir / "runs" / run.id / "tasks" / task.id / f"attempt-{task.attempt}")
    task.exit_code = None
    task.error_code = None
    task.error_message = None
    device.current_task_id = task.id
    set_device_state(session, device, "busy")
    if run.status == "queued":
        run.status = "running"
        run.started_at = ts
        emit(session, "run.updated", run_payload(run), run_id=run.id)
    emit(session, "task.updated", task_payload(task), run_id=run.id)
    return task
