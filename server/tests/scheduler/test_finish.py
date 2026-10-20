import pytest
from sqlalchemy import select

from farm.db.models import Device, Run, Task, TestResult
from farm.results import CaseResult, TaskOutcome
from farm.scheduler.claim import claim_next
from farm.scheduler.finish import (
    cancel_run,
    finish_task,
    is_cancel_requested,
    requeue_after_precheck,
    terminate_task,
)
from farm.timeutil import now, parse, shift
from tests.factories import add_app, add_device, flow_yaml, submit, write_flows


@pytest.fixture
def flows(tmp_path):
    return write_flows(tmp_path / "flows", {"a.yaml": flow_yaml(), "b.yaml": flow_yaml()})


def _claim(db, settings, serial):
    with db.session() as s:
        return claim_next(s, serial, settings.data_dir)


def _finish(db, task_id, outcome):
    with db.session() as s:
        return finish_task(s, task_id, outcome)


def test_passed_task_completes_run_and_frees_device(db, settings, flows):
    with db.session() as s:
        add_device(s, "d1")
        run = submit(s, app=add_app(s), flows_dir=flows, flow_paths=["a.yaml"])
    task = _claim(db, settings, "d1")
    _finish(db, task.id, TaskOutcome("passed", exit_code=0, cases=[CaseResult("a", "passed", 5)]))
    with db.session() as s:
        r = s.get(Run, run.id)
        assert (r.status, r.finished_at is not None) == ("passed", True)
        d = s.get(Device, "d1")
        assert (d.state, d.current_task_id) == ("available", None)
        rows = list(s.scalars(select(TestResult).where(TestResult.task_id == task.id)))
        assert [(x.flow_name, x.status, x.device_serial) for x in rows] == [("a", "passed", "d1")]


def test_failed_task_marks_run_failed(db, settings, flows):
    with db.session() as s:
        add_device(s, "d1")
        run = submit(s, app=add_app(s), flows_dir=flows, flow_paths=["a.yaml"])
    task = _claim(db, settings, "d1")
    _finish(db, task.id, TaskOutcome("failed", exit_code=1, cases=[CaseResult("a", "failed", 5, "boom")]))
    with db.session() as s:
        assert s.get(Run, run.id).status == "failed"
        assert s.get(Task, task.id).attempt == 1


def test_infra_error_retries_once_then_errors(db, settings, flows):
    with db.session() as s:
        add_device(s, "d1")
        add_device(s, "d2")
        run = submit(s, app=add_app(s), flows_dir=flows, flow_paths=["a.yaml"])
    first = _claim(db, settings, "d1")
    _finish(db, first.id, TaskOutcome("error", error_code="timeout", error_message="slow"))
    with db.session() as s:
        t = s.get(Task, first.id)
        assert (t.status, t.attempt, t.device_serial, t.error_code) == ("queued", 2, None, "timeout")
        assert s.get(Run, run.id).status == "running"
    second = _claim(db, settings, "d2")
    assert second.id == first.id and second.artifacts_dir.endswith("attempt-2")
    _finish(db, second.id, TaskOutcome("error", error_code="timeout"))
    with db.session() as s:
        assert s.get(Task, first.id).status == "error"
        assert s.get(Run, run.id).status == "error"


def test_pinned_retry_keeps_its_device(db, settings, flows):
    with db.session() as s:
        add_device(s, "d1")
        submit(s, app=add_app(s), flows_dir=flows, mode="matrix")
    task = _claim(db, settings, "d1")
    _finish(db, task.id, TaskOutcome("error", error_code="device_disconnected"))
    with db.session() as s:
        t = s.get(Task, task.id)
        assert (t.status, t.attempt, t.device_serial, t.pinned) == ("queued", 2, "d1", True)


def test_retry_waits_for_backoff_before_claim(db, settings, flows):
    with db.session() as s:
        add_device(s, "d1")
        submit(s, app=add_app(s), flows_dir=flows, flow_paths=["a.yaml"])
    first = _claim(db, settings, "d1")
    before = now()
    with db.session() as s:
        finish_task(s, first.id, TaskOutcome("error", error_code="timeout"), retry_backoff_sec=15)
    with db.session() as s:
        task = s.get(Task, first.id)
        assert task.status == "queued" and task.attempt == 2
        assert abs((parse(task.not_before) - parse(before)).total_seconds() - 15) <= 2
    assert _claim(db, settings, "d1") is None
    with db.session() as s:
        s.get(Task, first.id).not_before = shift(now(), -1)
    second = _claim(db, settings, "d1")
    assert second.id == first.id
    assert second.not_before is None


