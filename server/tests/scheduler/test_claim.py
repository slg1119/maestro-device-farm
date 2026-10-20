import threading

import pytest
from sqlalchemy import select

from farm.db.models import Device, Run, Task
from farm.scheduler.claim import claim_next
from farm.scheduler.selector import DeviceSelector
from farm.timeutil import now, shift
from tests.factories import add_app, add_device, flow_yaml, submit, write_flows


@pytest.fixture
def flows(tmp_path):
    return write_flows(tmp_path / "flows", {"a.yaml": flow_yaml(), "b.yaml": flow_yaml(), "c.yaml": flow_yaml()})


def test_split_task_claimed_by_matching_device(db, settings, flows):
    with db.session() as s:
        add_device(s, "d1")
        run = submit(s, app=add_app(s), flows_dir=flows)
    with db.session() as s:
        task = claim_next(s, "d1", settings.data_dir)
        assert (task.status, task.device_serial, task.seq) == ("running", "d1", 0)
        assert task.started_at is not None
        assert task.artifacts_dir == str(settings.data_dir / "runs" / run.id / "tasks" / task.id / "attempt-1")
        device = s.get(Device, "d1")
        assert (device.state, device.current_task_id) == ("busy", task.id)
        assert s.get(Run, run.id).status == "running"


def test_busy_device_claims_nothing(db, settings, flows):
    with db.session() as s:
        add_device(s, "d1")
        submit(s, app=add_app(s), flows_dir=flows)
    with db.session() as s:
        assert claim_next(s, "d1", settings.data_dir) is not None
    with db.session() as s:
        assert claim_next(s, "d1", settings.data_dir) is None


def test_future_task_is_skipped_while_another_is_claimed(db, settings, flows):
    with db.session() as s:
        add_device(s, "d1")
        run = submit(s, app=add_app(s), flows_dir=flows, flow_paths=["a.yaml", "b.yaml"])
        delayed = s.scalar(select(Task).where(Task.run_id == run.id, Task.seq == 0))
        delayed.not_before = shift(now(), 60)
        delayed_id = delayed.id
    with db.session() as s:
        claimed = claim_next(s, "d1", settings.data_dir)
        assert claimed.seq == 1 and claimed.not_before is None
        assert s.get(Task, delayed_id).status == "queued"


def test_unknown_or_offline_device_claims_nothing(db, settings, flows):
    with db.session() as s:
        add_device(s, "d1")
        add_device(s, "d2", state="offline")
        submit(s, app=add_app(s), flows_dir=flows)
    with db.session() as s:
        assert claim_next(s, "nope", settings.data_dir) is None
        assert claim_next(s, "d2", settings.data_dir) is None


def test_pinned_task_only_for_its_device(db, settings, flows):
    with db.session() as s:
        add_device(s, "d1")
        add_device(s, "d2")
        submit(s, app=add_app(s), flows_dir=flows, mode="matrix", selector=DeviceSelector(serials=["d2"]))
    with db.session() as s:
        assert claim_next(s, "d1", settings.data_dir) is None
        assert claim_next(s, "d2", settings.data_dir).device_serial == "d2"


def test_fifo_across_runs(db, settings, flows):
    with db.session() as s:
        add_device(s, "d1")
        app = add_app(s)
        older = submit(s, app=app, flows_dir=flows, flow_paths=["a.yaml"])
        newer = submit(s, app=app, flows_dir=flows, flow_paths=["b.yaml"])
        s.get(Run, older.id).created_at = "2026-01-01T00:00:00.000000Z"
        s.get(Run, newer.id).created_at = "2026-01-02T00:00:00.000000Z"
    with db.session() as s:
        assert claim_next(s, "d1", settings.data_dir).run_id == older.id


def test_unpinned_tasks_respect_selector_and_app_min_sdk(db, settings, flows):
    with db.session() as s:
        add_device(s, "d1", sdk_int=28)
        add_device(s, "d2", sdk_int=34, tags=("tablet",))
        submit(s, app=add_app(s, min_sdk=30), flows_dir=flows, selector=DeviceSelector(tags=["tablet"]))
    with db.session() as s:
        assert claim_next(s, "d1", settings.data_dir) is None
        assert claim_next(s, "d2", settings.data_dir) is not None


def test_reserved_device_only_takes_its_reservation_runs(db, settings, flows):
    with db.session() as s:
        add_device(s, "d1", state="reserved", reservation_id="res1")
        add_device(s, "d2")
        app = add_app(s)
        normal = submit(s, app=app, flows_dir=flows, flow_paths=["a.yaml"])
        reserved = submit(s, app=app, flows_dir=flows, flow_paths=["b.yaml"], reservation_id="res1")
    with db.session() as s:
        assert claim_next(s, "d1", settings.data_dir).run_id == reserved.id
    with db.session() as s:
        assert claim_next(s, "d2", settings.data_dir).run_id == normal.id


def test_concurrent_claims_never_duplicate(db, settings, tmp_path):
    many = write_flows(tmp_path / "many", {f"f{i:02}.yaml": flow_yaml() for i in range(30)})
    with db.session() as s:
        for i in range(30):
            add_device(s, f"d{i:02}")
        submit(s, app=add_app(s), flows_dir=many)
    claimed: list[str | None] = []
    lock = threading.Lock()

    def worker(serial: str) -> None:
        with db.session() as s:
            task = claim_next(s, serial, settings.data_dir)
            with lock:
                claimed.append(task.id if task else None)

    threads = [threading.Thread(target=worker, args=(f"d{i:02}",)) for i in range(30)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert None not in claimed and len(set(claimed)) == 30
    with db.session() as s:
        assert {t.status for t in s.scalars(select(Task))} == {"running"}
