from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse

from farm.api.deps import get_db
from farm.api.errors import ApiError
from farm.db.models import Task

router = APIRouter()


def _get_task(request: Request, task_id: str) -> Task:
    with get_db(request).session() as s:
        task = s.get(Task, task_id)
    if task is None:
        raise ApiError(404, "task_not_found", f"task {task_id} not found")
    return task


@router.get("/tasks/{task_id}/artifacts")
def list_artifacts(task_id: str, request: Request) -> dict:
    task = _get_task(request, task_id)
    base = Path(task.artifacts_dir) if task.artifacts_dir else None
    files = []
    if base is not None and base.is_dir():
        files = [{"path": p.relative_to(base).as_posix(), "size": p.stat().st_size}
                 for p in sorted(base.rglob("*")) if p.is_file()]
    return {"task_id": task_id, "attempt": task.attempt, "files": files}


@router.get("/tasks/{task_id}/artifacts/{path:path}")
def get_artifact(task_id: str, path: str, request: Request) -> FileResponse:
    task = _get_task(request, task_id)
    if not task.artifacts_dir:
        raise ApiError(404, "artifact_not_found", path)
    base = Path(task.artifacts_dir).resolve()
    target = (base / path).resolve()
    if not target.is_relative_to(base) or not target.is_file():
        raise ApiError(404, "artifact_not_found", path)
    return FileResponse(target)
