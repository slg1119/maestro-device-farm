from sqlalchemy import JSON, Boolean, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from farm.ids import new_id
from farm.timeutil import now


class Base(DeclarativeBase):
    pass


class Device(Base):
    __tablename__ = "devices"

    serial: Mapped[str] = mapped_column(String, primary_key=True)
    platform: Mapped[str] = mapped_column(String, default="android")
    model: Mapped[str] = mapped_column(String, default="")
    manufacturer: Mapped[str] = mapped_column(String, default="")
    os_version: Mapped[str] = mapped_column(String, default="")
    sdk_int: Mapped[int] = mapped_column(Integer, default=0)
    battery: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    state: Mapped[str] = mapped_column(String, default="offline")
    state_reason: Mapped[str] = mapped_column(String, default="")
    state_changed_at: Mapped[str] = mapped_column(String, default=now)
    # Maintenance request. The state becomes "disabled" once the device is not busy.
    disabled: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen_at: Mapped[str | None] = mapped_column(String, nullable=True)
    current_task_id: Mapped[str | None] = mapped_column(String, nullable=True)
    reservation_id: Mapped[str | None] = mapped_column(String, nullable=True)


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String, unique=True)
    repo: Mapped[str] = mapped_column(String)
    branch: Mapped[str] = mapped_column(String)
    path: Mapped[str] = mapped_column(String, default="")
    default_app_package: Mapped[str | None] = mapped_column(String, nullable=True)
    head_sha: Mapped[str | None] = mapped_column(String, nullable=True)
    synced_at: Mapped[str | None] = mapped_column(String, nullable=True)
    sync_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String, default=now)


class AppBuild(Base):
    __tablename__ = "app_builds"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    package_name: Mapped[str] = mapped_column(String, index=True)
    version_name: Mapped[str] = mapped_column(String, default="")
    version_code: Mapped[int] = mapped_column(Integer, default=0)
    min_sdk: Mapped[int] = mapped_column(Integer, default=0)
    label: Mapped[str] = mapped_column(String, default="")
    sha256: Mapped[str] = mapped_column(String, unique=True)
    file_path: Mapped[str] = mapped_column(String)
    size_bytes: Mapped[int] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String)
    ci_meta: Mapped[dict] = mapped_column(JSON, default=dict)
    uploaded_by: Mapped[str] = mapped_column(String, default="")
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    purged: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[str] = mapped_column(String, default=now)


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    origin: Mapped[str] = mapped_column(String)
    mode: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="queued", index=True)
    device_selector: Mapped[dict] = mapped_column(JSON, default=dict)
    app_build_id: Mapped[str] = mapped_column(ForeignKey("app_builds.id"))
    flow_source: Mapped[str] = mapped_column(String)
    flows_dir: Mapped[str] = mapped_column(String)
    flow_paths: Mapped[list | None] = mapped_column(JSON, nullable=True)
    include_tags: Mapped[list] = mapped_column(JSON, default=list)
    exclude_tags: Mapped[list] = mapped_column(JSON, default=list)
    env: Mapped[dict] = mapped_column(JSON, default=dict)
    ci_meta: Mapped[dict] = mapped_column(JSON, default=dict)
    task_timeout_sec: Mapped[int] = mapped_column(Integer)
    reservation_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    # No foreign key: unregistering a workspace keeps its runs.
    workspace_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    ref: Mapped[str | None] = mapped_column(String, nullable=True)
    commit_sha: Mapped[str | None] = mapped_column(String, nullable=True)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[str] = mapped_column(String, default="")
    artifacts_purged: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[str] = mapped_column(String, default=now)
    started_at: Mapped[str | None] = mapped_column(String, nullable=True)
    finished_at: Mapped[str | None] = mapped_column(String, nullable=True)


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), index=True)
    seq: Mapped[int] = mapped_column(Integer)
    device_serial: Mapped[str | None] = mapped_column(String, nullable=True)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    flows: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String, default="queued", index=True)
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    not_before: Mapped[str | None] = mapped_column(String, nullable=True)
    exit_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    artifacts_dir: Mapped[str | None] = mapped_column(String, nullable=True)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    interfered: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("0"))
    created_at: Mapped[str] = mapped_column(String, default=now)
    started_at: Mapped[str | None] = mapped_column(String, nullable=True)
    finished_at: Mapped[str | None] = mapped_column(String, nullable=True)


