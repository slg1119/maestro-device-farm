import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile as StarletteUploadFile

from farm.api.deps import Writer, get_db, get_settings, get_writer
from farm.api.errors import ApiError
from farm.api.uploads import MB, UploadTooLarge, save_upload
from farm.apps.apk import ApkParseError
from farm.apps.library import AppResolveError, ingest_apk, resolve_app
from farm.config import Settings
from farm.db.engine import Database
from farm.db.models import AppBuild, Device, Run, Task, TestResult, Workspace
from farm.flows.archive import UnsafeArchiveError, safe_extract_zip
from farm.ids import new_id
from farm.results import CaseResult
from farm.runner.junit import merge_junit
from farm.scheduler.finish import cancel_run
from farm.scheduler.rerun import prepare_rerun, rerun_run
from farm.scheduler.selector import DeviceSelector
from farm.scheduler.submit import RunRequest, SubmitError, create_run
from farm.workspaces.changes import MB as CHANGE_MB
from farm.workspaces.changes import Change, validate_changes
from farm.workspaces.errors import WorkspaceError
from farm.workspaces.git import SHA_RE
from farm.workspaces.registry import load_workspace, resolve_ref
from farm.workspaces.snapshot import apply_changes, snapshot_commit

router = APIRouter()
TASK_STATUSES = ("queued", "running", "passed", "failed", "error", "cancelled")
EXTRACT_RATIO = 4  # extracted flows may be at most 4x the upload limit (zip bomb guard)
OPTIONS_MEDIA_FILES = 4  # the options field may hold about this many max-size (base64) draft files


class RunOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["matrix", "split"]
    flow_source: Literal["upload", "workspace", "draft"] = "upload"
    workspace: str | None = None
    ref: str | None = None
    base_sha: str | None = Field(default=None, pattern=SHA_RE.pattern)
    changes: list[Change] | None = None
    device_selector: DeviceSelector = Field(default_factory=DeviceSelector)
    app_build_id: str | None = None
    app: str | None = None
    flow_paths: list[str] | None = None
    include_tags: list[str] = Field(default_factory=list)
    exclude_tags: list[str] = Field(default_factory=list)
    env: dict[str, str] = Field(default_factory=dict)
    ci_meta: dict[str, Any] = Field(default_factory=dict)
    task_timeout_sec: int | None = Field(default=None, gt=0)
    reservation_id: str | None = None
    origin: Literal["ci", "dashboard", "editor"] = "ci"

    @model_validator(mode="after")
    def _source_fields(self) -> "RunOptions":
        given = {name for name in ("workspace", "ref", "base_sha", "changes") if getattr(self, name) is not None}
        allowed = {"upload": set(), "workspace": {"workspace", "ref"},
                   "draft": {"workspace", "base_sha", "changes"}}[self.flow_source]
        required = {"upload": set(), "workspace": {"workspace"},
                    "draft": {"workspace", "base_sha", "changes"}}[self.flow_source]
        if given - allowed:
            raise ValueError(f"{', '.join(sorted(given - allowed))} not allowed with flow_source {self.flow_source}")
        if required - given:
            raise ValueError(f"flow_source {self.flow_source} needs {', '.join(sorted(required - given))}")
        return self


class RerunOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    failed_only: bool = False


class AppRef(BaseModel):
    id: str
    package_name: str
    version_name: str
    version_code: int


class RunSummary(BaseModel):
    id: str
    origin: str
    mode: str
    status: str
    flow_source: str
    created_by: str
    created_at: str
    started_at: str | None
    finished_at: str | None
    ci_meta: dict
    workspace_id: str | None
    ref: str | None
    commit_sha: str | None
    app: AppRef
    counts: dict[str, int]


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    seq: int
    device_serial: str | None
    pinned: bool
    flows: list[str]
    status: str
    attempt: int
    exit_code: int | None
    error_code: str | None
    error_message: str | None
    started_at: str | None
    finished_at: str | None


class CaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    task_id: str
    device_serial: str
    flow_name: str
    status: str
    duration_ms: int
    failure_message: str | None


class RunDetail(RunSummary):
    device_selector: dict
    flow_paths: list[str] | None
    include_tags: list[str]
    exclude_tags: list[str]
    env: dict[str, str]
    task_timeout_sec: int
    reservation_id: str | None
    cancel_requested: bool
    tasks: list[TaskOut]
    results: list[CaseOut]


