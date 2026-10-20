import time

import pytest
from sqlalchemy import select

from farm.db.models import Event, Workspace
from farm.workspaces.errors import WorkspaceError
from farm.workspaces.poller import WorkspacePoller
from farm.workspaces.registry import (
    create_workspace,
    delete_workspace,
    load_workspace,
    open_repo,
    resolve_ref,
    serving_sha,
    sync_workspace,
    update_workspace,
)
from tests.gitfixtures import git


def _events(db):
    with db.session() as s:
        return [(e.type, e.payload) for e in s.scalars(select(Event).order_by(Event.id))]


def test_open_repo_paths(gsettings):
    repo = open_repo(gsettings, "acme/app")
    assert repo.git_dir == gsettings.path("git", "acme__app.git")
    assert repo.remote_url.startswith("file://") and repo.remote_url.endswith("/acme/app.git")


def test_create_records_head_and_emits(db, workspace, origin):
    assert (workspace.name, workspace.path, workspace.head_sha) == ("app", ".maestro", origin.head())
    assert workspace.synced_at and workspace.sync_error is None
    assert _events(db) == [("workspace.updated", {"id": workspace.id, "name": "app", "head_sha": origin.head(),
                                                  "sync_error": None})]
    assert load_workspace(db, "app").id == workspace.id == load_workspace(db, workspace.id).id


@pytest.mark.parametrize(("kwargs", "code"), [
    ({"name": "Bad Name"}, "invalid_name"),
    ({"repo": "nope"}, "invalid_repo"),
    ({"branch": "a..b"}, "invalid_branch"),
    ({"path": "../up"}, "invalid_path"),
    ({"branch": "missing"}, "branch_not_found"),
    ({"repo": "acme/unknown"}, "repo_unreachable"),
    ({"name": "app"}, "workspace_exists"),
])
def test_create_rejects(db, gsettings, workspace, kwargs, code):
    args = {"name": "other", "repo": "acme/app", "branch": "main", "path": ".maestro"} | kwargs
    with pytest.raises(WorkspaceError) as exc:
        create_workspace(db, gsettings, **args)
    assert exc.value.code == code


def test_path_may_not_exist_yet(db, gsettings, origin):
    ws = create_workspace(db, gsettings, name="fresh", repo="acme/app", path="flows/new")
    assert ws.path == "flows/new"


def test_sync_updates_head_and_errors(db, gsettings, workspace, origin):
    new = origin.commit({".maestro/login.yaml": "changed\n"})
    assert sync_workspace(db, gsettings, "app").head_sha == new
    assert _events(db)[-1][1]["head_sha"] == new
    count = len(_events(db))
    sync_workspace(db, gsettings, "app")
    assert len(_events(db)) == count  # nothing changed, no event
    broken = gsettings.model_copy(update={"git_remote_template": "file:///nonexistent/{repo}.git"})
    failed = sync_workspace(db, broken, "app")
    assert failed.head_sha == new and "git fetch failed" in failed.sync_error
    assert sync_workspace(db, gsettings, "app").sync_error is None


def test_update_and_delete(db, gsettings, workspace, origin):
    git("push", "-q", "origin", "HEAD:refs/heads/dev", cwd=origin.work)
    ws = update_workspace(db, gsettings, "app", {"branch": "dev", "path": "", "default_app_package": "com.x"})
    assert (ws.branch, ws.path, ws.default_app_package, ws.head_sha) == ("dev", "", "com.x", origin.head())
    assert update_workspace(db, gsettings, "app", {"default_app_package": None}).default_app_package is None
    with pytest.raises(WorkspaceError) as exc:
        update_workspace(db, gsettings, "app", {"branch": "missing"})
    assert exc.value.code == "branch_not_found"
    delete_workspace(db, "app")
    with db.session() as s:
        assert s.scalars(select(Workspace)).all() == []
    assert _events(db)[-1][1] == {"id": ws.id, "name": "app", "deleted": True}


def test_resolve_and_serving_sha(db, gsettings, workspace, origin):
    head = workspace.head_sha
    assert serving_sha(gsettings, workspace, None) == head
    new = origin.commit({"README.md": "x\n"})
    assert serving_sha(gsettings, workspace, None) == head  # cached head, no fetch
    assert resolve_ref(gsettings, workspace, None) == new  # branch is fetched
    assert resolve_ref(gsettings, workspace, head) == head
    with pytest.raises(WorkspaceError) as exc:
        resolve_ref(gsettings, workspace, "no-such-branch")
    assert (exc.value.status, exc.value.code) == (400, "ref_not_found")


def test_poller_picks_up_new_commits(db, gsettings, workspace, origin):
    new = origin.commit({"README.md": "polled\n"})
    poller = WorkspacePoller(db, gsettings, interval=0.05)
    poller.start()
    try:
        deadline = time.monotonic() + 10
        while load_workspace(db, "app").head_sha != new:
            assert time.monotonic() < deadline
            time.sleep(0.05)
    finally:
        poller.stop()
    assert not poller._thread.is_alive()
