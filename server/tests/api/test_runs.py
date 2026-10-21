import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from farm.api.app import create_app
from farm.db.models import AppBuild, Run, Task
from farm.results import CaseResult, TaskOutcome
from farm.scheduler.claim import claim_next
from farm.scheduler.finish import finish_task
from tests.factories import add_device, flow_yaml, zip_bytes
from tests.fakes import FakeApkParser, fake_apk_bytes


def _flows_zip() -> bytes:
    return zip_bytes({".maestro/a.yaml": flow_yaml("smoke"), ".maestro/b.yaml": flow_yaml()})


def _post(client, auth, options, *, flows=True, apk=True, apk_bytes=None, flows_bytes=None):
    files = {}
    if flows:
        files["flows"] = ("flows.zip", flows_bytes or _flows_zip(), "application/zip")
    if apk:
        files["apk"] = ("app.apk", apk_bytes or fake_apk_bytes(), "application/vnd.android.package-archive")
    return client.post("/api/v1/runs", data={"options": json.dumps(options)}, files=files or None, headers=auth)


@pytest.fixture
def device(db):
    with db.session() as s:
        add_device(s, "d1")


def _error(res):
    return res.status_code, res.json()["error"]["code"]


def test_submit_split_with_apk_upload(client, db, auth, settings, device):
    res = _post(client, auth, {"mode": "split", "ci_meta": {"branch": "main"}})
    assert res.status_code == 201
    run_id = res.json()["id"]
    assert res.json()["url"] == f"{settings.public_url}/runs/{run_id}"
    with db.session() as s:
        run = s.get(Run, run_id)
        assert run.flows_dir == str(settings.path("uploads", run_id, "flows", ".maestro"))
        assert run.created_by == "test" and run.ci_meta == {"branch": "main"}
        assert [t.flows for t in s.scalars(select(Task).where(Task.run_id == run_id).order_by(Task.seq))] == [
            ["a.yaml"], ["b.yaml"]]
        assert s.get(AppBuild, run.app_build_id).package_name == "com.example.app"
    assert not settings.path("uploads", run_id, "flows.zip").exists()


def test_submit_with_app_spec(client, db, auth, device):
    first = _post(client, auth, {"mode": "split"}).json()["id"]
    second = _post(client, auth, {"mode": "matrix", "app": "com.example.app@latest"}, apk=False)
    assert second.status_code == 201
    with db.session() as s:
        assert s.get(Run, second.json()["id"]).app_build_id == s.get(Run, first).app_build_id


def test_submit_requires_token_when_enabled(secured_client, device):
    assert _error(_post(secured_client, {}, {"mode": "split"})) == (401, "unauthorized")


def test_submit_without_token_records_the_named_user(client, db, device):
    named = _post(client, {"X-Farm-User": "%ED%99%8D%EA%B8%B8%EB%8F%99%20Kim"}, {"mode": "split"})
    anonymous = _post(client, {}, {"mode": "split"})
    assert named.status_code == anonymous.status_code == 201
    with db.session() as s:
        assert s.get(Run, named.json()["id"]).created_by == "홍길동 Kim"
        assert s.get(Run, anonymous.json()["id"]).created_by == "anonymous"
        assert s.get(AppBuild, s.get(Run, named.json()["id"]).app_build_id).uploaded_by == "홍길동 Kim"


@pytest.mark.parametrize(("options", "kwargs", "expected"), [
    ({"mode": "bogus"}, {}, (400, "invalid_options")),
    ({"mode": "split", "flow_source": "workspace"}, {}, (400, "invalid_options")),
    ({"mode": "split", "app": "com.example.app@latest"}, {}, (400, "invalid_app")),
    ({"mode": "split"}, {"apk": False}, (400, "invalid_app")),
    ({"mode": "split"}, {"flows": False}, (400, "flows_required")),
    ({"mode": "split", "device_selector": {"tags": ["tablet"]}}, {}, (400, "no_matching_devices")),
    ({"mode": "split"}, {"flows_bytes": zip_bytes({"../evil.yaml": "x"})}, (400, "invalid_archive")),
    ({"mode": "split"}, {"apk_bytes": b"garbage"}, (400, "invalid_apk")),
    ({"mode": "split", "app": "com.unknown@latest"}, {"apk": False}, (404, "app_not_found")),
])
def test_submit_errors_clean_up(client, auth, settings, device, options, kwargs, expected):
    assert _error(_post(client, auth, options, **kwargs)) == expected
    for leftover in (settings.path("uploads"), settings.path("tmp")):
        assert not leftover.exists() or not any(leftover.iterdir())


