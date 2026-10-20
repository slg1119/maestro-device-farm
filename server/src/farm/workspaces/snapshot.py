"""Immutable per-run flow snapshots from a workspace commit (spec §5.1 step 2, §8.3)."""
from pathlib import Path

from farm.config import Settings
from farm.db.models import Workspace
from farm.workspaces.changes import Change, decode
from farm.workspaces.errors import WorkspaceError
from farm.workspaces.git import GitError, SnapshotTooLarge
from farm.workspaces.registry import open_repo


def snapshot_commit(settings: Settings, ws: Workspace, sha: str, dest: Path, max_bytes: int, *,
                    allow_missing: bool = False) -> Path:
    """Extracts the workspace directory at `sha` into `dest` (path prefix removed)."""
    repo = open_repo(settings, ws.repo)
    kind = repo.object_type(sha, ws.path)
    if kind != "tree":
        if kind is None and allow_missing:
            dest.mkdir(parents=True, exist_ok=True)
            return dest
        raise WorkspaceError(400, "path_not_found", f"{ws.path or '/'} is not a directory at {sha[:7]}")
    try:
        return repo.archive_to(sha, ws.path, dest, max_bytes)
    except SnapshotTooLarge as exc:
        raise WorkspaceError(413, "snapshot_too_large", str(exc)) from exc
    except GitError as exc:
        raise WorkspaceError(502, "git_unavailable", str(exc)) from exc


def apply_changes(root: Path, changes: list[Change]) -> None:
    """Applies already-normalized draft changes on top of a snapshot."""
    for change in changes:
        target = root / change.path
        if change.op == "put":
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(decode(change))
        elif change.op == "delete":
            target.unlink(missing_ok=True)
        else:
            if not target.is_file():
                raise WorkspaceError(400, "path_not_found", f"{change.path} does not exist at base_sha")
            dest = root / (change.to or "")
            dest.parent.mkdir(parents=True, exist_ok=True)
            target.replace(dest)
