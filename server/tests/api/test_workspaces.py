import io
import zipfile

import pytest

from farm.db.models import Workspace
from tests.gitfixtures import FLOW, SAMPLE_FILES, make_origin

AUTHOR = {"name": "Kim Dev", "email": "kim@example.com"}


@pytest.fixture
def origin(remotes):
    return make_origin(remotes, "acme/app", SAMPLE_FILES)


@pytest.fixture
def ws(client, auth, origin):
    res = client.post("/api/v1/workspaces", json={"name": "app", "repo": "acme/app", "path": ".maestro"}, headers=auth)
    assert res.status_code == 201, res.text
    return res.json()


def _error(res):
    return res.status_code, res.json()["error"]["code"]


def test_register_list_get(client, secured_client, auth, ws, origin):
    assert ws["head_sha"] == origin.head() and ws["branch"] == "main"
    assert [w["name"] for w in client.get("/api/v1/workspaces").json()] == ["app"]
    assert client.get("/api/v1/workspaces/app").json()["id"] == ws["id"]
    assert client.get(f"/api/v1/workspaces/{ws['id']}").json()["name"] == "app"
    assert _error(client.get("/api/v1/workspaces/nope")) == (404, "workspace_not_found")
    assert _error(secured_client.post("/api/v1/workspaces", json={"name": "x", "repo": "acme/app"})) == (
        401, "unauthorized")
    assert _error(client.post("/api/v1/workspaces", json={"name": "app", "repo": "acme/app"}, headers=auth)) == (
        409, "workspace_exists")


def test_patch_sync_delete(client, auth, ws, origin):
    res = client.patch("/api/v1/workspaces/app", json={"default_app_package": "com.example.app"}, headers=auth)
    assert res.json()["default_app_package"] == "com.example.app" and res.json()["path"] == ".maestro"
    new = origin.commit({"README.md": "x\n"})
    assert client.post("/api/v1/workspaces/app/sync", headers=auth).json()["head_sha"] == new
    assert client.delete("/api/v1/workspaces/app", headers=auth).status_code == 204
    assert client.get("/api/v1/workspaces").json() == []


def test_tree_file_archive(client, ws):
    tree = client.get("/api/v1/workspaces/app/tree").json()
    assert tree["sha"] == ws["head_sha"]
    assert tree["files"] == [{"path": "login.yaml", "size": len(FLOW)}, {"path": "search.yaml", "size": len(FLOW)},
                             {"path": "sub/helper.yaml", "size": 7}]
    res = client.get("/api/v1/workspaces/app/files/sub/helper.yaml")
    assert res.text == "- back\n" and res.headers["x-farm-sha"] == ws["head_sha"]
    assert res.headers["content-type"] == "text/plain; charset=utf-8"
    assert _error(client.get("/api/v1/workspaces/app/files/missing.yaml")) == (404, "file_not_found")
    assert _error(client.get("/api/v1/workspaces/app/files/a/%2E%2E/%2E%2E/README.md")) == (400, "invalid_path")
    zip_res = client.get("/api/v1/workspaces/app/archive.zip", params={"ref": ws["head_sha"]})
    assert zip_res.headers["content-disposition"] == f'attachment; filename="app-{ws["head_sha"][:7]}.zip"'
    assert "login.yaml" in zipfile.ZipFile(io.BytesIO(zip_res.content)).namelist()
    assert _error(client.get("/api/v1/workspaces/app/tree", params={"ref": "nope"})) == (400, "ref_not_found")


def test_validate(client, auth, ws):
    res = client.post("/api/v1/workspaces/app/validate", headers=auth, json={"changes": [
        {"op": "put", "path": "ok.yaml", "content": FLOW},
        {"op": "put", "path": "bad.yaml", "content": "appId: x\n---\n- notACommand: 1\n"}]})
    assert res.json() == {"valid": False, "issues": [
        {"path": "bad.yaml", "message": "Invalid Command: notACommand", "line": 3, "column": 3}]}
    ok = client.post("/api/v1/workspaces/app/validate", headers=auth,
                     json={"changes": [{"op": "put", "path": "ok.yaml", "content": FLOW}]})
    assert ok.json() == {"valid": True, "issues": []}


def test_commit_history_diff_restore(client, auth, ws, origin):
    base = ws["head_sha"]
    res = client.post("/api/v1/workspaces/app/commits", headers=auth, json={
        "base_sha": base, "message": "Add OTP step", "author": AUTHOR,
        "changes": [{"op": "put", "path": "login.yaml", "content": FLOW + "- back\n"},
                    {"op": "delete", "path": "search.yaml"}]})
    assert res.status_code == 201, res.text
    sha = res.json()["sha"]
    assert client.get("/api/v1/workspaces/app").json()["head_sha"] == sha == origin.head()

    history = client.get("/api/v1/workspaces/app/history").json()
    assert history["sha"] == sha
    latest = history["commits"][0]
    assert (latest["sha"], latest["files_changed"]) == (sha, 2)
    assert latest["co_authors"] == [AUTHOR] and latest["message"].startswith("Add OTP step")
    assert [c["sha"] for c in client.get("/api/v1/workspaces/app/history",
                                         params={"path": "search.yaml", "limit": 1, "offset": 1}).json()["commits"]] == [base]

    diff = client.get("/api/v1/workspaces/app/diff", params={"from": base, "to": sha}).json()
    assert diff == {"from": base, "to": sha, "files": [{"path": "login.yaml", "status": "modified"},
                                                      {"path": "search.yaml", "status": "deleted"}]}

    conflict = client.post("/api/v1/workspaces/app/commits", headers=auth, json={
        "base_sha": base, "message": "stale", "author": AUTHOR,
        "changes": [{"op": "put", "path": "login.yaml", "content": FLOW}]})
    assert _error(conflict) == (409, "conflict")
    assert conflict.json()["error"]["paths"] == ["login.yaml"] and conflict.json()["error"]["remote_head"] == sha

    invalid = client.post("/api/v1/workspaces/app/commits", headers=auth, json={
        "base_sha": sha, "message": "bad", "author": AUTHOR,
        "changes": [{"op": "put", "path": "bad.yaml", "content": "- notACommand: 1\n"}]})
    assert _error(invalid) == (422, "invalid_flow") and invalid.json()["error"]["issues"][0]["line"] == 1

    restored = client.post("/api/v1/workspaces/app/restore", headers=auth,
                           json={"sha": base, "paths": ["search.yaml"], "author": AUTHOR})
    assert restored.status_code == 201
    names = [f["path"] for f in client.get("/api/v1/workspaces/app/tree").json()["files"]]
    assert "search.yaml" in names


def test_writes_need_token_when_enabled(secured_client, ws):
    for method, path, body in [("post", "/api/v1/workspaces/app/sync", None),
                               ("post", "/api/v1/workspaces/app/validate", {"changes": []}),
                               ("post", "/api/v1/workspaces/app/commits", {}),
                               ("post", "/api/v1/workspaces/app/restore", {}),
                               ("patch", "/api/v1/workspaces/app", {}),
                               ("delete", "/api/v1/workspaces/app", None)]:
        call = getattr(secured_client, method)
        res = call(path, json=body) if body is not None else call(path)
        assert res.status_code == 401, (method, path)


def test_healthz_lists_sync_errors(client, db, ws):
    assert client.get("/api/v1/healthz").json()["workspace_sync_errors"] == []
    with db.session() as s:
        s.get(Workspace, ws["id"]).sync_error = "git fetch failed: boom"
    assert client.get("/api/v1/healthz").json()["workspace_sync_errors"] == [
        {"name": "app", "error": "git fetch failed: boom"}]
