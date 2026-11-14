import json
import shutil
from pathlib import Path

import pytest
from sqlalchemy import event, select

from farm.db.models import Device, Run, Task
from tests.factories import add_app, add_device, flow_yaml, submit, write_flows


@pytest.fixture
def source(db, tmp_path):
    root = write_flows(tmp_path / "original", {"login.yaml": flow_yaml()})
    with db.session() as s:
        add_device(s, "d1")
        run = submit(s, app=add_app(s), flows_dir=root)
        task = s.scalar(select(Task).where(Task.run_id == run.id))
    return run, task


def test_rerun_response_writer_and_copy_outside_transaction(client, db, settings, source, monkeypatch):
    original_copy = shutil.copytree
    copies = []

    def copy(src, dst, *args, **kwargs):
        assert db.engine.pool.checkedout() == 0
        copies.append((src, dst))
        return original_copy(src, dst, *args, **kwargs)

    monkeypatch.setattr("farm.api.routes.runs.shutil.copytree", copy)
    response = client.post(f"/api/v1/runs/{source[0].id}/rerun", json={"failed_only": False},
                           headers={"X-Farm-User": "Zo%C3%AB%20Operator"})
    assert response.status_code == 201
    body = response.json()
    assert body == {"id": body["id"], "url": f"{settings.public_url}/runs/{body['id']}"}
    assert len(copies) == 1
    with db.session() as s:
        new = s.get(Run, body["id"])
        assert new.created_by == "Zoë Operator"
        assert Path(new.flows_dir, "login.yaml").read_text() == Path(source[0].flows_dir, "login.yaml").read_text()


@pytest.mark.parametrize(("failure", "status", "code"), [
    ("missing_run", 404, "run_not_found"), ("purged", 409, "snapshot_purged"),
    ("missing_snapshot", 409, "snapshot_purged"), ("no_failures", 400, "nothing_failed"),
    ("no_devices", 400, "no_matching_devices"),
])
def test_rerun_errors_and_cleanup(client, db, settings, source, failure, status, code):
    run, _ = source
    with db.session() as s:
        if failure == "purged":
            s.get(Run, run.id).artifacts_purged = True
        if failure == "no_devices":
            s.get(Device, "d1").state = "offline"
    if failure == "missing_snapshot":
        shutil.rmtree(run.flows_dir)
    run_id = "missing" if failure == "missing_run" else run.id
    response = client.post(f"/api/v1/runs/{run_id}/rerun", json={"failed_only": failure == "no_failures"})
    assert (response.status_code, response.json()["error"]["code"]) == (status, code)
    uploads = settings.path("uploads")
    assert not uploads.exists() or not list(uploads.iterdir())
    with db.session() as s:
        assert len(list(s.scalars(select(Run)))) == 1


def test_copy_is_cleaned_up_when_creation_transaction_commit_fails(client, db, settings, source):
    def reject_commit(session):
        if any(isinstance(row, Run) and row.id != source[0].id for row in session.identity_map.values()):
            raise RuntimeError("commit failed")

    event.listen(db._factory, "before_commit", reject_commit)
    try:
        with pytest.raises(RuntimeError, match="commit failed"):
            client.post(f"/api/v1/runs/{source[0].id}/rerun", json={"failed_only": False})
    finally:
        event.remove(db._factory, "before_commit", reject_commit)
    assert not list(settings.path("uploads").iterdir())
    with db.session() as s:
        assert len(list(s.scalars(select(Run)))) == 1


def test_rerun_requires_writer_when_token_enabled(secured_client, source):
    response = secured_client.post(f"/api/v1/runs/{source[0].id}/rerun", json={"failed_only": False})
    assert response.status_code == 401


@pytest.mark.parametrize("artifacts", [None, "missing"])
def test_steps_without_artifacts(client, db, source, tmp_path, artifacts):
    task_id = source[1].id
    with db.session() as s:
        task = s.get(Task, task_id)
        task.attempt = 2
        task.artifacts_dir = str(tmp_path / artifacts) if artifacts else None
    response = client.get(f"/api/v1/tasks/{task_id}/steps")
    assert response.status_code == 200
    assert response.json() == {"task_id": task_id, "attempt": 2, "flows": []}
    missing = client.get("/api/v1/tasks/missing/steps")
    assert (missing.status_code, missing.json()["error"]["code"]) == (404, "task_not_found")


def test_steps_returns_downloadable_artifact_paths(client, db, source, tmp_path):
    root = tmp_path / "attempt-2"
    flow = root / "maestro/2026-10-20_191445/login"
    flow.mkdir(parents=True)
    (flow / "screen.png").write_bytes(b"png")
    (flow / "commands.json").write_text(json.dumps([{
        "command": {"tapOnElement": {"selector": {"idRegex": "login"}}},
        "metadata": {"sequenceNumber": 3, "depth": 1, "status": "FAILED", "duration": 100,
                     "artifacts": [{"type": "SCREENSHOT", "path": "screen.png"}]},
    }]))
    with db.session() as s:
        task = s.get(Task, source[1].id)
        task.attempt, task.artifacts_dir = 2, str(root)
    response = client.get(f"/api/v1/tasks/{task.id}/steps")
    assert response.status_code == 200
    body = response.json()
    assert body["task_id"] == task.id and body["attempt"] == 2
    step = body["flows"][0]["steps"][0]
    assert step["label"] == 'tapOn id="login"' and step["status"] == "failed"
    assert client.get(f"/api/v1/tasks/{task.id}/artifacts/{step['screenshot']}").content == b"png"
