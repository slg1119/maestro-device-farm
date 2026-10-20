import pytest

from farm.workspaces.changes import Change
from farm.workspaces.errors import WorkspaceError
from farm.workspaces.registry import create_workspace
from farm.workspaces.snapshot import apply_changes, snapshot_commit


def _files(root):
    return sorted(p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file())


def test_snapshot_commit(gsettings, workspace, tmp_path):
    root = snapshot_commit(gsettings, workspace, workspace.head_sha, tmp_path / "snap", 10_000)
    assert _files(root) == ["login.yaml", "search.yaml", "sub/helper.yaml"]


def test_snapshot_errors(db, gsettings, workspace, origin, tmp_path):
    with pytest.raises(WorkspaceError) as exc:
        snapshot_commit(gsettings, workspace, workspace.head_sha, tmp_path / "small", 10)
    assert (exc.value.status, exc.value.code) == (413, "snapshot_too_large")
    fresh = create_workspace(db, gsettings, name="fresh", repo="acme/app", path="flows")
    with pytest.raises(WorkspaceError) as exc:
        snapshot_commit(gsettings, fresh, fresh.head_sha, tmp_path / "none", 10_000)
    assert exc.value.code == "path_not_found"
    empty = snapshot_commit(gsettings, fresh, fresh.head_sha, tmp_path / "empty", 10_000, allow_missing=True)
    assert _files(empty) == []


def test_apply_changes(gsettings, workspace, tmp_path):
    root = snapshot_commit(gsettings, workspace, workspace.head_sha, tmp_path / "snap", 10_000)
    apply_changes(root, [Change(op="put", path="new/flow.yaml", content="- back\n"),
                         Change(op="delete", path="search.yaml"),
                         Change(op="move", path="sub/helper.yaml", to="lib/helper.yaml")])
    assert _files(root) == ["lib/helper.yaml", "login.yaml", "new/flow.yaml"]
    with pytest.raises(WorkspaceError):
        apply_changes(root, [Change(op="move", path="ghost.yaml", to="x.yaml")])