def _counts(session: Session, run_ids: list[str]) -> dict[str, dict[str, int]]:
    counts = {run_id: {"total": 0, **{status: 0 for status in TASK_STATUSES}} for run_id in run_ids}
    rows = session.execute(
        select(Task.run_id, Task.status, func.count()).where(Task.run_id.in_(run_ids)).group_by(Task.run_id, Task.status)
    )
    for run_id, status, n in rows:
        counts[run_id][status] = n
        counts[run_id]["total"] += n
    return counts


def _summary(run: Run, app: AppBuild, counts: dict[str, int]) -> dict:
    return {
        "id": run.id, "origin": run.origin, "mode": run.mode, "status": run.status, "flow_source": run.flow_source,
        "created_by": run.created_by, "created_at": run.created_at, "started_at": run.started_at,
        "finished_at": run.finished_at, "ci_meta": run.ci_meta or {}, "workspace_id": run.workspace_id,
        "ref": run.ref, "commit_sha": run.commit_sha,
        "app": AppRef(id=app.id, package_name=app.package_name, version_name=app.version_name,
                      version_code=app.version_code),
        "counts": counts,
    }


@dataclass
class FlowSnapshot:
    root: Path
    workspace_id: str | None = None
    ref: str | None = None
    commit_sha: str | None = None


def _snapshot(db: Database, settings: Settings, opts: RunOptions, flows: StarletteUploadFile | None,
              upload_dir: Path) -> FlowSnapshot:
    """Builds the run's immutable flows directory from the chosen source (spec §5.1 step 2)."""
    limit = settings.max_flows_mb * MB * EXTRACT_RATIO
    if opts.flow_source == "upload":
        zip_path = save_upload(flows, upload_dir / "flows.zip", settings.max_flows_mb * MB)
        root = safe_extract_zip(zip_path, upload_dir / "flows", limit)
        zip_path.unlink()
        return FlowSnapshot(root)
    ws = load_workspace(db, opts.workspace or "")
    if opts.flow_source == "workspace":
        sha = resolve_ref(settings, ws, opts.ref)
        return FlowSnapshot(snapshot_commit(settings, ws, sha, upload_dir / "flows", limit), ws.id, opts.ref, sha)
    changes, issues = validate_changes(opts.changes or [], max_bytes=settings.max_media_mb * CHANGE_MB, checker=None)
    if issues:
        raise WorkspaceError(422, "invalid_flow", "some files are invalid",
                             issues=[issue.model_dump() for issue in issues])
    sha = resolve_ref(settings, ws, opts.base_sha)
    root = snapshot_commit(settings, ws, sha, upload_dir / "flows", limit, allow_missing=True)
    apply_changes(root, changes, max_bytes=limit)
    return FlowSnapshot(root, ws.id, None, sha)


def _get_run(session: Session, run_id: str) -> Run:
    run = session.get(Run, run_id)
    if run is None:
        raise ApiError(404, "run_not_found", f"run {run_id} not found")
    return run


RUN_FORM = {"requestBody": {"required": True, "content": {"multipart/form-data": {"schema": {
    "type": "object", "required": ["options"], "properties": {
        "options": {"type": "string", "description": "RunOptions as JSON"},
        "flows": {"type": "string", "format": "binary", "description": "flows zip (flow_source=upload)"},
        "apk": {"type": "string", "format": "binary"},
    }}}}}}


@router.post("/runs", status_code=201, openapi_extra=RUN_FORM)
async def submit_run(request: Request, writer: Writer = Depends(get_writer)) -> dict:
    # Parsed by hand: Starlette caps non-file form fields at 1 MB, and draft runs carry file contents in `options`.
    settings = get_settings(request)
    form = await request.form(max_part_size=OPTIONS_MEDIA_FILES * settings.max_media_mb * MB)
    try:
        options = form.get("options")
        if not isinstance(options, str):
            raise ApiError(400, "invalid_options", "the options form field is required")
        flows, apk = (form.get(name) for name in ("flows", "apk"))
        return await run_in_threadpool(
            _submit_run, request, writer, options,
            flows if isinstance(flows, StarletteUploadFile) else None,
            apk if isinstance(apk, StarletteUploadFile) else None,
        )
    finally:
        await form.close()


