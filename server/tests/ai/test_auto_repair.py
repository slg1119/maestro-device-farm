import json
from contextlib import contextmanager
from pathlib import Path
from threading import Event, Thread
from time import sleep

import pytest
from sqlalchemy import select

from farm.ai import jobs
from farm.ai.client import ImagePart
from farm.ai.jobs import AiJobRunner
from farm.db.models import AiJob, DeviceCommand, Reservation, Run, Task
from farm.results import CaseResult, TaskOutcome
from farm.scheduler.claim import claim_next
from farm.scheduler.commands import claim_command, finish_command
from farm.scheduler.finish import finish_task
from farm.scheduler.reservations import create_reservation, release_reservation
from farm.timeutil import now, shift
from tests.ai.test_jobs import answer, generate
from tests.factories import add_app, add_device
from tests.fakes import FakeAiClient, FakeSyntaxChecker
from tests.gitfixtures import FLOW


@pytest.fixture
def reserved(workspace, db):
    with db.session() as s:
        add_device(s, "reserved-phone")
        add_device(s, "other-phone")
        app = add_app(s)
        reservation = create_reservation(s, "reserved-phone", "tester", 900)
    return reservation, app


@pytest.fixture(autouse=True)
def fast_poll(monkeypatch):
    # Patch only the job runner's wait, so the helper thread still yields normally.
    monkeypatch.setattr(jobs, "sleep", lambda seconds: sleep(0.01), raising=False)


@contextmanager
def agent(db, settings, *, outcomes=(), inspect=None, on_task=None):
    """Use the real scheduler lifecycle on another thread, without an adb/OpenAI call."""
    stopped = Event()
    seen, errors = [], []

    def work():
        try:
            while not stopped.is_set():
                with db.session() as s:
                    command = claim_command(s, "reserved-phone")
                    task = None if command else claim_next(s, "reserved-phone", settings.data_dir)
                if command:
                    folder = settings.path("inspect", command.id)
                    folder.mkdir(parents=True)
                    if inspect:
                        inspect(command, folder)
                    else:
                        (folder / "screen.png").write_bytes(b"screen-image")
                        (folder / "hierarchy.json").write_text(json.dumps({"attributes": {}, "children": [
                            {"attributes": {"text": "로그인", "bounds": "[0,0][10,10]", "noise": "DROP"},
                             "children": [{"attributes": {"resource-id": "login", "hintText": "이메일",
                                                           "accessibilityText": "버튼", "bounds": "bounds"}}]},
                            *[{"attributes": {"text": f"node-{n}", "bounds": "bounds"}} for n in range(405)],
                        ]}))
                        with db.session() as s:
                            finish_command(s, command.id, ok=True, result_dir=str(folder))
                if task:
                    index = len(seen)
                    seen.append(task)
                    if on_task:
                        on_task(task)
                    if index < len(outcomes):
                        status = outcomes[index]
                        artifacts = Path(task.artifacts_dir)
                        flow_dir = artifacts / "maestro/session/login"
                        (flow_dir / "screenshots").mkdir(parents=True)
                        (flow_dir / "screenshots/failed.png").write_bytes(b"failed-step-image")
                        (flow_dir / "screen-hierarchy").mkdir()
                        (flow_dir / "screen-hierarchy/failed.json").write_text(json.dumps({
                            "attributes": {"resource-id": "failure:continue", "text": "실패 화면 계속",
                                           "noise": "DO_NOT_INCLUDE"},
                            "children": [{"attributes": {"text": f"failure-node-{i}"}} for i in range(405)],
                        }))
                        (flow_dir / "screenshots/newer.png").write_bytes(b"wrong-latest-image")
                        (flow_dir / "commands.json").write_text(json.dumps([{
                            "command": {"tapOnElement": {"selector": {"textRegex": "login"}}},
                            "metadata": {"status": "FAILED", "artifacts": [
                                {"type": "SCREENSHOT", "path": "screenshots/failed.png"},
                                {"type": "SCREEN_HIERARCHY", "path": "screen-hierarchy/failed.json"}]},
                        }]))
                        (artifacts / "maestro.log").write_text("device failure log\n")
                        with db.session() as s:
                            finish_task(s, task.id, TaskOutcome(status, error_code="runner_error" if status == "error" else None,
                                error_message="device error" if status == "error" else None,
                                cases=[CaseResult("login", status, failure_message="Expected repaired selector")]))
                stopped.wait(0.005)
        except Exception as exc:  # noqa: BLE001 - propagate helper-thread failures to pytest
            errors.append(exc)

    thread = Thread(target=work, name="fake-ai-agent")
    thread.start()
    try:
        yield seen
    finally:
        stopped.set()
        thread.join(timeout=5)
        assert not thread.is_alive()
        if errors:
            raise errors[0]


