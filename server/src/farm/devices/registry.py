from sqlalchemy import func, select
from sqlalchemy.orm import Session

from farm.db.models import AgentStatus, Device
from farm.devices.provider import DeviceInfo
from farm.devices.state import idle_state, set_device_state
from farm.timeutil import age_seconds, now

HEARTBEAT_STALE_SEC = 15


def _apply_info(device: Device, info: DeviceInfo, ts: str) -> None:
    device.model = info.model or device.model or ""
    device.manufacturer = info.manufacturer or device.manufacturer or ""
    device.os_version = info.os_version or device.os_version or ""
    if info.sdk_int:
        device.sdk_int = info.sdk_int
    if info.battery is not None:
        device.battery = info.battery
    device.last_seen_at = ts


def _mark_absent(session: Session, device: Device, reason: str) -> None:
    if device.disabled:
        set_device_state(session, device, "disabled")
    else:
        set_device_state(session, device, "offline", reason)


def sync_devices(session: Session, infos: list[DeviceInfo]) -> set[str]:
    ts = now()
    seen = {info.serial: info for info in infos}
    devices = {device.serial: device for device in session.scalars(select(Device))}
    connected: set[str] = set()
    for serial, info in seen.items():
        device = devices.get(serial)
        if device is None:
            device = Device(serial=serial, state="offline", state_reason="", state_changed_at=ts, tags=[],
                            disabled=False)
            session.add(device)
            devices[serial] = device
        if info.adb_state != "device":
            _mark_absent(session, device, f"adb: {info.adb_state}")
            continue
        connected.add(serial)
        _apply_info(device, info, ts)
        if device.disabled:
            if device.state != "busy":
                set_device_state(session, device, "disabled")
        elif device.state in ("offline", "disabled"):
            set_device_state(session, device, idle_state(device))
    for serial, device in devices.items():
        if serial not in seen:
            _mark_absent(session, device, "disconnected")
    return connected


def mark_healthy(session: Session, serial: str) -> bool:
    device = session.get(Device, serial)
    if device is None or device.state != "unhealthy":
        return False
    set_device_state(session, device, idle_state(device))
    return True


def unhealthy_serials(session: Session) -> list[str]:
    return list(session.scalars(select(Device.serial).where(Device.state == "unhealthy").order_by(Device.serial)))


def heartbeat(session: Session, agent_id: str, version: str, started_at: str) -> None:
    row = session.get(AgentStatus, agent_id)
    ts = now()
    if row is None:
        session.add(AgentStatus(id=agent_id, version=version, started_at=started_at, last_heartbeat_at=ts))
    else:
        row.version = version
        row.started_at = started_at
        row.last_heartbeat_at = ts


def last_heartbeat(session: Session) -> str | None:
    return session.scalar(select(func.max(AgentStatus.last_heartbeat_at)))


def effective_state(device: Device, last_heartbeat_at: str | None, ref: str | None = None) -> str:
    """What the API reports: every device looks offline while the agent is not heartbeating."""
    if last_heartbeat_at is None or age_seconds(last_heartbeat_at, ref) > HEARTBEAT_STALE_SEC:
        return "offline"
    return device.state
