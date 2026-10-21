from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from farm.api.deps import Writer, get_db, get_settings, get_writer
from farm.api.errors import ApiError
from farm.api.routes.ai import ensure_runner
from farm.db.models import Device, Recording
from farm.devices.registry import effective_state, last_heartbeat
from farm.stream.recorder import finalize_recording, recording_updated
from farm.timeutil import now
from farm.workspaces.errors import WorkspaceError
from farm.workspaces.registry import find_workspace

router = APIRouter()


class StartRecording(BaseModel):
    model_config = ConfigDict(extra="forbid")
    include_launch_app: bool
    workspace: str | None = None
    app_package: str | None = Field(default=None, min_length=1, max_length=255)


class StopRecording(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ai_polish: bool = False


def payload(row):
    return {column.name: getattr(row, column.name) for column in Recording.__table__.columns}


def get_recording(session, recording_id):
    row = session.get(Recording, recording_id)
    if row is None:
        raise ApiError(404, "recording_not_found", "녹화를 찾을 수 없습니다")
    return row


@router.post("/devices/{serial}/recordings", status_code=201)
def start(serial: str, body: StartRecording, request: Request, writer: Annotated[Writer, Depends(get_writer)]):
    try:
        with get_db(request).session() as session:
            device = session.get(Device, serial)
            if device is None:
                raise ApiError(404, "device_not_found", "기기를 찾을 수 없습니다")
            if effective_state(device, last_heartbeat(session)) in {"offline", "unauthorized"}:
                raise ApiError(409, "device_unavailable", "연결된 기기에서 녹화를 시작해 주세요")
            if session.scalar(select(Recording.id).where(
                Recording.device_serial == serial, Recording.status.in_(["active", "stopping"]))):
                raise ApiError(409, "recording_active", "이미 진행 중인 녹화가 있습니다")
            try:
                workspace = find_workspace(session, body.workspace) if body.workspace else None
            except WorkspaceError as exc:
                raise ApiError(exc.status, exc.code, str(exc)) from exc
            package = body.app_package or (workspace.default_app_package if workspace else None)
            ts = now()
            row = Recording(device_serial=serial, include_launch_app=body.include_launch_app, app_package=package,
                            workspace_id=workspace.id if workspace else None, created_by=writer.name,
                            created_at=ts, steps=[{"kind": "launch", "ts": ts}] if body.include_launch_app and package else [])
            session.add(row)
            session.flush()
            recording_updated(session, row)
            return payload(row)
    except IntegrityError as exc:
        raise ApiError(409, "recording_active", "이미 진행 중인 녹화가 있습니다") from exc


@router.get("/recordings/{recording_id}")
def detail(recording_id: str, request: Request):
    with get_db(request).session() as session:
        return payload(get_recording(session, recording_id))


@router.get("/devices/{serial}/recordings")
def list_recordings(serial: str, request: Request,
                    status: Literal["active", "stopping", "done", "cancelled"] | None = None):
    with get_db(request).session() as session:
        query = select(Recording).where(Recording.device_serial == serial)
        if status:
            query = query.where(Recording.status == status)
        return [payload(row) for row in session.scalars(query.order_by(Recording.created_at.desc(), Recording.id.desc()))]


@router.post("/recordings/{recording_id}/stop")
def stop(recording_id: str, body: StopRecording, request: Request, writer: Annotated[Writer, Depends(get_writer)]):
    runner = ensure_runner(request.app) if body.ai_polish else None
    job_id = None
    with get_db(request).session() as session:
        row = get_recording(session, recording_id)
        if row.status == "cancelled":
            raise ApiError(409, "recording_cancelled", "취소된 녹화입니다")
        finalize_recording(session, row)
        if runner and not row.ai_job_id:
            from farm.ai.jobs import create_record_job

            job = create_record_job(session, get_settings(request), writer, row, getattr(runner.client, "model", None))
            row.ai_job_id = job_id = job.id
            recording_updated(session, row)
        result = payload(row)
    if job_id:
        runner.submit(job_id)
    return result


@router.delete("/recordings/{recording_id}")
def cancel(recording_id: str, request: Request, writer: Annotated[Writer, Depends(get_writer)]):
    with get_db(request).session() as session:
        row = get_recording(session, recording_id)
        if row.status == "done":
            raise ApiError(409, "recording_finished", "완료된 녹화입니다")
        if row.status != "cancelled":
            row.status, row.finished_at = "cancelled", now()
            recording_updated(session, row)
        return payload(row)
