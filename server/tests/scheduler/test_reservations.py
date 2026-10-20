import pytest

from farm.db.models import Device, DeviceCommand, Reservation, Run, Task
from farm.results import TaskOutcome
from farm.scheduler.claim import claim_next
from farm.scheduler.commands import create_inspect_command
from farm.scheduler.finish import finish_task
from farm.scheduler.reservations import (
    ReservationError,
    create_reservation,
    expire_reservations,
    release_reservation,
    renew_reservation,
)
from farm.timeutil import parse
from tests.factories import add_app, add_device, flow_yaml, submit, write_flows


@pytest.fixture
def flows(tmp_path):
    return write_flows(tmp_path / "flows", {"a.yaml": flow_yaml()})


def test_reserve_available_device(db):
    with db.session() as s:
        add_device(s, "d1")
        res = create_reservation(s, "d1", "alice", 900)
    with db.session() as s:
        device = s.get(Device, "d1")
        assert (device.state, device.reservation_id) == ("reserved", res.id)
        r = s.get(Reservation, res.id)
        assert r.status == "active" and r.holder_name == "alice"
        assert (parse(r.expires_at) - parse(r.created_at)).total_seconds() == 900


def test_reserve_busy_device_keeps_it_busy(db):
    with db.session() as s:
        add_device(s, "d1", state="busy")
        res = create_reservation(s, "d1", "alice", 900)
        device = s.get(Device, "d1")
        assert (device.state, device.reservation_id) == ("busy", res.id)


@pytest.mark.parametrize(("serial", "state", "code"), [("d1", "offline", "device_unavailable"),
                                                       ("d1", "unhealthy", "device_unavailable"),
                                                       ("nope", "available", "device_not_found")])
def test_reservation_errors(db, serial, state, code):
    with db.session() as s:
        add_device(s, "d1", state=state)
    with pytest.raises(ReservationError) as excinfo, db.session() as s:
        create_reservation(s, serial, "alice", 900)
    assert excinfo.value.code == code


def test_second_reservation_reports_holder(db):
    with db.session() as s:
        add_device(s, "d1")
        create_reservation(s, "d1", "alice", 900)
    with pytest.raises(ReservationError) as excinfo, db.session() as s:
        create_reservation(s, "d1", "bob", 900)
    assert (excinfo.value.code, excinfo.value.holder) == ("already_reserved", "alice")


def test_renew_extends_expiry(db):
    with db.session() as s:
        add_device(s, "d1")
        res = create_reservation(s, "d1", "alice", 10)
    with db.session() as s:
        renewed = renew_reservation(s, res.id, 900)
        assert renewed.expires_at > res.expires_at
    with db.session() as s:
        release_reservation(s, res.id)
    with pytest.raises(ReservationError) as excinfo, db.session() as s:
        renew_reservation(s, res.id, 900)
    assert excinfo.value.code == "reservation_not_active"


def test_release_cancels_queued_work(db, flows):
    with db.session() as s:
        add_device(s, "d1")
        res = create_reservation(s, "d1", "alice", 900)
        run = submit(s, app=add_app(s), flows_dir=flows, reservation_id=res.id)
        cmd = create_inspect_command(s, res.id)
    with db.session() as s:
        release_reservation(s, res.id)
    with db.session() as s:
        assert s.get(Reservation, res.id).status == "released"
        assert s.get(Run, run.id).status == "cancelled"
        assert s.get(DeviceCommand, cmd.id).status == "error"
        device = s.get(Device, "d1")
        assert (device.state, device.reservation_id) == ("available", None)


def test_release_lets_running_task_finish(db, settings, flows):
    with db.session() as s:
        add_device(s, "d1")
        res = create_reservation(s, "d1", "alice", 900)
        submit(s, app=add_app(s), flows_dir=flows, reservation_id=res.id)
    with db.session() as s:
        task = claim_next(s, "d1", settings.data_dir)
    with db.session() as s:
        release_reservation(s, res.id)
    with db.session() as s:
        assert s.get(Task, task.id).status == "running"
        assert s.get(Device, "d1").state == "busy"
        finish_task(s, task.id, TaskOutcome("passed"))
    with db.session() as s:
        assert s.get(Device, "d1").state == "available"


def test_expire_reservations(db):
    with db.session() as s:
        add_device(s, "d1")
        res = create_reservation(s, "d1", "alice", 900)
        s.get(Reservation, res.id).expires_at = "2020-01-01T00:00:00.000000Z"
    with db.session() as s:
        assert expire_reservations(s) == [res.id]
    with db.session() as s:
        assert s.get(Reservation, res.id).status == "expired"
        assert s.get(Device, "d1").state == "available"
