from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select

from farm.ai.client import OpenAiClient
from farm.ai.jobs import AiJobRunner, JobRequest, create_job, updated
from farm.api.deps import Writer, get_db, get_settings, get_writer
from farm.api.errors import ApiError
from farm.db.models import AiJob
from farm.timeutil import now
from farm.workspaces.errors import WorkspaceError
from farm.workspaces.registry import find_workspace

router = APIRouter()


def enabled(app) -> bool:
    return app.state.ai_client is not None or bool(app.state.settings.openai_api_key)


def ensure_runner(app):
    if not enabled(app):
        raise ApiError(503, "ai_disabled", "AI is not configured")
    with app.state.ai_runner_lock:
        if app.state.ai_runner is None:
            settings = app.state.settings
            client = app.state.ai_client or OpenAiClient(settings.openai_api_key.get_secret_value(), settings.openai_model)
            runner = AiJobRunner(app.state.db, settings, client, app.state.syntax_checker)
            runner.start()
            app.state.ai_runner = runner
        return app.state.ai_runner


def payload(job):
    fields = ("id", "kind", "status", "workspace_id", "base_sha", "source_task_id", "prompt", "attempts",
              "result", "model", "input_tokens", "output_tokens", "error_message", "created_by", "author_name",
              "created_at", "finished_at")
    result = {field: getattr(job, field) for field in fields}
    result["options"] = {key: job.options.get(key) for key in (
        "target_path", "include_screen", "auto_repair", "reservation_id", "app_build_id", "app")}
    return result


def get_job(session, job_id):
    job = session.get(AiJob, job_id)
    if job is None:
        raise ApiError(404, "ai_job_not_found", "AI job not found")
    return job


@router.get("/ai/status")
def status(request: Request):
    month = now()[:7]
    with get_db(request).session() as s:
        input_tokens, output_tokens, count = s.execute(select(
            func.coalesce(func.sum(AiJob.input_tokens), 0), func.coalesce(func.sum(AiJob.output_tokens), 0),
            func.count(AiJob.id)).where(AiJob.created_at.like(month + "-%"))).one()
    return {"enabled": enabled(request.app), "model": get_settings(request).openai_model, "month": month,
            "month_input_tokens": input_tokens, "month_output_tokens": output_tokens, "month_jobs": count}


@router.post("/ai/jobs", status_code=201)
def submit(request: Request, body: JobRequest, writer: Annotated[Writer, Depends(get_writer)]):
    runner = ensure_runner(request.app)
    job = create_job(get_db(request), get_settings(request), writer, body)
    runner.submit(job.id)
    return payload(job)


@router.get("/ai/jobs")
def list_jobs(request: Request, workspace: str | None = None, limit: int = Query(20, ge=1, le=100)):
    with get_db(request).session() as s:
        query = select(AiJob)
        if workspace:
            try:
                ws = find_workspace(s, workspace)
            except WorkspaceError as exc:
                raise ApiError(exc.status, exc.code, str(exc)) from exc
            query = query.where(AiJob.workspace_id == ws.id)
        return [payload(job) for job in s.scalars(query.order_by(AiJob.created_at.desc(), AiJob.id.desc()).limit(limit))]


@router.get("/ai/jobs/{job_id}")
def detail(request: Request, job_id: str):
    with get_db(request).session() as s:
        return payload(get_job(s, job_id))


@router.post("/ai/jobs/{job_id}/cancel")
def cancel(request: Request, job_id: str, writer: Annotated[Writer, Depends(get_writer)]):
    with get_db(request).session() as s:
        job = get_job(s, job_id)
        if job.status in {"queued", "running"}:
            job.cancel_requested = True
            if job.status == "queued":
                job.status, job.finished_at = "cancelled", now()
            updated(s, job)
        return payload(job)
