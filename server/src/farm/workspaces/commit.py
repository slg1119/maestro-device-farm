"""Commits to a workspace branch without a work tree (spec §8.5, §8.6 restore)."""
from collections.abc import Callable

from pydantic import BaseModel, ConfigDict, Field

from farm.config import Settings
from farm.db.engine import Database
from farm.db.models import Workspace
from farm.events import emit
from farm.flows.syntax import SyntaxChecker
from farm.timeutil import now
from farm.workspaces.changes import MB, Change, decode, touched_paths, validate_changes
from farm.workspaces.errors import WorkspaceError
from farm.workspaces.git import (
    SHA_RE,
    GitError,
    GitRepo,
    IndexOp,
    NoChanges,
    PushRejected,
    RefNotFound,
    TreeEntry,
)
from farm.workspaces.paths import InvalidPath, normalize_rel, repo_path, strip_root
from farm.workspaces.registry import find_workspace, load_workspace, open_repo, workspace_payload

PUSH_ATTEMPTS = 3


class Author(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    email: str = Field(pattern=r"^[^@\s<>]+@[^@\s<>]+$")


class CommitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    base_sha: str = Field(pattern=SHA_RE.pattern)
    message: str = Field(min_length=1, max_length=5000)
    author: Author
    changes: list[Change] = Field(min_length=1)


class RestoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sha: str = Field(pattern=SHA_RE.pattern)
    paths: list[str] | None = None
    author: Author


def with_trailer(message: str, author: Author) -> str:
    return f"{message.strip()}\n\nCo-authored-by: {author.name} <{author.email}>\n"


def _files(repo: GitRepo, sha: str, root: str) -> dict[str, TreeEntry]:
    """Repo-relative path → entry for the file `root` or every file under the directory `root`."""
    base = root.rpartition("/")[0] if repo.object_type(sha, root) == "blob" else root
    return {repo_path(base, entry.path): entry for entry in repo.tree(sha, root)}


def _ensure_commit(repo: GitRepo, sha: str, code: str) -> None:
    try:
        repo.fetch_commit(sha)
    except RefNotFound as exc:
        raise WorkspaceError(400, code, f"commit {sha} not found") from exc
    except GitError as exc:
        raise WorkspaceError(502, "git_unavailable", str(exc)) from exc


def _commit_loop(db: Database, settings: Settings, ws: Workspace, repo: GitRepo, message: str,
                 build_ops: Callable[[str], list[IndexOp]]) -> dict:
    """Fetch → build on the remote head → push, retrying when another push won the race."""
    with repo.lock:
        for attempt in range(1, PUSH_ATTEMPTS + 1):
            try:
                remote_head = repo.fetch_branch(ws.branch)
            except GitError as exc:
                raise WorkspaceError(502, "git_unavailable", str(exc)) from exc
            ops = build_ops(remote_head)
            try:
                sha = repo.build_commit(remote_head, ops, message,
                                        author=(settings.git_bot_name, settings.git_bot_email))
                repo.push(sha, ws.branch)
            except NoChanges as exc:
                raise WorkspaceError(400, "no_changes", str(exc)) from exc
            except PushRejected as exc:
                if exc.kind == "protected":
                    raise WorkspaceError(403, "branch_protected", f"{ws.branch} rejected the push: {exc}") from exc
                if attempt == PUSH_ATTEMPTS:
                    raise WorkspaceError(409, "push_contended", "the branch kept moving; try again") from exc
                continue
            except GitError as exc:
                raise WorkspaceError(502, "git_unavailable", str(exc)) from exc
            break
    with db.session() as s:
        current = find_workspace(s, ws.id)
        if current.branch == ws.branch:
            current.head_sha, current.synced_at, current.sync_error = sha, now(), None
            emit(s, "workspace.updated", workspace_payload(current))
    return {"sha": sha, "parent": remote_head}


def commit_changes(db: Database, settings: Settings, key: str, req: CommitRequest,
                   checker: SyntaxChecker | None) -> dict:
    ws = load_workspace(db, key)
    changes, issues = validate_changes(req.changes, max_bytes=settings.max_media_mb * MB, checker=checker)
    if issues:
        raise WorkspaceError(422, "invalid_flow", "some files are invalid",
                             issues=[issue.model_dump() for issue in issues])
    repo = open_repo(settings, ws.repo)
    _ensure_commit(repo, req.base_sha, "base_not_found")
    touched = [repo_path(ws.path, p) for p in touched_paths(changes)]

    def build_ops(remote_head: str) -> list[IndexOp]:
        conflicts = repo.changed_paths(req.base_sha, remote_head, touched)
        if conflicts:
            raise WorkspaceError(409, "conflict", "files changed on the branch since base_sha",
                                 paths=[strip_root(ws.path, p) for p in conflicts], remote_head=remote_head)
        ops: list[IndexOp] = []
        for change in changes:
            path = repo_path(ws.path, change.path)
            if change.op == "put":
                ops.append(IndexOp(path, data=decode(change)))
            elif change.op == "delete":
                ops.append(IndexOp(path))
            else:
                source = _files(repo, remote_head, path).get(path)
                if source is None:
                    raise WorkspaceError(400, "path_not_found", f"{change.path} is not a file on {ws.branch}")
                ops += [IndexOp(path), IndexOp(repo_path(ws.path, change.to or ""), blob=source.blob,
                                               mode=source.mode)]
        return ops

    return _commit_loop(db, settings, ws, repo, with_trailer(req.message, req.author), build_ops)


def restore(db: Database, settings: Settings, key: str, req: RestoreRequest) -> dict:
    """Makes the given paths (default: the whole workspace) match `req.sha`; files absent there are deleted."""
    ws = load_workspace(db, key)
    try:
        targets = [normalize_rel(p) for p in req.paths] if req.paths else [""]
    except InvalidPath as exc:
        raise WorkspaceError(400, "invalid_path", str(exc)) from exc
    repo = open_repo(settings, ws.repo)
    _ensure_commit(repo, req.sha, "ref_not_found")

    def build_ops(remote_head: str) -> list[IndexOp]:
        ops: list[IndexOp] = []
        for target in targets:
            root = repo_path(ws.path, target)
            old, new = _files(repo, req.sha, root), _files(repo, remote_head, root)
            for path, entry in old.items():
                if path not in new or (new[path].blob, new[path].mode) != (entry.blob, entry.mode):
                    ops.append(IndexOp(path, blob=entry.blob, mode=entry.mode))
            ops += [IndexOp(path) for path in new if path not in old]
        return ops

    label = ", ".join(req.paths) if req.paths else (ws.path or "workspace")
    message = with_trailer(f"Restore {label} to {req.sha[:7]}", req.author)
    return _commit_loop(db, settings, ws, repo, message, build_ops)
