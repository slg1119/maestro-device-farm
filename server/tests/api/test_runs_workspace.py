import json
from pathlib import Path

import pytest
from sqlalchemy import select

from farm.db.models import Run, Task
from tests.factories import add_device, zip_bytes
from tests.fakes import fake_apk_bytes
from tests.gitfixtures import FLOW, SAMPLE_FILES, make_origin


@pytest.fixture
def ws(client, auth, remotes, db):
    origin = make_origin(remotes, "acme/app", SAMPLE_FILES)
    with db.session() as s:
        add_device(s, "d1")
    res = client.post("/api/v1/workspaces", json={"name": "app", "repo": "acme/app", "path": ".maestro"}, headers=auth)
    return origin, res.json()


def _post(client, auth, options, flows=None):
    files = {"apk": ("app.apk", fake_apk_bytes(), "application/vnd.android.package-archive")}
    if flows is not None:
        files["flows"] = ("flows.zip", flows, "application/zip")
    return client.post("/api/v1/runs", data={"options": json.dumps(options)}, files=files, headers=auth)


def _error(res):
    return res.status_code, res.json()["error"]["code"]


def _flows(db, run_id):
    with db.session() as s:
        run = s.get(Run, run_id)
        tasks = s.scalars(select(Task).where(Task.run_id == run_id).order_by(Task.seq))
        return run, [t.flows for t in tasks]


def test_workspace_source_uses_branch_head(client, auth, db, ws):
    origin, workspace = ws
    new = origin.commit({".maestro/extra.yaml": FLOW})
    res = _post(client, auth, {"mode": "split", "flow_source": "workspace", "workspace": "app"})
    assert res.status_code == 201, res.text
    run, flows = _flows(db, res.json()["id"])
    assert (run.flow_source, run.workspace_id, run.ref, run.commit_sha) == ("workspace", workspace["id"], None, new)
    assert flows == [["extra.yaml"], ["login.yaml"], ["search.yaml"]]
    assert (Path(run.flows_dir) / "sub" / "helper.yaml").is_file()
    summary = client.get(f"/api/v1/runs/{run.id}").json()
    assert (summary["workspace_id"], summary["commit_sha"]) == (workspace["id"], new)
    assert [r["id"] for r in client.get("/api/v1/runs", params={"workspace": "app"}).json()] == [run.id]
    assert client.get("/api/v1/runs", params={"workspace": "other"}).json() == []


def test_workspace_source_pinned_ref(client, auth, db, ws):
    origin, workspace = ws
    old = workspace["head_sha"]
    origin.commit({".maestro/extra.yaml": FLOW})
    res = _post(client, auth, {"mode": "split", "flow_source": "workspace", "workspace": workspace["id"], "ref": old})
    run, flows = _flows(db, res.json()["id"])
    assert (run.ref, run.commit_sha) == (old, old)
    assert flows == [["login.yaml"], ["search.yaml"]]


def test_draft_source_applies_changes_on_base(client, auth, db, ws):
    _, workspace = ws
    res = _post(client, auth, {"mode": "matrix", "flow_source": "draft", "workspace": "app",
                               "base_sha": workspace["head_sha"], "flow_paths": ["new.yaml"],
                               "changes": [{"op": "put", "path": "new.yaml", "content": FLOW},
                                           {"op": "delete", "path": "search.yaml"}]})
    assert res.status_code == 201, res.text
    run, flows = _flows(db, res.json()["id"])
    assert (run.flow_source, run.commit_sha, run.ref) == ("draft", workspace["head_sha"], None)
    assert flows == [["new.yaml"]]
    assert sorted(p.name for p in Path(run.flows_dir).glob("*.yaml")) == ["login.yaml", "new.yaml"]


@pytest.mark.parametrize(("options", "flows", "expected"), [
    ({"flow_source": "workspace"}, None, (400, "invalid_options")),
    ({"flow_source": "workspace", "workspace": "app", "base_sha": "a" * 40}, None, (400, "invalid_options")),
    ({"flow_source": "draft", "workspace": "app", "base_sha": "a" * 40}, None, (400, "invalid_options")),
    ({"flow_source": "upload", "workspace": "app"}, zip_bytes({"a.yaml": FLOW}), (400, "invalid_options")),
    ({"flow_source": "workspace", "workspace": "app"}, zip_bytes({"a.yaml": FLOW}), (400, "invalid_flow_source")),
    ({"flow_source": "workspace", "workspace": "nope"}, None, (404, "workspace_not_found")),
    ({"flow_source": "workspace", "workspace": "app", "ref": "missing"}, None, (400, "ref_not_found")),
    ({"flow_source": "draft", "workspace": "app", "base_sha": "a" * 40, "changes": []}, None, (400, "ref_not_found")),
])
def test_source_errors(client, auth, ws, settings, options, flows, expected):
    assert _error(_post(client, auth, {"mode": "split", **options}, flows)) == expected
    uploads = settings.path("uploads")
    assert not uploads.exists() or not any(uploads.iterdir())


def test_draft_rejects_bad_paths(client, auth, ws):
    _, workspace = ws
    res = _post(client, auth, {"mode": "split", "flow_source": "draft", "workspace": "app",
                               "base_sha": workspace["head_sha"],
                               "changes": [{"op": "put", "path": "../x.yaml", "content": FLOW}]})
    assert _error(res) == (422, "invalid_flow")


def test_draft_cannot_write_through_symlinks(client, auth, ws, settings):
    origin, _ = ws
    deep = origin.work / ".maestro/deep/inner"
    deep.mkdir(parents=True)
    (deep / "link.txt").symlink_to("../../login.yaml")
    (origin.work / ".maestro/alias.txt").symlink_to("moved.txt")
    head = origin.commit({".maestro/marker.txt": "inside"}, "relative symlinks")
    outside = settings.path("uploads", "moved.txt")
    for changes in ([{"op": "move", "path": "deep/inner/link.txt", "to": "moved.txt"},
                     {"op": "put", "path": "alias.txt", "content": "OVERWRITTEN"}],
                    [{"op": "put", "path": "alias.txt", "content": "OVERWRITTEN"}]):
        res = _post(client, auth, {"mode": "matrix", "flow_source": "draft", "workspace": "app", "base_sha": head,
                                   "changes": changes})
        assert _error(res) == (400, "invalid_path"), res.text
    assert not outside.exists()
    uploads = settings.path("uploads")
    assert not uploads.exists() or not any(uploads.iterdir())


def test_draft_snapshot_size_includes_changes(client, auth, ws, settings, app):
    origin, _ = ws
    app.state.settings = settings.model_copy(update={"max_flows_mb": 1, "git_remote_template":
                                                     app.state.settings.git_remote_template})
    base = origin.commit({".maestro/base.bin": "b" * (3 * 1024 * 1024)})
    res = _post(client, auth, {"mode": "matrix", "flow_source": "draft", "workspace": "app", "base_sha": base,
                               "changes": [{"op": "put", "path": "large.txt", "content": "x" * (2 * 1024 * 1024)}]})
    assert _error(res) == (413, "snapshot_too_large")


def test_draft_content_over_one_megabyte_is_accepted(client, auth, ws):
    _, workspace = ws
    res = _post(client, auth, {"mode": "matrix", "flow_source": "draft", "workspace": "app",
                               "base_sha": workspace["head_sha"],
                               "changes": [{"op": "put", "path": "big.txt", "content": "x" * (3 * 1024 * 1024)}]})
    assert res.status_code == 201, res.text
