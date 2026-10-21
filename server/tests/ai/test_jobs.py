import json

import pytest
from pydantic import SecretStr
from sqlalchemy import select

from farm.ai.client import AiResponse, ImagePart, TextPart
from farm.ai.jobs import AiJobRunner, create_job
from farm.api.deps import Writer
from farm.db.models import AiJob, Event
from tests.fakes import FakeAiClient, FakeSyntaxChecker
from tests.gitfixtures import FLOW


def answer(content=FLOW, path="login.yaml"):
    data = {"files": [{"path": path, "content": content}], "summary": "로그인 flow", "assumptions": []}
    return AiResponse(data=data, input_tokens=12, output_tokens=7, model="fake-model", raw=json.dumps(data))


def generate(db, settings, ws, **extra):
    return create_job(db, settings, Writer("tester"), {
        "kind": "generate", "workspace": ws.name, "base_sha": ws.head_sha,
        "prompt": "로그인 테스트 작성", "target_path": "login.yaml", **extra,
    })


def test_generate_succeeds_and_records_usage_events_and_raw_files(workspace, db):
    settings, ws, _ = workspace
    fake = FakeAiClient([answer()])
    job = generate(db, settings, ws)
    runner = AiJobRunner(db, settings, fake, FakeSyntaxChecker())
    try:
        runner.run_job(job.id)
    finally:
        runner.stop()
    with db.session() as s:
        saved = s.get(AiJob, job.id)
        assert saved.status == "succeeded"
        assert saved.result == {**answer().data, "passed_run_id": None}
        assert (saved.input_tokens, saved.output_tokens, saved.model) == (12, 7, "fake-model")
        assert [a["kind"] for a in saved.attempts] == ["generate", "validation"]
        events = list(s.scalars(select(Event).where(Event.type == "ai_job.updated")))
        assert [e.payload["status"] for e in events] == ["queued", "running", "running", "running", "succeeded"]
        assert events[-1].payload == {"id": job.id, "status": "succeeded", "attempts": 2}
    assert len(fake.requests) == 1
    assert "default_app_package: com.example.app" in fake.requests[0].parts[0].text
    assert settings.path("ai", job.id, "request-1.json").is_file()
    assert settings.path("ai", job.id, "response-1.json").is_file()


def test_invalid_answer_retries_with_validation_issues(workspace, db):
    settings, ws, _ = workspace
    fake = FakeAiClient([answer(FLOW + "- notACommand\n"), answer()])
    job = generate(db, settings, ws)
    runner = AiJobRunner(db, settings, fake, FakeSyntaxChecker())
    try:
        runner.run_job(job.id)
    finally:
        runner.stop()
    with db.session() as s:
        saved = s.get(AiJob, job.id)
        assert saved.status == "succeeded"
        assert (saved.input_tokens, saved.output_tokens) == (24, 14)
        issue = saved.attempts[1]["issues"][0]
        assert issue == {"path": "login.yaml", "message": "Invalid Command: notACommand", "line": 4, "column": 3}
    assert "previous answer failed validation" in fake.requests[1].parts[0].text
    assert "notACommand" in fake.requests[1].parts[0].text


@pytest.mark.parametrize("path", ["../escape.yaml", "/tmp/escape.yaml", ".git/config", "sub/.git/config"])
def test_unsafe_paths_exhaust_repairs_without_writing(workspace, db, path):
    settings, ws, _ = workspace
    settings = settings.model_copy(update={"ai_max_repairs": 1})
    fake = FakeAiClient([answer(path=path), answer(path=path)])
    job = generate(db, settings, ws)
    runner = AiJobRunner(db, settings, fake, FakeSyntaxChecker())
    try:
        runner.run_job(job.id)
    finally:
        runner.stop()
    with db.session() as s:
        saved = s.get(AiJob, job.id)
        assert saved.status == "failed"
        assert saved.result is None
        assert saved.error_message == "validation kept failing after 2 attempts"
        assert len(saved.attempts) == 4
    assert len(fake.requests) == 2


def test_cancellation_before_next_provider_call(workspace, db):
    settings, ws, _ = workspace
    job = generate(db, settings, ws)

    def cancel_after_answer(request):
        with db.session() as s:
            s.get(AiJob, job.id).cancel_requested = True
        return answer(FLOW + "- notACommand\n")

    fake = FakeAiClient([cancel_after_answer, answer()])
    runner = AiJobRunner(db, settings, fake, FakeSyntaxChecker())
    try:
        runner.run_job(job.id)
    finally:
        runner.stop()
    with db.session() as s:
        assert s.get(AiJob, job.id).status == "cancelled"
    assert len(fake.requests) == 1


