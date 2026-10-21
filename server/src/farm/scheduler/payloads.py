from farm.db.models import Run, Task


def run_payload(run: Run) -> dict:
    return {"id": run.id, "status": run.status, "cancel_requested": bool(run.cancel_requested)}


def task_payload(task: Task) -> dict:
    return {
        "id": task.id, "run_id": task.run_id, "status": task.status, "device_serial": task.device_serial,
        "attempt": task.attempt, "error_code": task.error_code, "interfered": bool(task.interfered),
    }
