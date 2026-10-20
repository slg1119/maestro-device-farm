from pathlib import Path

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from farm.api.deps import get_db, get_settings, require_token
from farm.api.errors import ApiError
from farm.db.models import ApiToken, Device, DeviceCommand, Reservation, Task
from farm.devices.registry import effective_state, last_heartbeat
from farm.devices.state import set_device_state
from farm.events import emit
from farm.scheduler.commands import CommandError, create_inspect_command
from farm.scheduler.reservations import (
    ReservationError,
    create_reservation,
    release_reservation,
    renew_reservation,
)

router = APIRouter()
COMMAND_FILES = ("screen.png", "hierarchy.json")


class ReservationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    device_serial: str
    holder_name: str
    status: str
    created_at: str
    expires_at: str
    released_at: str | None


class DeviceOut(BaseModel):
    serial: str
    platform: str
    model: str
    manufacturer: str
    os_version: str
    sdk_int: int
    battery: int | None
    tags: list[str]
    state: str
    state_reason: str
    disabled: bool
    last_seen_at: str | None
    current_task_id: str | None
    current_run_id: str | None
    reservation: ReservationOut | None


class DevicePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tags: list[str] | None = None
    disabled: bool | None = None


class ReservationCreate(BaseModel):
    holder_name: str = Field(min_length=1, max_length=100)


class CommandOut(BaseModel):
    id: str
    device_serial: str
    reservation_id: str
    kind: str
    status: str
    error_message: str | None
    created_at: str
    finished_at: str | None
    files: dict[str, str]


def _device_out(session: Session, device: Device, heartbeat_at: str | None) -> DeviceOut:
    reservation = session.get(Reservation, device.reservation_id) if device.reservation_id else None
    task = session.get(Task, device.current_task_id) if device.current_task_id else None
    return DeviceOut(
        serial=device.serial, platform=device.platform, model=device.model, manufacturer=device.manufacturer,
        os_version=device.os_version, sdk_int=device.sdk_int, battery=device.battery, tags=list(device.tags or []),
        state=effective_state(device, heartbeat_at), state_reason=device.state_reason, disabled=bool(device.disabled),
        last_seen_at=device.last_seen_at, current_task_id=device.current_task_id,
        current_run_id=task.run_id if task else None,
        reservation=ReservationOut.model_validate(reservation) if reservation else None,
    )


def _reservation_error(exc: ReservationError) -> ApiError:
    status = 404 if exc.code.endswith("not_found") else 409
    extra = {"holder": exc.holder} if exc.holder else {}
    return ApiError(status, exc.code, str(exc), **extra)


@router.get("/devices")
def list_devices(request: Request) -> list[DeviceOut]:
    with get_db(request).session() as s:
        heartbeat_at = last_heartbeat(s)
        return [_device_out(s, device, heartbeat_at) for device in s.scalars(select(Device).order_by(Device.serial))]


@router.patch("/devices/{serial}")
def patch_device(serial: str, body: DevicePatch, request: Request,
                 _token: ApiToken = Depends(require_token)) -> DeviceOut:
    with get_db(request).session() as s:
        device = s.get(Device, serial)
        if device is None:
            raise ApiError(404, "device_not_found", f"device {serial} not found")
        if body.tags is not None:
            device.tags = sorted(set(body.tags))
        if body.disabled is True and not device.disabled:
            device.disabled = True
            if device.state != "busy":
                set_device_state(s, device, "disabled")
        elif body.disabled is False and device.disabled:
            device.disabled = False
            if device.state == "disabled":
                set_device_state(s, device, "offline", "re-enabled; waiting for the agent")
        emit(s, "device.updated", {"serial": device.serial, "state": device.state, "reason": device.state_reason})
        return _device_out(s, device, last_heartbeat(s))


@router.post("/devices/{serial}/reservations", status_code=201)
def reserve_device(serial: str, body: ReservationCreate, request: Request,
                   _token: ApiToken = Depends(require_token)) -> ReservationOut:
    ttl = get_settings(request).reservation_ttl_sec
    try:
        with get_db(request).session() as s:
            return ReservationOut.model_validate(create_reservation(s, serial, body.holder_name, ttl))
    except ReservationError as exc:
        raise _reservation_error(exc) from exc


@router.post("/reservations/{reservation_id}/renew")
def renew(reservation_id: str, request: Request, _token: ApiToken = Depends(require_token)) -> ReservationOut:
    ttl = get_settings(request).reservation_ttl_sec
    try:
        with get_db(request).session() as s:
            return ReservationOut.model_validate(renew_reservation(s, reservation_id, ttl))
    except ReservationError as exc:
        raise _reservation_error(exc) from exc


@router.delete("/reservations/{reservation_id}")
def release(reservation_id: str, request: Request, _token: ApiToken = Depends(require_token)) -> ReservationOut:
    try:
        with get_db(request).session() as s:
            return ReservationOut.model_validate(release_reservation(s, reservation_id))
    except ReservationError as exc:
        raise _reservation_error(exc) from exc


@router.post("/reservations/{reservation_id}/inspect", status_code=202)
def request_inspect(reservation_id: str, request: Request, _token: ApiToken = Depends(require_token)) -> dict:
    try:
        with get_db(request).session() as s:
            return {"id": create_inspect_command(s, reservation_id).id}
    except CommandError as exc:
        raise ApiError(409, exc.code, str(exc)) from exc


def _get_command(request: Request, command_id: str) -> DeviceCommand:
    with get_db(request).session() as s:
        command = s.get(DeviceCommand, command_id)
    if command is None:
        raise ApiError(404, "command_not_found", f"command {command_id} not found")
    return command


@router.get("/device-commands/{command_id}")
def get_command(command_id: str, request: Request) -> CommandOut:
    command = _get_command(request, command_id)
    files = {}
    if command.status == "done" and command.result_dir:
        files = {name: f"/api/v1/device-commands/{command_id}/files/{name}"
                 for name in COMMAND_FILES if (Path(command.result_dir) / name).is_file()}
    return CommandOut(
        id=command.id, device_serial=command.device_serial, reservation_id=command.reservation_id, kind=command.kind,
        status=command.status, error_message=command.error_message, created_at=command.created_at,
        finished_at=command.finished_at, files=files,
    )


@router.get("/device-commands/{command_id}/files/{name}")
def get_command_file(command_id: str, name: str, request: Request) -> FileResponse:
    command = _get_command(request, command_id)
    path = Path(command.result_dir) / name if command.result_dir else None
    if name not in COMMAND_FILES or path is None or not path.is_file():
        raise ApiError(404, "file_not_found", f"{name} not found for command {command_id}")
    return FileResponse(path)
