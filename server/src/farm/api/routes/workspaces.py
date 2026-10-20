import mimetypes
from collections.abc import Iterator
from contextlib import contextmanager

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from farm.api.deps import get_db, get_settings, require_token
from farm.api.errors import ApiError
from farm.db.models import ApiToken
from farm.workspaces.changes import MB, Change, validate_changes
from farm.workspaces.commit import CommitRequest, RestoreRequest, commit_changes, restore
from farm.workspaces.errors import WorkspaceError
from farm.workspaces.git import GitError
from farm.workspaces.paths import InvalidPath, normalize_rel, repo_path, strip_root
from farm.workspaces.registry import (
    create_workspace,
    delete_workspace,
    list_workspaces,
    load_workspace,
    open_repo,
    serving_sha,
    sync_workspace,
    update_workspace,
)

router = APIRouter()
TEXT_SUFFIXES = (".yaml", ".yml", ".js", ".json", ".md", ".txt")
DIFF_STATUS = {"A": "added", "M": "modified", "D": "deleted", "T": "modified"}


class WorkspaceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    repo: str
    branch: str
    path: str
    default_app_package: str | None
    head_sha: str | None
    synced_at: str | None
    sync_error: str | None
    created_at: str


class WorkspaceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    repo: str
    branch: str = "main"
    path: str = ""
    default_app_package: str | None = None


class WorkspacePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    branch: str | None = None
    path: str | None = None
    default_app_package: str | None = None


class ValidateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    changes: list[Change] = Field(min_length=1)


@contextmanager
def workspace_errors() -> Iterator[None]:
    try:
        yield
    except WorkspaceError as exc:
        raise ApiError(exc.status, exc.code, exc.message, **exc.extra) from exc
    except InvalidPath as exc:
        raise ApiError(400, "invalid_path", str(exc)) from exc
    except GitError as exc:
        raise ApiError(502, "git_unavailable", str(exc)) from exc


@router.get("/workspaces")
def list_all(request: Request) -> list[WorkspaceOut]:
    return [WorkspaceOut.model_validate(ws) for ws in list_workspaces(get_db(request))]


@router.post("/workspaces", status_code=201)
def create(body: WorkspaceCreate, request: Request, _token: ApiToken = Depends(require_token)) -> WorkspaceOut:
    with workspace_errors():
        ws = create_workspace(get_db(request), get_settings(request), **body.model_dump())
    return WorkspaceOut.model_validate(ws)


@router.get("/workspaces/{key}")
def get_one(key: str, request: Request) -> WorkspaceOut:
    with workspace_errors():
        return WorkspaceOut.model_validate(load_workspace(get_db(request), key))


@router.patch("/workspaces/{key}")
def patch(key: str, body: WorkspacePatch, request: Request, _token: ApiToken = Depends(require_token)) -> WorkspaceOut:
    with workspace_errors():
        ws = update_workspace(get_db(request), get_settings(request), key, body.model_dump(exclude_unset=True))
    return WorkspaceOut.model_validate(ws)


@router.delete("/workspaces/{key}", status_code=204)
def delete(key: str, request: Request, _token: ApiToken = Depends(require_token)) -> Response:
    with workspace_errors():
        delete_workspace(get_db(request), key)
    return Response(status_code=204)


@router.post("/workspaces/{key}/sync")
def sync(key: str, request: Request, _token: ApiToken = Depends(require_token)) -> WorkspaceOut:
    with workspace_errors():
        return WorkspaceOut.model_validate(sync_workspace(get_db(request), get_settings(request), key))


@router.get("/workspaces/{key}/tree")
def tree(key: str, request: Request, ref: str | None = None) -> dict:
    settings = get_settings(request)
    with workspace_errors():
        ws = load_workspace(get_db(request), key)
        sha = serving_sha(settings, ws, ref)
        entries = open_repo(settings, ws.repo).tree(sha, ws.path)
    return {"sha": sha, "files": [{"path": e.path, "size": e.size} for e in entries]}


