from sqlalchemy.orm import Session

from farm.db.models import Device
from farm.events import emit
from farm.timeutil import now


def idle_state(device: Device) -> str:
    """State of a connected device that is not running a task."""
    if device.disabled:
        return "disabled"
    return "reserved" if device.reservation_id else "available"


def set_device_state(session: Session, device: Device, state: str, reason: str = "") -> None:
    if device.state == state and device.state_reason == reason:
        return
    device.state = state
    device.state_reason = reason
    device.state_changed_at = now()
    emit(session, "device.updated", {"serial": device.serial, "state": state, "reason": reason})
