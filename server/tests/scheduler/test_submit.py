import pytest
from sqlalchemy import select

from farm.db.models import Task
from farm.events import events_since
from farm.scheduler.selector import DeviceSelector
from farm.scheduler.submit import SubmitError
from tests.factories import add_app, add_device, flow_yaml, submit, write_flows


@pytest.fixture
def flows(tmp_path):
    return write_flows(tmp_path / "flows", {"a.yaml": flow_yaml("smoke"), "b.yaml": flow_yaml(),
                                            "c.yaml": flow_yaml("smoke")})


def _tasks(session, run):
    return list(session.scalars(select(Task).where(Task.run_id == run.id).order_by(Task.seq)))


def test_matrix_creates_one_pinned_task_per_matching_device(db, flows):
    with db.session() as s:
        add_device(s, "d1")
        add_device(s, "d2", state="busy")
        add_device(s, "d3", state="offline")
        run = submit(s, app=add_app(s), flows_dir=flows, mode="matrix")
        tasks = _tasks(s, run)
    assert [(t.device_serial, t.pinned, t.flows, t.status) for t in tasks] == [
        ("d1", True, [], "queued"), ("d2", True, [], "queued")]
    assert (run.status, run.flow_source, run.mode) == ("queued", "upload", "matrix")


def test_matrix_with_flow_paths(db, flows):
    with db.session() as s:
        add_device(s, "d1")
        run = submit(s, app=add_app(s), flows_dir=flows, mode="matrix", flow_paths=["b.yaml"])
        assert [t.flows for t in _tasks(s, run)] == [["b.yaml"]]


def test_split_creates_one_unpinned_task_per_flow(db, flows):
    with db.session() as s:
        add_device(s, "d1")
        run = submit(s, app=add_app(s), flows_dir=flows, include_tags=("smoke",))
        tasks = _tasks(s, run)
    assert [(t.flows, t.pinned, t.device_serial) for t in tasks] == [
        (["a.yaml"], False, None), (["c.yaml"], False, None)]


def test_no_matching_devices(db, flows):
    with pytest.raises(SubmitError) as excinfo, db.session() as s:
        add_device(s, "d1")
        submit(s, app=add_app(s), flows_dir=flows, selector=DeviceSelector(tags=["tablet"]))
    assert excinfo.value.code == "no_matching_devices"


def test_app_min_sdk_filters_devices(db, flows):
    with pytest.raises(SubmitError) as excinfo, db.session() as s:
        add_device(s, "d1", sdk_int=28)
        submit(s, app=add_app(s, min_sdk=30), flows_dir=flows)
    assert excinfo.value.code == "no_matching_devices"


def test_reserved_and_disabled_devices_need_their_reservation(db, flows):
    with pytest.raises(SubmitError), db.session() as s:
        add_device(s, "d1", state="reserved", reservation_id="res1")
        add_device(s, "d2", disabled=True)
        submit(s, app=add_app(s), flows_dir=flows, mode="matrix")
    with db.session() as s:
        add_device(s, "d1", state="reserved", reservation_id="res1")
        run = submit(s, app=add_app(s), flows_dir=flows, mode="matrix", reservation_id="res1")
        assert [t.device_serial for t in _tasks(s, run)] == ["d1"]
        assert run.reservation_id == "res1"


def test_split_without_matching_flows(db, flows):
    with pytest.raises(SubmitError) as excinfo, db.session() as s:
        add_device(s, "d1")
        submit(s, app=add_app(s), flows_dir=flows, include_tags=("nope",))
    assert excinfo.value.code == "no_flows"


def test_unknown_flow_path(db, flows):
    with pytest.raises(SubmitError) as excinfo, db.session() as s:
        add_device(s, "d1")
        submit(s, app=add_app(s), flows_dir=flows, flow_paths=["zzz.yaml"])
    assert excinfo.value.code == "flow_not_found"


def test_submit_emits_run_event(db, flows):
    with db.session() as s:
        add_device(s, "d1")
        run = submit(s, app=add_app(s), flows_dir=flows)
    with db.session() as s:
        events = events_since(s, 0, run_id=run.id)
    assert [(e.type, e.payload["status"]) for e in events] == [("run.updated", "queued")]