def test_retry_defaults_to_no_backoff(db, settings, flows):
    with db.session() as s:
        add_device(s, "d1")
        submit(s, app=add_app(s), flows_dir=flows, flow_paths=["a.yaml"])
    first = _claim(db, settings, "d1")
    _finish(db, first.id, TaskOutcome("error", error_code="timeout"))
    with db.session() as s:
        assert s.get(Task, first.id).not_before is None
    assert _claim(db, settings, "d1").id == first.id


def test_non_infra_error_is_not_retried(db, settings, flows):
    with db.session() as s:
        add_device(s, "d1")
        submit(s, app=add_app(s), flows_dir=flows, flow_paths=["a.yaml"])
    task = _claim(db, settings, "d1")
    _finish(db, task.id, TaskOutcome("error", error_code="runner_error"))
    with db.session() as s:
        assert s.get(Task, task.id).status == "error"


def test_cancel_run(db, settings, flows):
    with db.session() as s:
        add_device(s, "d1")
        run = submit(s, app=add_app(s), flows_dir=flows)
    running = _claim(db, settings, "d1")
    with db.session() as s:
        cancel_run(s, run.id)
    with db.session() as s:
        statuses = {t.id: t.status for t in s.scalars(select(Task).where(Task.run_id == run.id))}
        assert statuses[running.id] == "running"
        assert sorted(statuses.values()) == ["cancelled", "running"]
        assert is_cancel_requested(s, running.id)
    _finish(db, running.id, TaskOutcome("cancelled"))
    with db.session() as s:
        assert s.get(Run, run.id).status == "cancelled"


def test_cancel_unknown_run(db):
    with pytest.raises(LookupError), db.session() as s:
        cancel_run(s, "missing")


def test_cancel_blocks_retry(db, settings, flows):
    with db.session() as s:
        add_device(s, "d1")
        run = submit(s, app=add_app(s), flows_dir=flows, flow_paths=["a.yaml"])
    task = _claim(db, settings, "d1")
    with db.session() as s:
        cancel_run(s, run.id)
    _finish(db, task.id, TaskOutcome("error", error_code="timeout"))
    with db.session() as s:
        assert s.get(Task, task.id).status == "error"
        assert s.get(Run, run.id).status == "cancelled"


@pytest.mark.parametrize(
    ("statuses", "expected"),
    [(["passed", "passed"], "passed"), (["passed", "failed"], "failed"), (["failed", "error"], "error"),
     (["error", "cancelled"], "cancelled")],
)
def test_run_status_priority(db, settings, flows, statuses, expected):
    with db.session() as s:
        add_device(s, "d1")
        run = submit(s, app=add_app(s), flows_dir=flows)
    with db.session() as s:
        tasks = list(s.scalars(select(Task).where(Task.run_id == run.id).order_by(Task.seq)))
        for task, status in zip(tasks, statuses, strict=True):
            terminate_task(s, task, status)
    with db.session() as s:
        assert s.get(Run, run.id).status == expected


def test_precheck_requeue_marks_device_unhealthy(db, settings, flows):
    with db.session() as s:
        add_device(s, "d1")
        submit(s, app=add_app(s), flows_dir=flows, flow_paths=["a.yaml"])
    task = _claim(db, settings, "d1")
    with db.session() as s:
        requeue_after_precheck(s, task.id, "battery 5% below 20%")
    with db.session() as s:
        t = s.get(Task, task.id)
        assert (t.status, t.attempt, t.device_serial) == ("queued", 1, None)
        d = s.get(Device, "d1")
        assert (d.state, d.state_reason, d.current_task_id) == ("unhealthy", "battery 5% below 20%", None)


@pytest.mark.parametrize(("field", "value", "expected"), [("reservation_id", "res1", "reserved"),
                                                          ("disabled", True, "disabled")])
def test_device_release_respects_reservation_and_disable(db, settings, flows, field, value, expected):
    with db.session() as s:
        add_device(s, "d1")
        submit(s, app=add_app(s), flows_dir=flows, flow_paths=["a.yaml"])
    task = _claim(db, settings, "d1")
    with db.session() as s:
        setattr(s.get(Device, "d1"), field, value)
    _finish(db, task.id, TaskOutcome("passed"))
    with db.session() as s:
        assert s.get(Device, "d1").state == expected


def test_results_of_earlier_attempts_are_replaced(db, settings, flows):
    with db.session() as s:
        add_device(s, "d1")
        run = submit(s, app=add_app(s), flows_dir=flows, flow_paths=["a.yaml"])
    task = _claim(db, settings, "d1")
    with db.session() as s:
        s.add(TestResult(task_id=task.id, run_id=run.id, device_serial="d1", flow_name="old", status="failed"))
    _finish(db, task.id, TaskOutcome("passed", cases=[CaseResult("a", "passed")]))
    with db.session() as s:
        assert [r.flow_name for r in s.scalars(select(TestResult))] == ["a"]
