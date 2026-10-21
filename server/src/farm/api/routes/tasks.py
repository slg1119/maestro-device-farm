import mimetypes
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, Response

from farm.api.deps import get_db
from farm.api.errors import ApiError
from farm.db.models import Run, Task
from farm.runner.artifacts import EnvRedactor
from farm.runner.steps import parse_steps

router = APIRouter()


def _get_task(request: Request, task_id: str) -> Task:
    with get_db(request).session() as s:
        task = s.get(Task, task_id)
    if task is None:
        raise ApiError(404, "task_not_found", f"task {task_id} not found")
    return task


def _env_values(request: Request, task: Task) -> list[str]:
    with get_db(request).session() as s:
        run = s.get(Run, task.run_id)
        return list(run.env.values())


@router.get("/tasks/{task_id}/artifacts")
def list_artifacts(task_id: str, request: Request) -> dict:
    task = _get_task(request, task_id)
    base = Path(task.artifacts_dir) if task.artifacts_dir else None
    files = []
    if base is not None and base.is_dir():
        files = [{"path": p.relative_to(base).as_posix(), "size": p.stat().st_size}
                 for p in sorted(base.rglob("*")) if p.is_file()]
    return {"task_id": task_id, "attempt": task.attempt, "files": files}


@router.get("/tasks/{task_id}/steps")
def task_steps(task_id: str, request: Request) -> dict:
    task = _get_task(request, task_id)
    flows = parse_steps(Path(task.artifacts_dir), env_values=_env_values(request, task)) if task.artifacts_dir else []
    return {"task_id": task_id, "attempt": task.attempt, "flows": flows}


@router.get("/tasks/{task_id}/artifacts/{path:path}")
def get_artifact(task_id: str, path: str, request: Request) -> Response:
    task = _get_task(request, task_id)
    if not task.artifacts_dir:
        raise ApiError(404, "artifact_not_found", path)
    base = Path(task.artifacts_dir).resolve()
    target = (base / path).resolve()
    if not target.is_relative_to(base) or not target.is_file():
        raise ApiError(404, "artifact_not_found", path)
    # Old attempts and in-progress files may predate the writer-side scrub.
    text = EnvRedactor(_env_values(request, task)).read_text(target)
    if text is not None:
        return Response(text, media_type=mimetypes.guess_type(target.name)[0] or "text/plain")
    return FileResponse(target)
