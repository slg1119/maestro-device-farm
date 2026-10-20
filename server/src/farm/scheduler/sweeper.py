from sqlalchemy import select
from sqlalchemy.orm import Session

from farm.db.models import Device, Task
from farm.scheduler.finish import terminate_task
from farm.timeutil import now, shift

UNAVAILABLE_STATES = ("offline", "unhealthy", "disabled")


def fail_stale_pinned_tasks(session: Session, pinned_wait_sec: int) -> list[str]:
    cutoff = shift(now(), -pinned_wait_sec)
    rows = session.execute(
        select(Task, Device)
        .outerjoin(Device, Task.device_serial == Device.serial)
        .where(Task.status == "queued", Task.pinned.is_(True))
    ).all()
    failed = []
    for task, device in rows:
        if device is not None and device.state not in UNAVAILABLE_STATES:
            continue  # available/reserved/busy devices will get to the task
        since = max(task.created_at, device.state_changed_at) if device is not None else task.created_at
        if since > cutoff:
            continue
        terminate_task(session, task, "error", "device_unavailable",
                       f"device {task.device_serial} was unavailable for more than {pinned_wait_sec}s")
        failed.append(task.id)
    return failed
