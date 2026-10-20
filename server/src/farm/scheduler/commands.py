from sqlalchemy import select
from sqlalchemy.orm import Session

from farm.db.models import Device, DeviceCommand, Reservation
from farm.events import emit
from farm.timeutil import now


class CommandError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _emit(session: Session, cmd: DeviceCommand) -> None:
    emit(session, "device_command.updated", {"id": cmd.id, "status": cmd.status, "device_serial": cmd.device_serial})


def create_inspect_command(session: Session, reservation_id: str) -> DeviceCommand:
    res = session.get(Reservation, reservation_id)
    if res is None or res.status != "active":
        raise CommandError("reservation_not_active", f"reservation {reservation_id} is not active")
    cmd = DeviceCommand(device_serial=res.device_serial, reservation_id=res.id, kind="inspect", status="queued")
    session.add(cmd)
    session.flush()
    _emit(session, cmd)
    return cmd


def claim_command(session: Session, serial: str) -> DeviceCommand | None:
    device = session.get(Device, serial)
    if device is None or not device.reservation_id or device.current_task_id is not None:
        return None
    cmd = session.scalar(
        select(DeviceCommand)
        .where(DeviceCommand.device_serial == serial, DeviceCommand.reservation_id == device.reservation_id,
               DeviceCommand.status == "queued")
        .order_by(DeviceCommand.created_at, DeviceCommand.id)
        .limit(1)
    )
    if cmd is not None:
        cmd.status = "running"
        _emit(session, cmd)
    return cmd


def finish_command(session: Session, command_id: str, *, ok: bool, result_dir: str | None = None,
                   error: str | None = None) -> None:
    cmd = session.get(DeviceCommand, command_id)
    if cmd is None:
        raise LookupError(command_id)
    cmd.status = "done" if ok else "error"
    cmd.result_dir = result_dir
    cmd.error_message = error
    cmd.finished_at = now()
    _emit(session, cmd)


def fail_running_commands(session: Session) -> int:
    running = list(session.scalars(select(DeviceCommand).where(DeviceCommand.status == "running")))
    for cmd in running:
        finish_command(session, cmd.id, ok=False, error="agent restarted")
    return len(running)