@router.get("/workspaces/{key}/files/{path:path}")
def read_file(key: str, path: str, request: Request, ref: str | None = None) -> Response:
    settings = get_settings(request)
    with workspace_errors():
        ws = load_workspace(get_db(request), key)
        rel = normalize_rel(path)
        sha = serving_sha(settings, ws, ref)
        data = open_repo(settings, ws.repo).read_blob(sha, repo_path(ws.path, rel))
    if data is None:
        raise ApiError(404, "file_not_found", f"{rel} does not exist at {sha[:7]}")
    if rel.endswith(TEXT_SUFFIXES):
        media_type = "text/plain; charset=utf-8"
    else:
        media_type = mimetypes.guess_type(rel)[0] or "application/octet-stream"
    return Response(data, media_type=media_type, headers={"X-Farm-Sha": sha})


@router.get("/workspaces/{key}/archive.zip")
def archive(key: str, request: Request, ref: str | None = None) -> Response:
    settings = get_settings(request)
    with workspace_errors():
        ws = load_workspace(get_db(request), key)
        sha = serving_sha(settings, ws, ref)
        repo = open_repo(settings, ws.repo)
        if repo.object_type(sha, ws.path) != "tree":
            raise ApiError(404, "path_not_found", f"{ws.path or '/'} is not a directory at {sha[:7]}")
        data = repo.archive_zip(sha, ws.path)
    return Response(data, media_type="application/zip", headers={
        "X-Farm-Sha": sha, "Content-Disposition": f'attachment; filename="{ws.name}-{sha[:7]}.zip"'})


@router.post("/workspaces/{key}/validate")
def validate(key: str, body: ValidateRequest, request: Request, _token: ApiToken = Depends(require_token)) -> dict:
    settings = get_settings(request)
    with workspace_errors():
        load_workspace(get_db(request), key)
    _, issues = validate_changes(body.changes, max_bytes=settings.max_media_mb * MB,
                                 checker=request.app.state.syntax_checker)
    return {"valid": not issues, "issues": [issue.model_dump() for issue in issues]}


@router.post("/workspaces/{key}/commits", status_code=201)
def commit(key: str, body: CommitRequest, request: Request, _token: ApiToken = Depends(require_token)) -> dict:
    with workspace_errors():
        return commit_changes(get_db(request), get_settings(request), key, body, request.app.state.syntax_checker)


@router.post("/workspaces/{key}/restore", status_code=201)
def restore_paths(key: str, body: RestoreRequest, request: Request,
                  _token: ApiToken = Depends(require_token)) -> dict:
    with workspace_errors():
        return restore(get_db(request), get_settings(request), key, body)


@router.get("/workspaces/{key}/history")
def history(key: str, request: Request, path: str = "", ref: str | None = None,
            limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0)) -> dict:
    settings = get_settings(request)
    with workspace_errors():
        ws = load_workspace(get_db(request), key)
        rel = normalize_rel(path, allow_empty=True)
        sha = serving_sha(settings, ws, ref)
        commits = open_repo(settings, ws.repo).log(sha, repo_path(ws.path, rel), limit=limit, offset=offset)
    return {"sha": sha, "commits": [vars(c) for c in commits]}


@router.get("/workspaces/{key}/diff")
def diff(key: str, request: Request, from_: str = Query(alias="from"), to: str | None = None) -> dict:
    settings = get_settings(request)
    with workspace_errors():
        ws = load_workspace(get_db(request), key)
        old, new = serving_sha(settings, ws, from_), serving_sha(settings, ws, to)
        changes = open_repo(settings, ws.repo).diff_status(old, new, ws.path)
    return {"from": old, "to": new, "files": [
        {"path": strip_root(ws.path, path), "status": DIFF_STATUS.get(status[:1], "modified")}
        for path, status in changes]}
