from sqlalchemy import select
from sqlalchemy.orm import Session

from farm.db.models import Device, DeviceCommand, Reservation, Run, Task
from farm.devices.state import idle_state, set_device_state
from farm.events import emit
from farm.scheduler.finish import finalize_run_if_done
from farm.scheduler.payloads import run_payload, task_payload
from farm.timeutil import now, shift

UNRESERVABLE_STATES = ("offline", "unhealthy", "disabled")


class ReservationError(ValueError):
    def __init__(self, code: str, message: str, holder: str | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.holder = holder


def _payload(res: Reservation) -> dict:
    return {"id": res.id, "device_serial": res.device_serial, "holder_name": res.holder_name,
            "status": res.status, "expires_at": res.expires_at}


def create_reservation(session: Session, serial: str, holder_name: str, ttl_sec: int) -> Reservation:
    device = session.get(Device, serial)
    if device is None:
        raise ReservationError("device_not_found", f"device {serial} not found")
    if device.disabled or device.state in UNRESERVABLE_STATES:
        raise ReservationError("device_unavailable", f"device {serial} is {device.state}")
    if device.reservation_id:
        current = session.get(Reservation, device.reservation_id)
        holder = current.holder_name if current else None
        raise ReservationError("already_reserved", f"device {serial} is reserved by {holder}", holder=holder)
    ts = now()
    res = Reservation(device_serial=serial, holder_name=holder_name, status="active", created_at=ts,
                      expires_at=shift(ts, ttl_sec))
    session.add(res)
    session.flush()
    device.reservation_id = res.id
    if device.state == "available":
        set_device_state(session, device, "reserved")
    emit(session, "reservation.updated", _payload(res))
    return res


def _get(session: Session, reservation_id: str) -> Reservation:
    res = session.get(Reservation, reservation_id)
    if res is None:
        raise ReservationError("reservation_not_found", f"reservation {reservation_id} not found")
    return res


def renew_reservation(session: Session, reservation_id: str, ttl_sec: int) -> Reservation:
    res = _get(session, reservation_id)
    if res.status != "active":
        raise ReservationError("reservation_not_active", f"reservation {reservation_id} is {res.status}")
    res.expires_at = shift(now(), ttl_sec)
    emit(session, "reservation.updated", _payload(res))
    return res


def release_reservation(session: Session, reservation_id: str, status: str = "released") -> Reservation:
    res = _get(session, reservation_id)
    if res.status != "active":
        return res
    ts = now()
    res.status = status
    res.released_at = ts
    device = session.get(Device, res.device_serial)
    if device is not None and device.reservation_id == res.id:
        device.reservation_id = None
        if device.state == "reserved":
            set_device_state(session, device, idle_state(device))
    runs = list(session.scalars(select(Run).where(Run.reservation_id == res.id, Run.status.in_(("queued", "running")))))
    for run in runs:
        queued = list(session.scalars(select(Task).where(Task.run_id == run.id, Task.status == "queued")))
        if queued:
            run.cancel_requested = True
            emit(session, "run.updated", run_payload(run), run_id=run.id)
        for task in queued:
            task.status = "cancelled"
            task.finished_at = ts
            emit(session, "task.updated", task_payload(task), run_id=run.id)
        finalize_run_if_done(session, run)
    commands = session.scalars(
        select(DeviceCommand).where(DeviceCommand.reservation_id == res.id, DeviceCommand.status == "queued")
    )
    for cmd in list(commands):
        cmd.status = "error"
        cmd.error_message = "reservation released"
        cmd.finished_at = ts
        emit(session, "device_command.updated", {"id": cmd.id, "status": cmd.status})
    emit(session, "reservation.updated", _payload(res))
    return res


def expire_reservations(session: Session) -> list[str]:
    expired = list(session.scalars(
        select(Reservation.id).where(Reservation.status == "active", Reservation.expires_at < now())
    ))
    for reservation_id in expired:
        release_reservation(session, reservation_id, status="expired")
    return expired
