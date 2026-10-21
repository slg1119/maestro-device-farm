import json
import time

from fastapi.testclient import TestClient

from farm.ai.client import AiResponse, TextPart
from farm.api.app import create_app
from farm.db.models import Device
from farm.devices.registry import heartbeat
from farm.timeutil import now
from farm.workspaces.registry import create_workspace
from tests.fakes import FakeAiClient, FakeSyntaxChecker
from tests.gitfixtures import git_settings, make_origin


def wait_job(client, job_id):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        row = client.get(f"/api/v1/ai/jobs/{job_id}").json()
        if row["status"] in {"succeeded", "failed"}:
            return row
        time.sleep(.01)
    raise AssertionError("record AI job did not finish")


def test_stop_ai_polish_returns_one_validated_flow_and_reuses_job_on_retry(settings, db, tmp_path):
    remotes = tmp_path / "remotes"
    make_origin(remotes, "acme/app", {".maestro/subflows/launch.yaml":
                "appId: com.example.app\n---\n- launchApp:\n    clearState: true\n"})
    configured = git_settings(settings, remotes).model_copy(update={"git_poll_sec": 0})
    create_workspace(db, configured, name="example", repo="acme/app", path=".maestro",
                     default_app_package="com.example.app")
    with db.session() as s:
        s.add(Device(serial="fake-1", state="available", last_seen_at=now()))
        heartbeat(s, "agent", "test", now())
    fake = FakeAiClient()
    app = create_app(configured, db=db, ai_client=fake, syntax_checker=FakeSyntaxChecker())
    with TestClient(app) as client:
        row = client.post("/api/v1/devices/fake-1/recordings", json={
            "include_launch_app": True, "workspace": "example"}).json()
        target = f"flows/recorded-{row['id']}.yaml"
        flow = "appId: com.example.app\nname: 로그인 확인\n---\n- launchApp\n- assertVisible: 로그인\n"
        for path in ["flows/wrong.yaml", target]:
            data = {"files": [{"path": path, "content": flow}], "summary": "녹화 다듬기", "assumptions": []}
            fake.responses.append(AiResponse(data, 12, 7, "record-fake", json.dumps(data)))
        stopped = client.post(f"/api/v1/recordings/{row['id']}/stop", json={"ai_polish": True})
        assert stopped.status_code == 200 and stopped.json()["status"] == "done"
        job = wait_job(client, stopped.json()["ai_job_id"])
        assert job["kind"] == "record" and job["status"] == "succeeded"
        assert job["result"]["files"] == [{"path": target, "content": flow}]
        assert job["model"] == "record-fake" and job["input_tokens"] == 24
        assert any(attempt["kind"] == "validation" and attempt["status"] == "failed" for attempt in job["attempts"])
        again = client.post(f"/api/v1/recordings/{row['id']}/stop", json={"ai_polish": True}).json()
        assert again["ai_job_id"] == job["id"]
        assert len(client.get("/api/v1/ai/jobs").json()) == 1
    text = "\n".join(part.text for part in fake.requests[0].parts if isinstance(part, TextPart))
    assert '"kind": "launch"' in text and "- launchApp" in text
    assert "clearState: true" in text
    assert "assertVisible" in fake.requests[0].system and target in text


def test_polish_without_workspace_is_rejected_without_finishing(settings, db):
    with db.session() as s:
        s.add(Device(serial="fake-1", state="available", last_seen_at=now()))
        heartbeat(s, "agent", "test", now())
    with TestClient(create_app(settings, db=db, ai_client=FakeAiClient(), syntax_checker=FakeSyntaxChecker())) as client:
        row = client.post("/api/v1/devices/fake-1/recordings", json={"include_launch_app": False}).json()
        response = client.post(f"/api/v1/recordings/{row['id']}/stop", json={"ai_polish": True})
        assert response.status_code == 400 and response.json()["error"]["code"] == "recording_needs_workspace"
        assert client.get(f"/api/v1/recordings/{row['id']}").json()["status"] == "active"