def test_flows_upload_size_limit(settings, db, auth, device):
    small = create_app(settings.model_copy(update={"max_flows_mb": 0}), db=db, apk_parser=FakeApkParser())
    assert _error(_post(TestClient(small), auth, {"mode": "split"})) == (413, "upload_too_large")


def test_get_run_masks_env(client, auth, device):
    run_id = _post(client, auth, {"mode": "split", "env": {"PASSWORD": "s3cret"}}).json()["id"]
    res = client.get(f"/api/v1/runs/{run_id}")
    body = res.json()
    assert body["env"] == {"PASSWORD": "***"} and "s3cret" not in res.text
    assert body["counts"] == {"total": 2, "queued": 2, "running": 0, "passed": 0, "failed": 0, "error": 0,
                              "cancelled": 0}
    assert [t["flows"] for t in body["tasks"]] == [["a.yaml"], ["b.yaml"]]
    assert body["app"]["package_name"] == "com.example.app"
    assert client.get("/api/v1/runs/missing").status_code == 404


def test_list_runs_filters_and_cursor(client, db, auth, device):
    ids = [_post(client, auth, {"mode": "split", "origin": origin}).json()["id"] for origin in ("ci", "ci", "dashboard")]
    with db.session() as s:
        for day, run_id in enumerate(ids, start=1):
            s.get(Run, run_id).created_at = f"2026-10-0{day}T00:00:00.000000Z"
    page = client.get("/api/v1/runs", params={"limit": 2}).json()
    assert [r["id"] for r in page] == [ids[2], ids[1]]
    assert [r["id"] for r in client.get("/api/v1/runs", params={"before": ids[1]}).json()] == [ids[0]]
    assert [r["id"] for r in client.get("/api/v1/runs", params={"origin": "dashboard"}).json()] == [ids[2]]
    assert client.get("/api/v1/runs", params={"status": "passed"}).json() == []


def test_cancel_run(client, secured_client, auth, device):
    run_id = _post(client, auth, {"mode": "split"}).json()["id"]
    assert secured_client.post(f"/api/v1/runs/{run_id}/cancel").status_code == 401
    body = client.post(f"/api/v1/runs/{run_id}/cancel", headers=auth).json()
    assert body["status"] == "cancelled" and body["counts"]["cancelled"] == 2


def test_junit_merges_results_per_device(client, db, auth, settings, device):
    run_id = _post(client, auth, {"mode": "split"}).json()["id"]
    for _ in range(2):
        with db.session() as s:
            task = claim_next(s, "d1", settings.data_dir)
        with db.session() as s:
            name = Path(task.flows[0]).stem
            finish_task(s, task.id, TaskOutcome("passed", cases=[CaseResult(name, "passed", 1000)]))
    res = client.get(f"/api/v1/runs/{run_id}/junit")
    assert res.headers["content-type"].startswith("application/xml")
    assert 'testsuite name="Pixel 7 (d1)" tests="2"' in res.text
    assert client.get(f"/api/v1/runs/{run_id}").json()["status"] == "passed"


def test_artifacts_listing_and_download(client, db, auth, settings, device, tmp_path):
    _post(client, auth, {"mode": "split"})
    with db.session() as s:
        task = claim_next(s, "d1", settings.data_dir)
    art = Path(task.artifacts_dir)
    (art / "maestro").mkdir(parents=True)
    (art / "junit.xml").write_text("<testsuites/>")
    (art / "maestro" / "shot.png").write_bytes(b"png")
    secret = tmp_path / "secret.txt"
    secret.write_text("nope")
    (art / "escape.txt").symlink_to(secret)
    listing = client.get(f"/api/v1/tasks/{task.id}/artifacts").json()
    assert {f["path"] for f in listing["files"]} >= {"junit.xml", "maestro/shot.png"}
    assert client.get(f"/api/v1/tasks/{task.id}/artifacts/maestro/shot.png").content == b"png"
    assert client.get(f"/api/v1/tasks/{task.id}/artifacts/escape.txt").status_code == 404
    assert client.get(f"/api/v1/tasks/{task.id}/artifacts/missing.txt").status_code == 404
    assert client.get("/api/v1/tasks/missing/artifacts").status_code == 404