def execute(db, settings, fake, job):
    runner = AiJobRunner(db, settings, fake, FakeSyntaxChecker())
    try:
        future = runner.submit(job.id)
        try:
            future.result(timeout=10)
        finally:
            if not future.done():
                with db.session() as s:
                    s.get(AiJob, job.id).cancel_requested = True
    finally:
        runner.stop()
    with db.session() as s:
        return s.get(AiJob, job.id)


@pytest.mark.parametrize("auto_repair", [False, True])
def test_screen_attaches_image_and_bounded_hierarchy(workspace, db, reserved, auto_repair):
    settings, ws, _ = workspace
    reservation, app = reserved
    job = generate(db, settings, ws, include_screen=True, reservation_id=reservation.id,
                   auto_repair=auto_repair, app_build_id=app.id if auto_repair else None)
    fake = FakeAiClient([answer(), answer()])
    with agent(db, settings, outcomes=["failed", "passed"] if auto_repair else []):
        saved = execute(db, settings, fake, job)
    assert saved.status == "succeeded"
    request = fake.requests[0]
    assert any(isinstance(p, ImagePart) and p.data == b"screen-image" for p in request.parts)
    text = request.parts[0].text
    assert 'text="로그인"' in text and 'bounds="[0,0][10,10]"' in text
    assert '\n  - resource-id="login"' in text
    assert 'hintText="이메일"' in text and 'accessibilityText="버튼"' in text
    assert "DROP" not in text and "node-397" in text and "node-398" not in text
    with db.session() as s:
        assert len(list(s.scalars(select(DeviceCommand)))) == 1
    assert len(fake.requests) == (2 if auto_repair else 1)


@pytest.mark.parametrize("app_option", ["app_build_id", "app"])
def test_auto_repair_passes_second_run_with_snapshot_and_failed_step(workspace, db, reserved, app_option):
    settings, ws, origin = workspace
    reservation, app = reserved
    build = app.id if app_option == "app_build_id" else "com.example.app@latest"
    job = generate(db, settings, ws, auto_repair=True, reservation_id=reservation.id, **{app_option: build},
                   draft_changes=[{"op": "put", "path": "draft.txt", "content": "draft-overlay"}])
    repaired = FLOW + "- back\n"
    fake = FakeAiClient([answer(), answer(repaired)])
    with agent(db, settings, outcomes=["failed", "passed"]) as seen:
        saved = execute(db, settings, fake, job)
    assert saved.status == "succeeded" and len(seen) == 2
    assert saved.result["passed_run_id"] == seen[1].run_id
    assert saved.result["files"] == [{"path": "login.yaml", "content": repaired}]
    runs = [a for a in saved.attempts if a["kind"] == "run"]
    assert [(a["run_id"], a["status"]) for a in runs] == [(seen[0].run_id, "failed"), (seen[1].run_id, "ok")]
    text = fake.requests[1].parts[0].text
    assert "the flow failed on the device" in text
    assert "Expected repaired selector" in text and "device failure log" in text
    assert "## Screen hierarchy at failure (max 400 nodes)" in text
    assert 'resource-id="failure:continue"' in text and 'text="실패 화면 계속"' in text
    assert "DO_NOT_INCLUDE" not in text and "failure-node-398" in text and "failure-node-399" not in text
    assert any(isinstance(p, ImagePart) and p.data == b"failed-step-image" for p in fake.requests[1].parts)
    assert not any(isinstance(p, ImagePart) and p.data == b"wrong-latest-image" for p in fake.requests[1].parts)
    with db.session() as s:
        for n, task in enumerate(seen):
            run = s.get(Run, task.run_id)
            assert (run.origin, run.mode, run.reservation_id, run.app_build_id) == ("ai", "matrix", reservation.id, app.id)
            assert run.device_selector == {"serials": ["reserved-phone"]}
            assert run.flow_source == "draft" and run.env == {} and run.flow_paths == ["login.yaml"]
            assert run.workspace_id == ws.id and run.commit_sha == ws.head_sha
            root = settings.path("uploads", run.id, "flows")
            assert Path(run.flows_dir) == root
            assert (root / "login.yaml").read_text() == (FLOW if n == 0 else repaired)
            assert (root / "draft.txt").read_text() == "draft-overlay"
            assert (root / "search.yaml").is_file()
            assert task.device_serial == "reserved-phone"
    assert origin.head() == ws.head_sha