class TestResult(Base):
    __tablename__ = "test_results"
    __test__ = False  # stop pytest from collecting this class when a test imports it

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id"), index=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id"), index=True)
    device_serial: Mapped[str] = mapped_column(String)
    flow_name: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    failure_message: Mapped[str | None] = mapped_column(Text, nullable=True)


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[str] = mapped_column(String, default=now)
    type: Mapped[str] = mapped_column(String)
    run_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)


class AiJob(Base):
    __tablename__ = "ai_jobs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    kind: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="queued", index=True)
    workspace_id: Mapped[str] = mapped_column(String, index=True)
    base_sha: Mapped[str] = mapped_column(String)
    reservation_id: Mapped[str | None] = mapped_column(String, nullable=True)
    source_task_id: Mapped[str | None] = mapped_column(String, nullable=True)
    prompt: Mapped[str] = mapped_column(Text)
    options: Mapped[dict] = mapped_column(JSON, default=dict)
    attempts: Mapped[list] = mapped_column(JSON, default=list)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    model: Mapped[str] = mapped_column(String)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[str] = mapped_column(String, default="")
    author_name: Mapped[str] = mapped_column(String, default="")
    prompt_purged: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[str] = mapped_column(String, default=now, index=True)
    finished_at: Mapped[str | None] = mapped_column(String, nullable=True)


class ApiToken(Base):
    __tablename__ = "api_tokens"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String, unique=True)
    token_hash: Mapped[str] = mapped_column(String, unique=True)
    created_at: Mapped[str] = mapped_column(String, default=now)
    last_used_at: Mapped[str | None] = mapped_column(String, nullable=True)


class AgentStatus(Base):
    __tablename__ = "agent_status"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    version: Mapped[str] = mapped_column(String)
    started_at: Mapped[str] = mapped_column(String)
    last_heartbeat_at: Mapped[str] = mapped_column(String)


class Reservation(Base):
    __tablename__ = "reservations"
    __table_args__ = (
        Index(
            "uq_reservations_active_device",
            "device_serial",
            unique=True,
            sqlite_where=text("status = 'active'"),
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    device_serial: Mapped[str] = mapped_column(String)
    holder_name: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="active")
    created_at: Mapped[str] = mapped_column(String, default=now)
    expires_at: Mapped[str] = mapped_column(String)
    released_at: Mapped[str | None] = mapped_column(String, nullable=True)


class DeviceCommand(Base):
    __tablename__ = "device_commands"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    device_serial: Mapped[str] = mapped_column(String, index=True)
    reservation_id: Mapped[str] = mapped_column(String)
    kind: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="queued")
    result_dir: Mapped[str | None] = mapped_column(String, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String, default=now)
    finished_at: Mapped[str | None] = mapped_column(String, nullable=True)


class StreamTicket(Base):
    __tablename__ = "stream_tickets"

    ticket_hash: Mapped[str] = mapped_column(String, primary_key=True)
    device_serial: Mapped[str] = mapped_column(String)
    actor: Mapped[str] = mapped_column(String)
    author_name: Mapped[str] = mapped_column(String, default="")
    expires_at: Mapped[str] = mapped_column(String)
    used_at: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[str] = mapped_column(String, default=now)


class Recording(Base):
    __tablename__ = "recordings"
    __table_args__ = (
        Index(
            "uq_recordings_active_device", "device_serial", unique=True,
            sqlite_where=text("status IN ('active', 'stopping')"),
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    device_serial: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="active")
    include_launch_app: Mapped[bool] = mapped_column(Boolean, default=True)
    app_package: Mapped[str | None] = mapped_column(String, nullable=True)
    workspace_id: Mapped[str | None] = mapped_column(String, nullable=True)
    steps: Mapped[list] = mapped_column(JSON, default=list)
    yaml: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_job_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_by: Mapped[str] = mapped_column(String, default="")
    created_at: Mapped[str] = mapped_column(String, default=now)
    finished_at: Mapped[str | None] = mapped_column(String, nullable=True)