def _submit_run(request: Request, writer: Writer, options: str, flows: StarletteUploadFile | None,
                apk: StarletteUploadFile | None) -> dict:
    settings = get_settings(request)
    try:
        opts = RunOptions.model_validate_json(options)
    except ValidationError as exc:
        raise ApiError(400, "invalid_options", "options JSON is invalid", details=json.loads(exc.json())) from exc
    if sum(x is not None for x in (apk, opts.app_build_id, opts.app)) != 1:
        raise ApiError(400, "invalid_app", "specify exactly one of an apk upload, app_build_id or app")
    if opts.flow_source == "upload" and flows is None:
        raise ApiError(400, "flows_required", "a flows zip is required when flow_source is upload")
    if opts.flow_source != "upload" and flows is not None:
        raise ApiError(400, "invalid_flow_source", "a flows zip is only accepted when flow_source is upload")

    run_id = new_id()
    upload_dir = settings.path("uploads", run_id)
    tmp_apk = settings.path("tmp", f"{run_id}.apk")
    try:
        snapshot = _snapshot(get_db(request), settings, opts, flows, upload_dir)
        with get_db(request).session() as s:
            if apk is not None:
                tmp = save_upload(apk, tmp_apk, settings.max_apk_mb * MB)
                build, _ = ingest_apk(
                    s, settings.path("apks"), tmp, request.app.state.apk_parser,
                    source="ci" if opts.origin == "ci" else "dashboard", uploaded_by=writer.name,
                    ci_meta=opts.ci_meta,
                )
            else:
                build = resolve_app(s, app_build_id=opts.app_build_id, app_spec=opts.app)
            create_run(s, RunRequest(
                run_id=run_id, mode=opts.mode, selector=opts.device_selector, app_build=build,
                flows_dir=snapshot.root, flow_source=opts.flow_source, workspace_id=snapshot.workspace_id,
                ref=snapshot.ref, commit_sha=snapshot.commit_sha, flow_paths=opts.flow_paths, include_tags=opts.include_tags,
                exclude_tags=opts.exclude_tags, env=opts.env, ci_meta=opts.ci_meta,
                task_timeout_sec=opts.task_timeout_sec or settings.task_timeout_sec, origin=opts.origin,
                created_by=writer.name, reservation_id=opts.reservation_id,
            ))
    except UploadTooLarge as exc:
        shutil.rmtree(upload_dir, ignore_errors=True)
        raise ApiError(413, "upload_too_large", str(exc)) from exc
    except UnsafeArchiveError as exc:
        shutil.rmtree(upload_dir, ignore_errors=True)
        raise ApiError(400, "invalid_archive", str(exc)) from exc
    except ApkParseError as exc:
        shutil.rmtree(upload_dir, ignore_errors=True)
        raise ApiError(400, "invalid_apk", str(exc)) from exc
    except AppResolveError as exc:
        shutil.rmtree(upload_dir, ignore_errors=True)
        raise ApiError(404 if exc.code == "app_not_found" else 400, exc.code, str(exc)) from exc
    except SubmitError as exc:
        shutil.rmtree(upload_dir, ignore_errors=True)
        raise ApiError(400, exc.code, str(exc)) from exc
    except WorkspaceError as exc:
        shutil.rmtree(upload_dir, ignore_errors=True)
        raise ApiError(exc.status, exc.code, exc.message, **exc.extra) from exc
    except Exception:
        shutil.rmtree(upload_dir, ignore_errors=True)
        raise
    finally:
        tmp_apk.unlink(missing_ok=True)  # ingest_apk moves it on success; anything left is a failed upload
    return {"id": run_id, "url": f"{settings.public_url}/runs/{run_id}"}


