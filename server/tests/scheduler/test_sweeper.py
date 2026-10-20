import pytest

from farm.db.models import Device, Run, Task
from farm.scheduler.selector import DeviceSelector
from farm.scheduler.sweeper import fail_stale_pinned_tasks
from farm.timeutil import now, shift
from tests.factories import add_app, add_device, flow_yaml, submit, write_flows

LONG_AGO = "2020-01-01T00:00:00.000000Z"


@pytest.fixture
def flows(tmp_path):
    return write_flows(tmp_path / "flows", {"a.yaml": flow_yaml()})


def _matrix_on(db, flows, serial):
    with db.session() as s:
        run = submit(s, app=add_app(s), flows_dir=flows, mode="matrix", selector=DeviceSelector(serials=[serial]))
        for task in s.query(Task).filter(Task.run_id == run.id):
            task.created_at = LONG_AGO
        return run


@pytest.mark.parametrize(("state", "changed_at", "expect_failed"), [
    ("offline", LONG_AGO, True),
    ("unhealthy", LONG_AGO, True),
    ("offline", None, False),   # went offline just now
    ("busy", LONG_AGO, False),  # running another task is normal waiting
])
def test_stale_pinned_tasks(db, flows, state, changed_at, expect_failed):
    with db.session() as s:
        add_device(s, "d1")
    run = _matrix_on(db, flows, "d1")
    with db.session() as s:
        device = s.get(Device, "d1")
        device.state = state
        device.state_changed_at = changed_at or now()
    with db.session() as s:
        failed = fail_stale_pinned_tasks(s, 600)
    with db.session() as s:
        task = s.query(Task).filter(Task.run_id == run.id).one()
        if expect_failed:
            assert failed == [task.id]
            assert (task.status, task.error_code) == ("error", "device_unavailable")
            assert s.get(Run, run.id).status == "error"
        else:
            assert failed == [] and task.status == "queued"


def test_recent_task_on_long_offline_device_waits(db, flows):
    with db.session() as s:
        add_device(s, "d1")
    with db.session() as s:
        run = submit(s, app=add_app(s), flows_dir=flows, mode="matrix")
        s.get(Device, "d1").state = "offline"
        s.get(Device, "d1").state_changed_at = LONG_AGO
    with db.session() as s:
        assert fail_stale_pinned_tasks(s, 600) == []
        assert shift(now(), -600) < s.query(Task).filter(Task.run_id == run.id).one().created_at