def test_leftover_jobs_fail_on_runner_start(workspace, db):
    settings, ws, _ = workspace
    jobs = [generate(db, settings, ws), generate(db, settings, ws)]
    with db.session() as s:
        s.get(AiJob, jobs[1].id).status = "running"
    runner = AiJobRunner(db, settings, FakeAiClient(), FakeSyntaxChecker())
    try:
        runner.start()
    finally:
        runner.stop()
    with db.session() as s:
        assert [(s.get(AiJob, j.id).status, s.get(AiJob, j.id).error_message) for j in jobs] == [
            ("failed", "api restarted"), ("failed", "api restarted")]


def test_fix_includes_failure_context_and_redacts_secrets_everywhere(workspace, db, failed_task):
    settings, ws, _ = workspace
    settings = settings.model_copy(update={"openai_api_key": SecretStr("private-provider-key"),
                                           "github_token": SecretStr("private-github-token")})
    job = create_job(db, settings, Writer("tester"), {"kind": "fix", "source_task_id": failed_task.id,
                     "prompt": "Fix private-provider-key private-github-token private-run-password"})
    fake = FakeAiClient([answer(FLOW + "- notACommand\n"), answer()])
    runner = AiJobRunner(db, settings, fake, FakeSyntaxChecker())
    try:
        runner.run_job(job.id)
    finally:
        runner.stop()
    first_text = "\n".join(p.text for p in fake.requests[0].parts if isinstance(p, TextPart))
    assert "Expected login button" in first_text
    assert "last-log-line" in first_text
    assert "too-old-line" not in first_text
    assert "login.yaml" in first_text
    assert "DRAFT_BUTTON" in first_text
    assert any(isinstance(p, ImagePart) and p.data == b"fake-png" for p in fake.requests[0].parts)
    with db.session() as s:
        saved = s.get(AiJob, job.id)
        assert saved.status == "succeeded"
        assert saved.workspace_id == ws.id and saved.base_sha == ws.head_sha
        stored = saved.prompt + json.dumps(saved.options) + json.dumps(saved.attempts) + json.dumps(saved.result)
    logged = "".join(p.read_text() for p in settings.path("ai", job.id).glob("*.json"))
    for secret in ["private-run-password", "private-provider-key", "private-github-token"]:
        assert secret not in stored + logged
        assert all(secret not in str(r) for r in fake.requests)


def test_provider_exception_is_redacted(workspace, db):
    settings, ws, _ = workspace
    settings = settings.model_copy(update={"openai_api_key": SecretStr("private-provider-key")})
    fake = FakeAiClient([RuntimeError("failed private-provider-key")])
    job = generate(db, settings, ws)
    runner = AiJobRunner(db, settings, fake, FakeSyntaxChecker())
    try:
        runner.run_job(job.id)
    finally:
        runner.stop()
    with db.session() as s:
        saved = s.get(AiJob, job.id)
        assert saved.status == "failed"
        assert saved.error_message == "failed [REDACTED]"


def test_matrix_fix_uses_first_failed_result_flow(workspace, db, failed_task):
    from farm.db.models import Run, Task
    settings, _, _ = workspace
    with db.session() as s:
        s.get(Run, failed_task.run_id).mode = "matrix"
        s.get(Task, failed_task.id).flows = ["search.yaml", "login.yaml"]
    job = create_job(db, settings, Writer("test"), {"kind": "fix", "source_task_id": failed_task.id})
    assert job.options["target_path"] == "login.yaml"


def test_fix_rejects_uploaded_run(workspace, db, failed_task):
    from farm.api.errors import ApiError
    from farm.db.models import Run
    settings, _, _ = workspace
    with db.session() as s:
        s.get(Run, failed_task.run_id).flow_source = "upload"
    with pytest.raises(ApiError) as exc:
        create_job(db, settings, Writer("test"), {"kind": "fix", "source_task_id": failed_task.id})
    assert exc.value.code == "fix_needs_workspace"


def test_raw_response_redacts_json_escaped_credentials(workspace, db):
    settings, ws, _ = workspace
    secret = "private-키\nvalue"
    settings = settings.model_copy(update={"openai_api_key": SecretStr(secret)})
    response = answer()
    data = {**response.data, "summary": secret}
    fake = FakeAiClient([AiResponse(data, 12, 7, "fake", json.dumps(data))])
    job = generate(db, settings, ws)
    runner = AiJobRunner(db, settings, fake, FakeSyntaxChecker())
    try:
        runner.run_job(job.id)
    finally:
        runner.stop()
    logged = json.loads(settings.path("ai", job.id, "response-1.json").read_text())
    assert logged["summary"] == "[REDACTED]"