@router.get("/runs")
def list_runs(
    request: Request,
    status: str | None = None,
    origin: str | None = None,
    workspace: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    before: str | None = None,
) -> list[RunSummary]:
    with get_db(request).session() as s:
        query = select(Run, AppBuild).join(AppBuild, Run.app_build_id == AppBuild.id)
        if status:
            query = query.where(Run.status == status)
        if origin:
            query = query.where(Run.origin == origin)
        if workspace:
            named = s.scalar(select(Workspace.id).where(Workspace.name == workspace))
            query = query.where(Run.workspace_id == (named or workspace))
        if before:
            anchor = s.get(Run, before)
            if anchor is None:
                raise ApiError(400, "invalid_cursor", f"run {before} not found")
            query = query.where(or_(Run.created_at < anchor.created_at,
                                    and_(Run.created_at == anchor.created_at, Run.id < anchor.id)))
        rows = s.execute(query.order_by(Run.created_at.desc(), Run.id.desc()).limit(limit)).all()
        counts = _counts(s, [run.id for run, _ in rows])
        return [RunSummary(**_summary(run, app, counts[run.id])) for run, app in rows]


@router.get("/runs/{run_id}")
def get_run(run_id: str, request: Request) -> RunDetail:
    with get_db(request).session() as s:
        run = _get_run(s, run_id)
        app = s.get(AppBuild, run.app_build_id)
        tasks = s.scalars(select(Task).where(Task.run_id == run_id).order_by(Task.seq))
        results = s.scalars(select(TestResult).where(TestResult.run_id == run_id)
                            .order_by(TestResult.device_serial, TestResult.flow_name))
        return RunDetail(
            **_summary(run, app, _counts(s, [run_id])[run_id]),
            device_selector=run.device_selector or {}, flow_paths=run.flow_paths, include_tags=run.include_tags or [],
            exclude_tags=run.exclude_tags or [], env={key: "***" for key in (run.env or {})},
            task_timeout_sec=run.task_timeout_sec, reservation_id=run.reservation_id,
            cancel_requested=bool(run.cancel_requested),
            tasks=[TaskOut.model_validate(t) for t in tasks], results=[CaseOut.model_validate(r) for r in results],
        )


@router.post("/runs/{run_id}/cancel")
def cancel(run_id: str, request: Request, _writer: Writer = Depends(get_writer)) -> RunSummary:
    with get_db(request).session() as s:
        _get_run(s, run_id)
        run = cancel_run(s, run_id)
        return RunSummary(**_summary(run, s.get(AppBuild, run.app_build_id), _counts(s, [run_id])[run_id]))


@router.post("/runs/{run_id}/rerun", status_code=201)
def rerun(run_id: str, options: RerunOptions, request: Request,
          writer: Annotated[Writer, Depends(get_writer)]) -> dict:
    settings, db = get_settings(request), get_db(request)
    upload_dir = None
    try:
        with db.session() as s:
            plan = prepare_rerun(s, settings, run_id, failed_only=options.failed_only)
        upload_dir = settings.path("uploads", plan.new_run_id)
        flows_dir = upload_dir / "flows"
        # No SQLite transaction is held during the potentially large snapshot copy.
        try:
            shutil.copytree(plan.flows_dir, flows_dir)
        except FileNotFoundError as exc:
            raise SubmitError("snapshot_purged", "the run snapshot is no longer available") from exc
        with db.session() as s:
            run = rerun_run(s, plan, flows_dir=flows_dir, created_by=writer.name)
    except SubmitError as exc:
        if upload_dir is not None:
            shutil.rmtree(upload_dir, ignore_errors=True)
        status = {"run_not_found": 404, "snapshot_purged": 409}.get(exc.code, 400)
        raise ApiError(status, exc.code, str(exc)) from exc
    except Exception:
        if upload_dir is not None:
            shutil.rmtree(upload_dir, ignore_errors=True)
        raise
    return {"id": run.id, "url": f"{settings.public_url}/runs/{run.id}"}


@router.get("/runs/{run_id}/junit")
def run_junit(run_id: str, request: Request) -> Response:
    with get_db(request).session() as s:
        _get_run(s, run_id)
        devices = {device.serial: device for device in s.scalars(select(Device))}
        grouped: dict[str, list[CaseResult]] = {}
        rows = s.scalars(select(TestResult).where(TestResult.run_id == run_id)
                         .order_by(TestResult.device_serial, TestResult.flow_name))
        for row in rows:
            grouped.setdefault(row.device_serial, []).append(
                CaseResult(row.flow_name, row.status, row.duration_ms, row.failure_message))
    suites = [(f"{devices[serial].model} ({serial})" if serial in devices else serial, cases)
              for serial, cases in grouped.items()]
    return Response(merge_junit(suites, name=f"run {run_id}"), media_type="application/xml")