@pytest.mark.parametrize("status", ["failed", "error"])
def test_exhausted_run_repairs_keep_last_valid_answer(workspace, db, reserved, status):
    settings, ws, _ = workspace
    settings = settings.model_copy(update={"ai_max_repairs": 1})
    reservation, app = reserved
    job = generate(db, settings, ws, auto_repair=True, reservation_id=reservation.id, app_build_id=app.id)
    fake = FakeAiClient([answer(), answer(FLOW + "- back\n")])
    with agent(db, settings, outcomes=[status, status]) as seen:
        saved = execute(db, settings, fake, job)
    assert saved.status == "succeeded" and len(seen) == 2
    assert saved.result["passed_run_id"] is None and saved.error_message is None
    assert "자동 보정 1회 후에도 실행이 통과하지 않았습니다" in saved.result["summary"]
    assert saved.result["files"] == answer(FLOW + "- back\n").data["files"]


def test_validation_and_device_failures_share_retry_budget(workspace, db, reserved):
    settings, ws, _ = workspace
    settings = settings.model_copy(update={"ai_max_repairs": 1})
    reservation, app = reserved
    job = generate(db, settings, ws, auto_repair=True, reservation_id=reservation.id, app_build_id=app.id)
    fake = FakeAiClient([answer(FLOW + "- notACommand\n"), answer()])
    with agent(db, settings, outcomes=["failed"]) as seen:
        saved = execute(db, settings, fake, job)
    assert saved.status == "succeeded" and len(seen) == 1 and len(fake.requests) == 2
    assert "자동 보정 1회" in saved.result["summary"]


def test_invalid_final_repair_preserves_last_valid_answer(workspace, db, reserved):
    settings, ws, _ = workspace
    settings = settings.model_copy(update={"ai_max_repairs": 1})
    reservation, app = reserved
    job = generate(db, settings, ws, auto_repair=True, reservation_id=reservation.id, app_build_id=app.id)
    fake = FakeAiClient([answer(), answer(FLOW + "- notACommand\n")])
    with agent(db, settings, outcomes=["failed"]) as seen:
        saved = execute(db, settings, fake, job)
    assert saved.status == "succeeded" and len(seen) == 1
    assert saved.result["files"] == answer().data["files"]
    assert "자동 보정 1회" in saved.result["summary"]


def test_non_flow_target_runs_workspace_and_builds_error_context(workspace, db, reserved):
    settings, ws, _ = workspace
    reservation, app = reserved
    job = generate(db, settings, ws, target_path="config.yaml", auto_repair=True,
                   reservation_id=reservation.id, app_build_id=app.id)
    fake = FakeAiClient([answer("flows:\n  - '*.yaml'\n", "config.yaml"),
                         answer("flows:\n  - login.yaml\n", "config.yaml")])
    with agent(db, settings, outcomes=["error", "passed"]) as seen:
        saved = execute(db, settings, fake, job)
    assert saved.status == "succeeded", saved.error_message
    assert len(seen) == 2 and saved.result["passed_run_id"] == seen[-1].run_id
    assert "device error" in fake.requests[1].parts[0].text
    assert "Expected repaired selector" in fake.requests[1].parts[0].text
    with db.session() as s:
        assert all(s.get(Run, task.run_id).flow_paths is None for task in seen)


