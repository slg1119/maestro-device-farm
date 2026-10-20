"""Workspace registration, sync and ref resolution. Network calls never run inside a DB transaction."""
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from farm.config import Settings
from farm.db.engine import Database
from farm.db.models import Workspace
from farm.events import emit
from farm.timeutil import now
from farm.workspaces.errors import WorkspaceError
from farm.workspaces.git import GitError, GitRepo, RefNotFound
from farm.workspaces.paths import BRANCH_RE, NAME_RE, REPO_RE, InvalidPath, normalize_rel


def open_repo(settings: Settings, repo: str) -> GitRepo:
    token = settings.github_token.get_secret_value() if settings.github_token else None
    return GitRepo(settings.path("git", repo.replace("/", "__") + ".git"),
                   settings.git_remote_template.format(repo=repo), token)


def workspace_payload(ws: Workspace) -> dict:
    return {"id": ws.id, "name": ws.name, "head_sha": ws.head_sha, "sync_error": ws.sync_error}


def find_workspace(session: Session, key: str) -> Workspace:
    """Looks a workspace up by id, then by name."""
    ws = session.get(Workspace, key) or session.scalar(select(Workspace).where(Workspace.name == key))
    if ws is None:
        raise WorkspaceError(404, "workspace_not_found", f"workspace {key} not found")
    return ws


def load_workspace(db: Database, key: str) -> Workspace:
    with db.session() as s:
        return find_workspace(s, key)


def list_workspaces(db: Database) -> list[Workspace]:
    with db.session() as s:
        return list(s.scalars(select(Workspace).order_by(Workspace.name)))


def _clean_path(path: str) -> str:
    try:
        return normalize_rel(path, allow_empty=True)
    except InvalidPath as exc:
        raise WorkspaceError(400, "invalid_path", str(exc)) from exc


def _check_branch(branch: str) -> None:
    if not BRANCH_RE.match(branch):
        raise WorkspaceError(400, "invalid_branch", f"invalid branch name: {branch}")


def _fetch_head(settings: Settings, repo: str, branch: str) -> str:
    try:
        return open_repo(settings, repo).fetch_branch(branch)
    except RefNotFound as exc:
        raise WorkspaceError(400, "branch_not_found", str(exc)) from exc
    except GitError as exc:
        raise WorkspaceError(400, "repo_unreachable", str(exc)) from exc


def create_workspace(db: Database, settings: Settings, *, name: str, repo: str, branch: str = "main",
                     path: str = "", default_app_package: str | None = None) -> Workspace:
    if not NAME_RE.match(name):
        raise WorkspaceError(400, "invalid_name", "name must be a lowercase slug (a-z, 0-9, -)")
    if not REPO_RE.match(repo):
        raise WorkspaceError(400, "invalid_repo", "repo must look like owner/name")
    _check_branch(branch)
    path = _clean_path(path)
    with db.session() as s:
        if s.scalar(select(Workspace).where(Workspace.name == name)) is not None:
            raise WorkspaceError(409, "workspace_exists", f"workspace {name} already exists")
    head = _fetch_head(settings, repo, branch)  # proves the bot can read the branch
    try:
        with db.session() as s:
            ws = Workspace(name=name, repo=repo, branch=branch, path=path, default_app_package=default_app_package,
                           head_sha=head, synced_at=now())
            s.add(ws)
            s.flush()
            emit(s, "workspace.updated", workspace_payload(ws))
    except IntegrityError as exc:
        raise WorkspaceError(409, "workspace_exists", f"workspace {name} already exists") from exc
    return ws


def update_workspace(db: Database, settings: Settings, key: str, changes: dict) -> Workspace:
    """`changes` holds only the fields the client sent: branch, path, default_app_package."""
    ws = load_workspace(db, key)
    updates: dict = {}
    if "path" in changes:
        updates["path"] = _clean_path(changes["path"] or "")
    if "default_app_package" in changes:
        updates["default_app_package"] = changes["default_app_package"] or None
    if changes.get("branch") and changes["branch"] != ws.branch:
        _check_branch(changes["branch"])
        updates.update(branch=changes["branch"], head_sha=_fetch_head(settings, ws.repo, changes["branch"]),
                       synced_at=now(), sync_error=None)
    with db.session() as s:
        ws = find_workspace(s, ws.id)
        for field, value in updates.items():
            setattr(ws, field, value)
        emit(s, "workspace.updated", workspace_payload(ws))
        return ws


def delete_workspace(db: Database, key: str) -> None:
    """Unregisters the workspace only; the repository and past runs are untouched."""
    with db.session() as s:
        ws = find_workspace(s, key)
        s.delete(ws)
        emit(s, "workspace.updated", {"id": ws.id, "name": ws.name, "deleted": True})


def sync_workspace(db: Database, settings: Settings, key: str) -> Workspace:
    ws = load_workspace(db, key)
    try:
        head, error = open_repo(settings, ws.repo).fetch_branch(ws.branch), None
    except GitError as exc:
        head, error = None, str(exc)
    with db.session() as s:
        current = find_workspace(s, ws.id)
        if current.branch != ws.branch:
            return current  # re-pointed while we fetched; the next sync covers the new branch
        changed = error != current.sync_error or (head is not None and head != current.head_sha)
        current.synced_at = now()
        current.sync_error = error
        if head is not None:
            current.head_sha = head
        if changed:
            emit(s, "workspace.updated", workspace_payload(current))
        return current


def sync_all(db: Database, settings: Settings) -> None:
    with db.session() as s:
        ids = list(s.scalars(select(Workspace.id)))
    for workspace_id in ids:
        try:
            sync_workspace(db, settings, workspace_id)
        except WorkspaceError:
            continue  # deleted meanwhile


def resolve_ref(settings: Settings, ws: Workspace, ref: str | None) -> str:
    """Turns a branch name or SHA into a commit SHA that exists in the local cache."""
    try:
        return open_repo(settings, ws.repo).resolve(ref or ws.branch)
    except RefNotFound as exc:
        raise WorkspaceError(400, "ref_not_found", str(exc)) from exc
    except GitError as exc:
        raise WorkspaceError(502, "git_unavailable", str(exc)) from exc


def serving_sha(settings: Settings, ws: Workspace, ref: str | None) -> str:
    """The commit to serve: the requested ref, else the last synced head (no network when it is cached)."""
    return resolve_ref(settings, ws, ref or ws.head_sha)
