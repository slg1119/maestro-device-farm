import json
from contextlib import nullcontext
from threading import Event as ThreadEvent

import pytest
from fastapi.testclient import TestClient

from farm.ai.client import AiResponse
from farm.ai.jobs import create_job
from farm.api.app import create_app
from farm.api.deps import Writer
from farm.db.models import AiJob
from farm.timeutil import now
from farm.workspaces.registry import create_workspace
from tests.fakes import FakeAiClient, FakeSyntaxChecker
from tests.gitfixtures import FLOW, SAMPLE_FILES, git_settings, make_origin


@pytest.fixture
def ai_setup(settings, db, remotes):
    make_origin(remotes, "acme/app", SAMPLE_FILES)
    settings = git_settings(settings, remotes).model_copy(update={"git_poll_sec": 0})
    ws = create_workspace(db, settings, name="example", repo="acme/app", path=".maestro")
    data = {"files": [{"path": "login.yaml", "content": FLOW}], "summary": "done", "assumptions": []}
    fake = FakeAiClient([AiResponse(data, 10, 5, "fake", json.dumps(data))])
    app = create_app(settings, db=db, syntax_checker=FakeSyntaxChecker(), ai_client=fake)
    body = {"kind": "generate", "workspace": ws.name, "base_sha": ws.head_sha,
            "prompt": "로그인 flow", "target_path": "login.yaml"}
    try:
        yield app, ws, fake, body
    finally:
        if app.state.ai_runner:
            app.state.ai_runner.stop()


def test_ai_disabled_status_and_create(client):
    status = client.get("/api/v1/ai/status")
    assert status.status_code == 200
    assert status.json()["enabled"] is False
    assert status.json()["model"] == "gpt-6.1-sol"
    assert client.get("/api/v1/healthz").json()["ai_enabled"] is False
    response = client.post("/api/v1/ai/jobs", json={"kind": "generate", "prompt": "write a flow"})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "ai_disabled"


@pytest.mark.parametrize("lifespan", [False, True])
def test_ai_job_create_get_list_and_totals_with_and_without_lifespan(ai_setup, db, lifespan):
    app, ws, fake, body = ai_setup
    client = TestClient(app)
    with client if lifespan else nullcontext(client):
        response = client.post("/api/v1/ai/jobs", json={**body, "author_name": "작성자"},
                               headers={"X-Farm-User": "operator"})
        assert response.status_code == 201
        created = response.json()
        assert created["status"] == "queued"
        assert created["created_by"] == "operator" and created["author_name"] == "작성자"
        assert created["options"] == {"target_path": "login.yaml", "include_screen": False, "auto_repair": False,
                                      "reservation_id": None, "app_build_id": None, "app": None}
        app.state.ai_runner.stop()
        detail = client.get(f"/api/v1/ai/jobs/{created['id']}").json()
        assert detail["status"] == "succeeded" and detail["finished_at"]
        assert client.get("/api/v1/ai/jobs", params={"workspace": ws.name}).json() == [detail]
        assert client.get("/api/v1/ai/jobs", params={"workspace": ws.id, "limit": 1}).json() == [detail]
        with db.session() as s:
            s.add(AiJob(kind="generate", workspace_id=ws.id, base_sha=ws.head_sha, prompt="old", options={},
                        model="fake", input_tokens=999, output_tokens=999, created_at="2001-01-01T00:00:00.000000Z"))
        assert client.get("/api/v1/ai/status").json() == {
            "enabled": True, "model": "gpt-6.1-sol", "month": now()[:7],
            "month_input_tokens": 10, "month_output_tokens": 5, "month_jobs": 1,
        }
        assert client.get("/api/v1/healthz").json()["ai_enabled"] is True
    assert len(fake.requests) == 1


@pytest.mark.parametrize("changes", [
    {"workspace": None}, {"base_sha": "bad"}, {"target_path": "../bad.yaml"}, {"target_path": ".git/config"},
    {"prompt": " "}, {"include_screen": True}, {"auto_repair": True},
    {"auto_repair": True, "reservation_id": "reservation"}, {"kind": "fix", "source_task_id": None},
    {"kind": "fix", "source_task_id": "missing"}, {"kind": "other"}, {"source_task_id": "task"},
])
def test_ai_rejects_invalid_combinations(ai_setup, changes):
    app, _, fake, body = ai_setup
    response = TestClient(app).post("/api/v1/ai/jobs", json={**body, **changes})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"
    assert fake.requests == []


def test_cancel_during_provider_call_and_queued_job(ai_setup, db):
    app, _, fake, body = ai_setup
    entered, release = ThreadEvent(), ThreadEvent()
    answer = fake.responses[0]

    def blocked(request):
        entered.set()
        assert release.wait(5)
        return answer

    fake.responses = [blocked]
    client = TestClient(app)
    try:
        created = client.post("/api/v1/ai/jobs", json=body).json()
        assert entered.wait(5)
        assert client.post(f"/api/v1/ai/jobs/{created['id']}/cancel").status_code == 200
    finally:
        release.set()
        app.state.ai_runner.stop()
    assert client.get(f"/api/v1/ai/jobs/{created['id']}").json()["status"] == "cancelled"
    queued = create_job(db, app.state.settings, Writer("test"), body)
    cancelled = client.post(f"/api/v1/ai/jobs/{queued.id}/cancel").json()
    assert cancelled["status"] == "cancelled"
    assert client.post(f"/api/v1/ai/jobs/{queued.id}/cancel").json() == cancelled
    assert len(fake.requests) == 1


def test_ai_missing_jobs_and_writer_auth(ai_setup):
    app, _, _, body = ai_setup
    client = TestClient(app)
    for response in [client.get("/api/v1/ai/jobs/missing"), client.post("/api/v1/ai/jobs/missing/cancel")]:
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "ai_job_not_found"
    app.state.settings.require_token = True
    assert client.post("/api/v1/ai/jobs", json=body).status_code == 401
    assert client.post("/api/v1/ai/jobs/missing/cancel").status_code == 401


def test_screen_and_auto_repair_need_an_active_reservation(ai_setup):
    app, _, fake, body = ai_setup
    client = TestClient(app)
    response = client.post("/api/v1/ai/jobs", json={**body, "include_screen": True, "auto_repair": True,
                           "reservation_id": "reserved", "app": "com.example.app"})
    assert response.status_code == 201
    options = response.json()["options"]
    assert options["include_screen"] is True and options["auto_repair"] is True
    app.state.ai_runner.stop()
    detail = client.get(f"/api/v1/ai/jobs/{response.json()['id']}").json()
    assert detail["status"] == "failed"
    assert detail["error_message"] == "reservation ended"
    assert fake.requests == []
