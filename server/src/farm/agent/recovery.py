from sqlalchemy import select
from sqlalchemy.orm import Session

from farm.db.models import Device, Task
from farm.devices.state import set_device_state
from farm.results import TaskOutcome
from farm.scheduler.commands import fail_running_commands
from farm.scheduler.finish import finish_task


def recover_after_restart(session: Session) -> list[str]:
    """Clean up what a previous agent left behind. Device states are rebuilt by the next adb poll."""
    running = list(session.scalars(select(Task).where(Task.status == "running")))
    for task in running:
        finish_task(session, task.id, TaskOutcome(
            "error", error_code="agent_restarted", error_message="agent restarted while the task was running"))
    fail_running_commands(session)
    for device in list(session.scalars(select(Device))):
        device.current_task_id = None
        if device.state != "disabled":
            set_device_state(session, device, "offline", "agent restarted")
    return [task.id for task in running]