def test_cancellation_cancels_running_draft(workspace, db, reserved):
    settings, ws, _ = workspace
    reservation, app = reserved
    job = generate(db, settings, ws, auto_repair=True, reservation_id=reservation.id, app_build_id=app.id)

    def cancel(task):
        with db.session() as s:
            s.get(AiJob, job.id).cancel_requested = True

    with agent(db, settings, on_task=cancel) as seen:
        saved = execute(db, settings, FakeAiClient([answer()]), job)
    assert saved.status == "cancelled" and len(seen) == 1
    with db.session() as s:
        assert s.get(Run, seen[0].run_id).cancel_requested
        assert s.get(Task, seen[0].id).cancel_requested
    assert next(a for a in saved.attempts if a["kind"] == "run")["run_id"] == seen[0].run_id


@pytest.mark.parametrize("end", ["released", "expired"])
def test_reservation_ending_during_run_fails_job_and_cancels_run(workspace, db, reserved, end):
    settings, ws, _ = workspace
    reservation, app = reserved
    job = generate(db, settings, ws, auto_repair=True, reservation_id=reservation.id, app_build_id=app.id)

    def end_reservation(task):
        with db.session() as s:
            if end == "released":
                release_reservation(s, reservation.id)
            else:
                s.get(Reservation, reservation.id).expires_at = shift(now(), -1)

    with agent(db, settings, on_task=end_reservation) as seen:
        saved = execute(db, settings, FakeAiClient([answer()]), job)
    assert saved.status == "failed" and saved.error_message == "reservation ended"
    assert len(seen) == 1
    with db.session() as s:
        assert s.get(Run, seen[0].run_id).cancel_requested


@pytest.mark.parametrize("auto_repair", [False, True])
def test_reservation_ending_in_provider_call_prevents_run(workspace, db, reserved, auto_repair):
    settings, ws, _ = workspace
    reservation, app = reserved
    job = generate(db, settings, ws, auto_repair=auto_repair, reservation_id=reservation.id, app_build_id=app.id)

    def release(request):
        with db.session() as s:
            release_reservation(s, reservation.id)
        return answer()

    saved = execute(db, settings, FakeAiClient([release]), job)
    assert saved.status == "failed" and saved.error_message == "reservation ended"
    with db.session() as s:
        assert list(s.scalars(select(Run))) == []


def test_cancellation_while_waiting_for_screen_stops_before_provider(workspace, db, reserved):
    settings, ws, _ = workspace
    reservation, _ = reserved
    job = generate(db, settings, ws, include_screen=True, reservation_id=reservation.id)
    fake = FakeAiClient([answer()])

    def cancel(command, folder):
        with db.session() as s:
            s.get(AiJob, job.id).cancel_requested = True

    with agent(db, settings, inspect=cancel):
        saved = execute(db, settings, fake, job)
    assert saved.status == "cancelled" and saved.error_message is None
    assert fake.requests == []


@pytest.mark.parametrize("failure", ["agent_error", "missing_files", "invalid_json", "timeout", "reservation_end"])
def test_screen_failure_never_calls_provider(workspace, db, reserved, monkeypatch, failure):
    settings, ws, _ = workspace
    reservation, _ = reserved
    job = generate(db, settings, ws, include_screen=True, reservation_id=reservation.id)
    fake = FakeAiClient([answer()])

    def inspect(command, folder):
        if failure == "invalid_json":
            (folder / "screen.png").write_bytes(b"screen-image")
            (folder / "hierarchy.json").write_text("not json")
        with db.session() as s:
            if failure == "reservation_end":
                release_reservation(s, reservation.id)
            elif failure != "timeout":
                finish_command(s, command.id, ok=failure in {"missing_files", "invalid_json"},
                               result_dir=str(folder), error="capture failed")

    if failure == "timeout":
        ticks = iter(range(0, 1000, 91))
        monkeypatch.setattr(jobs, "monotonic", lambda: next(ticks), raising=False)
    with agent(db, settings, inspect=inspect):
        saved = execute(db, settings, fake, job)
    assert saved.status == "failed" and fake.requests == []
    if failure == "reservation_end":
        assert saved.error_message == "reservation ended"
    else:
        assert saved.error_message.startswith("screen snapshot failed: ")
        if failure == "timeout":
            assert "90" in saved.error_message
