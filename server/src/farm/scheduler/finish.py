from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from farm.db.models import Device, Run, Task, TestResult
from farm.devices.state import idle_state, set_device_state
from farm.events import emit
from farm.results import TaskOutcome
from farm.scheduler.payloads import run_payload, task_payload
from farm.timeutil import now, shift

INFRA_ERROR_CODES = frozenset({"device_disconnected", "install_failed", "timeout", "agent_restarted", "no_junit"})
MAX_ATTEMPTS = 2
TERMINAL_STATUSES = frozenset({"passed", "failed", "error", "cancelled"})


def _release_device(session: Session, task: Task) -> None:
    if not task.device_serial:
        return
    device = session.get(Device, task.device_serial)
    if device is None or device.current_task_id != task.id:
        return
    device.current_task_id = None
    if device.state == "busy":
        set_device_state(session, device, idle_state(device))


def finalize_run_if_done(session: Session, run: Run) -> None:
    if run.status in TERMINAL_STATUSES:
        return
    statuses = list(session.scalars(select(Task.status).where(Task.run_id == run.id)))
    if not statuses or any(status not in TERMINAL_STATUSES for status in statuses):
        return
    if run.cancel_requested or "cancelled" in statuses:
        run.status = "cancelled"
    elif "error" in statuses:
        run.status = "error"
    elif "failed" in statuses:
        run.status = "failed"
    else:
        run.status = "passed"
    run.finished_at = now()
    emit(session, "run.updated", run_payload(run), run_id=run.id)


def _complete(session: Session, task: Task, outcome: TaskOutcome) -> None:
    task.status = outcome.status
    task.exit_code = outcome.exit_code
    task.error_code = outcome.error_code
    task.error_message = outcome.error_message
    task.finished_at = now()
    session.execute(delete(TestResult).where(TestResult.task_id == task.id))
    for case in outcome.cases:
        session.add(TestResult(
            task_id=task.id, run_id=task.run_id, device_serial=task.device_serial or "", flow_name=case.name,
            status=case.status, duration_ms=case.duration_ms, failure_message=case.failure_message,
        ))
    emit(session, "task.updated", task_payload(task), run_id=task.run_id)


def finish_task(session: Session, task_id: str, outcome: TaskOutcome, *, retry_backoff_sec: int = 0) -> Task:
    task = session.get(Task, task_id)
    if task is None:
        raise LookupError(task_id)
    run = session.get(Run, task.run_id)
    _release_device(session, task)
    if task.status in TERMINAL_STATUSES:
        return task  # already terminated elsewhere (for example by the sweeper)
    retry = (
        outcome.status == "error"
        and outcome.error_code in INFRA_ERROR_CODES
        and task.attempt < MAX_ATTEMPTS
        and not task.cancel_requested
        and not run.cancel_requested
    )
    if retry:
        task.status = "queued"
        task.attempt += 1
        task.started_at = None
        task.not_before = shift(now(), retry_backoff_sec) if retry_backoff_sec > 0 else None
        task.exit_code = outcome.exit_code
        task.error_code = outcome.error_code
        task.error_message = outcome.error_message
        if not task.pinned:
            task.device_serial = None
        emit(session, "task.updated", task_payload(task), run_id=task.run_id)
        return task
    _complete(session, task, outcome)
    finalize_run_if_done(session, run)
    return task


def terminate_task(session: Session, task: Task, status: str, error_code: str | None = None,
                   error_message: str | None = None) -> None:
    _complete(session, task, TaskOutcome(status, error_code=error_code, error_message=error_message))
    finalize_run_if_done(session, session.get(Run, task.run_id))


def requeue_after_precheck(session: Session, task_id: str, reason: str) -> Task:
    task = session.get(Task, task_id)
    if task is None:
        raise LookupError(task_id)
    device = session.get(Device, task.device_serial) if task.device_serial else None
    if device is not None and device.current_task_id == task.id:
        device.current_task_id = None
        set_device_state(session, device, "unhealthy", reason)
    if task.status == "running":
        task.status = "queued"
        task.started_at = None
        if not task.pinned:
            task.device_serial = None
        emit(session, "task.updated", task_payload(task), run_id=task.run_id)
    return task


def cancel_run(session: Session, run_id: str) -> Run:
    run = session.get(Run, run_id)
    if run is None:
        raise LookupError(run_id)
    if run.status in TERMINAL_STATUSES:
        return run
    run.cancel_requested = True
    active = list(session.scalars(select(Task).where(Task.run_id == run.id, Task.status.in_(("queued", "running")))))
    for task in active:
        if task.status == "queued":
            task.status = "cancelled"
            task.finished_at = now()
        else:
            task.cancel_requested = True
        emit(session, "task.updated", task_payload(task), run_id=run.id)
    emit(session, "run.updated", run_payload(run), run_id=run.id)
    finalize_run_if_done(session, run)
    return run


def is_cancel_requested(session: Session, task_id: str) -> bool:
    task = session.get(Task, task_id)
    return task is None or bool(task.cancel_requested) or task.status != "running"
